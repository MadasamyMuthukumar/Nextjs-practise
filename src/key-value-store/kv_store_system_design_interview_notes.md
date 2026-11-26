# Distributed Key-Value Store — System Design Interview Quick Notes

A quick revision sheet for designing a **highly scalable, production-friendly distributed key-value store**.

---

## 1. What are we building?

A key-value store supports operations such as:

```text
PUT(key, value)
GET(key)
DELETE(key)
```

Useful optional features:
- TTL / expiration
- Conditional writes (CAS: compare-and-set)
- Batch get/put
- Range scans (only if required)

Example:

```text
PUT user:123, {"name":"Maddy"}
GET user:123  -> {"name":"Maddy"}
DELETE user:123
```

## 2. Clarify requirements first

Ask the interviewer:

**Functional**
- Do we need only GET/PUT/DELETE?
- Do we need TTL, CAS, batch operations, or range queries?
- Are values small (KBs) or can they be large (MBs/GBs)?

**Non-functional**
- Expected QPS and read/write ratio?
- Average and maximum key/value size?
- Single-region or multi-region?
- Required consistency: eventual, read-after-write, or strong/linearizable?
- Durability: must an acknowledged write survive a machine crash?
- Latency target, availability target, and retention period?

If the interviewer leaves the scale open, state reasonable assumptions before designing. Example: 1M QPS, 70% reads / 30% writes, ~1 KB average value, durable writes, TTL support, and high availability.

## 3. High-level architecture

```text
Clients
   |
Load Balancer
   |
Stateless Coordinator / Router
   |  hash(key) -> logical partition
   v
Partition Map / Metadata
   |
   +------ Partition P1: Replica A, B, C
   +------ Partition P2: Replica B, C, D
   +------ Partition P3: Replica A, D, E

Each storage node:
WAL -> Memtable -> SSTables -> Compaction
```

Core responsibilities:
1. **Partitioning** — decide where each key belongs.
2. **Replication** — keep multiple copies for availability and durability.
3. **Storage engine** — persist writes efficiently and recover after crashes.
4. **Consistency and repair** — manage replica differences.
5. **Operations** — rebalance, monitor, back up, and recover.

## 4. Partitioning: where does a key live?

Basic approach:

```text
partition = hash(key) % number_of_partitions
```

Avoid relying on `hash(key) % number_of_nodes`: adding/removing a node can remap many keys.

Instead:
- Create many **logical partitions** (for example, hundreds or thousands).
- Hash each key to a partition.
- Maintain metadata mapping each partition to its replica nodes.
- Assign/move partitions between physical nodes as the cluster grows.

Example:

```text
hash("user:123") -> P731
P731 -> Node A, Node B, Node C
```

This makes rebalancing incremental. Consistent hashing or a partition-token scheme can help distribute partitions; virtual nodes/partitions help balance load.

## 5. Replication and quorum

Use a replication factor such as **N = 3**, with replicas placed across different machines / availability zones.

For a tunable quorum design:
- **W** = number of replicas that must acknowledge a write.
- **R** = number of replicas queried for a read.
- A common configuration is `N=3, W=2, R=2`.
- `R + W > N` makes read and write quorums overlap.

Important: quorum overlap **does not by itself guarantee linearizability**. Concurrent writes, sloppy quorums, replica failures, and conflict resolution still matter.

For strict linearizable consistency, prefer a **leader per partition with a consensus protocol such as Raft**.

## 6. Storage engine: WAL + LSM tree

A common write-optimized storage design is an LSM-tree.

### Write path on each replica

```text
Write request
    |
Append to WAL (durable log; fsync according to durability policy)
    |
Update in-memory Memtable
    |
Memtable fills -> flush sorted data to immutable SSTable files
    |
Background compaction merges SSTables
```

- **WAL (Write-Ahead Log):** records mutations before acknowledging them, so the node can recover after a crash.
- **Memtable:** in-memory sorted structure for recent writes.
- **SSTable:** immutable, sorted on-disk file created when a memtable is flushed.
- **Compaction:** merges SSTables, reduces old versions, and eventually removes obsolete tombstones when safe.

If the process crashes after WAL append but before updating the memtable, replay the WAL during recovery.

### Read path on a storage node

```text
GET key
  -> check Memtable
  -> check block cache
  -> use Bloom filters to skip SSTables that definitely do not contain key
  -> search likely SSTables
  -> choose the newest valid version
```

A Bloom filter can say **definitely absent** or **possibly present**. It can have false positives, but not false negatives when correctly implemented.

## 7. Write and read flow

### PUT
1. Coordinator hashes the key and finds its partition and replicas.
2. Send the write to the replicas.
3. Each replica appends to its WAL and updates its Memtable.
4. Wait for the configured write acknowledgements (for example, W=2 of 3).
5. Return success; flush to SSTables and compact in the background.
6. A failed replica catches up later through repair or log/snapshot transfer.

**Durability rule:** acknowledge only after the required replicas have durably recorded the write, according to the chosen WAL/fsync policy.

### GET
1. Hash the key and locate its partition replicas.
2. Query the required replica(s) / read quorum.
3. Each replica checks memory/cache and then SSTables.
4. Compare versions and apply the defined consistency/conflict policy.
5. Return the appropriate value; repair stale replicas when applicable.

## 8. Versions, conflicts, and concurrent writes

Store metadata alongside values, conceptually:

```text
key | value | version | expiresAt | tombstone
```

Two clients may concurrently update the same key. Define what happens:
- **CAS/version check:** update only if the version still equals the one read.
- **Last-write-wins:** simple, but timestamp-based ordering can be wrong if clocks are skewed.
- **Logical versions / hybrid logical clocks (HLC):** can help order updates without relying solely on wall-clock time.
- **Application conflict resolution / CRDTs:** for workloads that need mergeable concurrent updates.

For a leader-based, strongly consistent partition, the leader/consensus log establishes a committed order.

## 9. Delete and TTL

### Delete: use a tombstone

Do not immediately erase the record from one replica. Write a versioned tombstone:

```text
user:123 -> TOMBSTONE, version=20
```

It prevents an old replica from reintroducing an older value. Remove tombstones only after the system can safely establish that replicas have seen the deletion (retention/repair policy).

### TTL

Store an `expiresAt` timestamp. Reads treat an expired key as absent; background cleanup/compaction physically removes it later. Expiration may not happen at the exact millisecond on disk.

## 10. Replica failures and repair

With `N=3, W=2`, one replica can be down while two healthy replicas acknowledge a write.

Ways to catch up a recovered replica:
- **Hinted handoff:** another node temporarily records mutations intended for the unavailable replica, then forwards them when it returns.
- **Read repair:** a read detects stale replicas and updates them.
- **Anti-entropy repair:** replicas periodically compare partition summaries (for example, Merkle trees) and synchronize differences.
- **Snapshot + change-log/WAL streaming:** useful when a replica is far behind.

Restore the intended replication factor promptly. Running degraded for a long time increases the risk of data loss if another replica fails.

## 11. Rebalancing when nodes are added/removed

Move logical partitions gradually, not the whole database at once.

```text
1. Assign target partition to a new node
2. Copy a consistent snapshot
3. Stream changes made after the snapshot (WAL/change log)
4. Wait until destination catches up
5. Update partition metadata / route traffic to new owner
6. Retire old copy after it is safe
```

Throttle transfers so rebalancing does not overwhelm foreground reads/writes, disk, or network.

## 12. Hot keys vs hot partitions

**Hot partition:** many different keys overload one partition. Rebalance partitions, improve partition distribution, or split the partition.

**Hot key:** one key receives huge traffic. Moving its partition does not solve the problem because the same key still maps to one partition.

- Hot reads: cache, local replicas/read copies, request coalescing (single-flight), or CDN where suitable.
- Hot writes: key decomposition/sharding (for example, `counter:views:0..99`) and aggregate later, or use a specialized counter/single-writer design.

Key splitting changes the data model and adds aggregation/consistency complexity.

## 13. Network partitions and consistency choice

During a network partition, nodes cannot communicate reliably. You must choose behavior:
- **Availability-oriented / eventual consistency:** continue serving some requests and reconcile later; reads may be stale or writes may conflict.
- **Strong consistency:** require the appropriate quorum/consensus; some requests may fail or wait when a majority is unavailable.

Do not claim a system provides both strong consistency and full availability during every partition.

For multi-region systems, asynchronous replication gives lower local latency but can expose stale reads/conflicts. Globally strong writes require coordination across regions and increase latency.

## 14. Important edge cases and practical decisions

| Scenario | Typical handling |
|---|---|
| Client times out and retries PUT | Make ordinary PUT idempotent; use request IDs for non-idempotent operations such as increments |
| Coordinator crashes | Keep coordinators stateless; client retries through another coordinator; define request retry semantics |
| Two clients update same key | CAS/version checks, leader ordering, or explicit conflict policy |
| Very large value (e.g. hundreds of MB) | Enforce size limit; store object in object storage and keep a pointer in KV store |
| Batch spans multiple partitions | Fan out requests; explain that batching is not automatically an atomic transaction |
| Atomic update across two keys | Prefer single-partition transactions; cross-partition transactions require extra coordination (e.g. 2PC) |
| Disk nearly full | Alert early, control writes, clean up/compact, add capacity, rebalance; never wait for 100% |
| Compaction falls behind | Monitor compaction debt; throttle writes/background work or add disk/CPU capacity |
| Accidental mass delete/corruption | Restore from snapshots and incremental logs; replication is not a backup |
| Rack/AZ outage | Place replicas in separate failure domains |
| Tenant overload | Apply per-tenant quotas, rate limits, and resource isolation |

## 15. Capacity estimation example

Assume:
- 1,000,000 requests/sec
- 30% writes
- Average value = 1 KB

Then:

```text
Writes/sec = 1,000,000 * 0.30 = 300,000
Logical write throughput ~= 300,000 KB/sec ~= 300 MB/sec
Daily logical data ~= 300 MB * 86,400 ~= 25.9 TB/day
With RF=3, replicated write volume ~= 77.7 TB/day
```

This is a rough estimate. Real capacity must also account for keys, metadata, WAL, indexes, compaction/write amplification, replication protocol overhead, deletes, compression, and retention. Node count should be based on benchmarked sustainable throughput with spare capacity for failures and rebalancing—not just peak theoretical QPS.

## 16. Monitoring, backups, and security

**Monitor:** QPS, p50/p95/p99 latency, errors/timeouts, per-partition QPS/size, hot keys, disk/memory, WAL fsync latency, SSTable count, compaction backlog, replication lag, repair backlog, and rebalance progress.

**Backups:** periodic snapshots + incremental logs/WAL for point-in-time recovery. Test restores. Replication is not backup because accidental deletes are replicated too.

**Security:** TLS, authentication, authorization, encryption at rest, audit logs, rate limits, and per-tenant quotas.

---

## 17. Likely interviewer cross-questions — quick answers

**Why not `hash(key) % node_count`?**  Adding/removing nodes remaps many keys. Use many logical partitions and move only selected partitions.

**Why RF=3?**  It provides multiple copies and can tolerate a replica failure while preserving service, depending on quorum policy and failure-domain placement.

**Does `R + W > N` guarantee strong consistency?**  No. It creates quorum overlap under assumptions, but does not alone guarantee linearizability. Use per-partition consensus/leader for strict semantics.

**Why WAL before Memtable?**  WAL supports crash recovery. Replay it if memory state is lost.

**Why SSTables and compaction?**  Immutable sorted files make writes efficient; compaction controls the number of files and old versions.

**Why tombstones?**  They stop stale replicas from resurrecting deleted values.

**How do you handle a dead replica?**  Continue only if the consistency/quorum policy permits; restore it with hints, repair, or snapshot plus log streaming.

**How do you handle a hot key?**  Cache/coalesce hot reads; split write-heavy keys or use a specialized data model. Rebalancing alone does not fix a single hot key.

**How do you add nodes safely?**  Snapshot, stream concurrent changes, catch up, switch routing metadata, then remove the old copy.

**Can a batch be atomic?**  Not automatically. Cross-partition atomicity requires a transaction protocol.

**Is replication a backup?**  No. Replication copies mistakes too; use snapshots and point-in-time recovery.

**What if strict consistency is required?**  Use a leader per partition with Raft/consensus and accept that writes may be unavailable when a majority cannot be reached.

---

## 18. Five-minute interview answer structure

1. **Clarify:** operations, TTL/CAS/range queries, QPS, value size, regions, durability, latency, consistency.
2. **Partition:** hash key to one of many logical partitions; map partitions to nodes.
3. **Replicate:** use RF=3 across failure domains; define read/write acknowledgement policy.
4. **Persist:** WAL -> Memtable -> SSTables -> compaction; Bloom filters and block cache speed reads.
5. **Read/write:** route by key, contact replicas, use versions and the selected consistency policy.
6. **Recover:** WAL replay, hinted handoff, read repair, anti-entropy, snapshots.
7. **Scale:** move partitions using snapshot + change stream + cutover.
8. **Protect:** handle hot keys, retries, tombstones, TTL, large values, backups, monitoring, and quotas.

### 30-second write-path explanation

> "The coordinator hashes the key to a logical partition and finds its replicas. Each replica appends the mutation to its durable WAL and updates its Memtable. Once the configured write acknowledgements arrive, the coordinator returns success. Memtables are later flushed to immutable SSTables and compacted in the background. A failed replica catches up through repair or snapshot and log streaming."

### 30-second read-path explanation

> "The coordinator routes the key to its partition replicas. Each replica checks its Memtable/cache and then SSTables, using Bloom filters to avoid unnecessary disk reads. The coordinator applies the selected consistency and version-resolution policy, returns the result, and repairs stale replicas when appropriate."

## Final mental model

```text
WHERE is the key?                 -> Partitioning
What if a machine fails?          -> Replication
How are writes persisted?        -> WAL + Memtable + SSTables
How do replicas agree?            -> Consistency + versions + repair
How do we grow the cluster?       -> Partition rebalancing
How do we survive human mistakes? -> Backups + point-in-time recovery
```

**Interview tip:** explain the design principles first. Mention technologies (Redis, Cassandra, RocksDB, etc.) only when useful; do not substitute product names for the reasoning behind the architecture.
