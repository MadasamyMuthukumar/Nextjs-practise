# Design Google Drive — Interview Quick Notes

## 1. Requirements

**Functional:**
- Upload/download files and manage folders (create, rename, move, delete/trash).
- Sync changes across web, mobile, desktop; support offline clients.
- Share files/folders with users, groups, or links; roles such as viewer/editor.
- Keep revisions and restore older versions.
- Search files and generate previews.

**Non-functional:** high availability, durability, horizontal scalability, low-latency downloads, secure access, conflict safety.

## 2. High-Level Architecture

```text
 Web / Mobile / Desktop Clients
 (local cache, offline queue, sync cursor)
                 |
          API Gateway / Auth
                 |
   +-------------+------------------+
   |             |                  |
Metadata      Upload             Sharing /
Service       Coordinator         Permissions
   |             |                  |
   +-------------+------------------+
                 |
       Distributed Metadata DB
 (files, folders, versions, ACLs, sessions,
    quotas, idempotency, transactional outbox)
                 |
       +---------+----------+
       |                    |
  Object Storage        Durable Event Bus
 (blobs, parts,          (sync changes,
  manifests, versions)   indexing, alerts)
       |                    |
   CDN / Download      Workers: malware scan,
   delivery            thumbnails, search index
```

**Core principle:** app servers coordinate and authorize; large file bytes flow directly between clients and object storage/CDN.

## 3. Data Model (Conceptual)

- `drives(id, owner_id, type)`
- `files(id, drive_id, parent_id, name, type, head_version_id, generation, acl_version, is_trashed, updated_at)`
- `file_versions(id, file_id, version_number, manifest_id, content_hash, size_bytes, created_by, created_at)`
- `permissions(id, resource_id, principal_type, principal_id, role)`
- `upload_sessions(id, user_id, file_id, status, idempotency_key, expected_generation, expires_at)`
- `outbox_events(id, event_type, aggregate_id, payload, published_at)`

**Storage split:** metadata and permissions in a transactional DB; file bytes in object storage; cache hot metadata/permissions carefully; queue asynchronous work. A version references an immutable blob or chunk manifest.

## 4. Upload Flow (Resumable)

1. Client requests upload session with an **idempotency key**.
2. Server authenticates, checks write permission/limits, reserves quota, creates session.
3. Client uploads chunks directly to object storage using short-lived signed URLs.
4. Client retries only failed chunks; server/storage verifies sizes and checksums.
5. Finalize: verify all parts, re-check permission and expected file generation.
6. Transactionally insert new version, advance file head, increment generation, settle quota, mark session complete, write outbox event.
7. Workers scan content and generate previews/indexes. Only expose content after required safety checks pass.

**Failure handling:** retries must be idempotent. Orphaned blobs and abandoned multipart uploads are cleaned up asynchronously after a safe delay.

## 5. Download Flow

1. Authenticate user and authorize access to file/revision.
2. Resolve immutable content object and issue short-lived, narrowly scoped signed URL.
3. Client downloads via CDN/object storage; support HTTP `Range` requests for resume.
4. Keep private buckets private. Signed URLs may remain usable until expiry unless delivery performs revocation-aware checks.

## 6. Sync Across Devices

- Maintain a **durable change feed** per drive/user scope, with opaque cursor/page token.
- Every committed mutation creates a change record (through a transactional outbox).
- Client asks for changes after cursor, applies changes idempotently, then persists local data and cursor together.
- Use push/websocket notifications only as a hint; clients fetch the durable feed to catch up.
- Use **tombstones** for deletions so offline devices learn that an item was removed.
- If cursor expires, require full resync while preserving pending offline edits.
- Initial sync: snapshot/list pages + replay changes since the snapshot cursor.

## 7. Sharing & Permissions

- Support direct grants, inherited folder permissions, group/domain access, and restricted share links.
- Every read/write must be authorized on the server; never trust client-supplied owner/role IDs.
- Update permission and `acl_version` atomically; invalidate caches or use version-aware checks.
- Re-check permissions at sensitive commit points (e.g., upload completion).
- Short-lived signed URLs improve security, but revocation may not be instant unless CDN/token validation checks current access.
- Avoid synchronously writing permission rows for every descendant of a huge shared folder; use inheritance/materialized indexes with safe invalidation.

## 8. Revisions & Concurrent Edits

- Keep revisions immutable. `files.head_version_id` points to the current version.
- Use a monotonic `generation` as the optimistic concurrency token.
- Update using compare-and-swap:

```sql
UPDATE files
SET head_version_id = :new_version,
    generation = generation + 1
WHERE id = :file_id
  AND generation = :expected_generation;
```

- Insert the new version and update the head in **one DB transaction**; zero updated rows means conflict (`409`/`412`).
- Binary file conflict: preserve the conflicting edit or ask the client to resolve; do not blindly overwrite with the latest generation.
- Restore old revision by creating a **new current revision** using old content; don't rewrite history.
- Real-time Docs-style co-editing needs a specialized OT/CRDT-like collaboration service, separate from ordinary whole-file upload/versioning.

## 9. Important Distributed-System Edge Cases

| Problem | Design / protection |
|---|---|
| Retry creates duplicate file/version | Idempotency key + durable request result |
| Two devices overwrite concurrently | Generation check / compare-and-swap; surface conflict |
| Blob saved but DB commit fails | Retry idempotently; reconcile unreferenced blobs later |
| DB commit succeeds but event publish fails | Transactional outbox + at-least-once delivery; consumers idempotent |
| Duplicate bytes in different files | Optional content-addressed dedup; keep logical IDs/ACLs separate; safe reference-based GC |
| Concurrent quota reservations | Atomic reservation: `used + reserved + request <= limit` |
| Delete races with offline edit | Tombstone + new generation; reject stale write or create conflict copy |
| Events arrive twice/out of order | Event IDs + generations/sequences; ignore duplicates/stale state |
| Permission revoked while URL is active | Short expiry or revocation-aware CDN authorization |
| Huge folders / hot shared drives | Cursor pagination, indexed listings, throttling, partition hot spots |
| Expired sync cursor | Full resync; don't discard unsynced local changes |

## 10. Consistency & Scalability Choices

**Strong/transactional where correctness matters:** file head/generation, permission changes, quota reservations, upload finalization.

**Eventually consistent/asynchronous:** search indexing, thumbnails/previews, notifications, analytics, some sync projections.

- Partition metadata by drive/tenant; watch for hot drives/folders.
- Object storage and CDN scale separately from metadata APIs.
- Use keyset/cursor pagination rather than large `OFFSET`s.
- Apply rate limits, bounded retries with exponential backoff + jitter, backpressure, dead-letter queues, and reconciliation jobs.
- Multi-region: define an authoritative write owner per partition or explicitly design conflict resolution; replication alone does not make writes globally consistent.

## 11. Useful API Sketch

- `GET /folders/{id}/children?cursor=...`
- `POST /upload-sessions` (idempotency key)
- `POST /upload-sessions/{id}/complete`
- `GET /files/{id}/download?revision=...`
- `GET /files/{id}/revisions`
- `POST /files/{id}/restore`
- `PATCH /files/{id}` (rename/move; expected generation)
- `POST /files/{id}/permissions`
- `DELETE /files/{id}/permissions/{permissionId}`
- `GET /changes?pageToken=...`

## 12. 30-Second Interview Summary

1. **Metadata DB** owns file/folder state, ACLs, quotas, and revision pointers.
2. **Object storage** holds immutable file bytes; clients upload directly with resumable multipart sessions.
3. **CDN** serves authorized downloads and supports byte-range resume.
4. **Change feed + cursor + tombstones** syncs devices reliably, even after offline periods.
5. **Immutable revisions + generation checks** prevent lost updates and enable restore.
6. **Permissions + short-lived access URLs** protect sharing; revocation and cache invalidation need careful design.
7. **Idempotency, transactional outbox, retries, and reconciliation** handle partial failures across DB, storage, and queues.

**Key phrase:** “Drive is not just file storage; it is a metadata, authorization, content delivery, sync, and versioning system with explicit correctness boundaries.”
