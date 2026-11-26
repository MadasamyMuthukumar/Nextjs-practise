# Collaborative Editing — Interview Quick Notes

## 1. What problem do OT and CRDT solve?

In a collaborative editor, multiple users can edit the **same document at the same time**. Their operations may arrive in different orders because of network delay, reconnects, or different servers.

The system must make sure that users eventually see a consistent document without silently losing valid edits.

**Both Operational Transformation (OT) and Conflict-free Replicated Data Types (CRDTs) solve concurrent editing and convergence.** They use different approaches.

## 2. OT vs CRDT — core idea

| | OT (Operational Transformation) | CRDT (Conflict-free Replicated Data Type) |
|---|---|---|
| Main idea | Transform an operation based on concurrent operations that happened first | Use data structures and merge rules that allow concurrent changes to be combined |
| Mental model | “Change my operation based on yours.” | “Design the data so concurrent changes can merge.” |
| Common architecture | Often a central authority/sequencer orders operations | Can support multiple replicas accepting changes independently |
| Strength | Fits server-authoritative, mostly-online collaboration | Fits offline-first, local-first, and multi-master collaboration |
| Trade-off | Transformation rules become complex for rich-text features | Metadata, storage, and cleanup can be more complex |

Neither is always better. Choose based on product requirements and architecture, not simply total user count.

### Simple concurrent-edit example

Suppose the document contains `cat`.

- Alice inserts `A` at position 1.
- Bob inserts `B` at position 1 before receiving Alice's update.
- Both edits are valid, but both initially refer to the same position.

The collaboration algorithm must resolve the concurrent operations consistently. OT transforms one operation against the other; a CRDT uses stable identities/order metadata and merge rules so replicas converge.

## 3. When would you choose each?

### Choose OT when

- The system is primarily online.
- A central server can order document operations.
- A server-authoritative model is acceptable.
- You want a natural fit for a centrally coordinated editor.

### Choose CRDT when

- Users must edit offline and sync later.
- Users/devices may accept edits independently.
- Multi-region or peer-to-peer synchronization is important.
- Local-first behavior is a major product requirement.

**Interview tip:** Do not say “CRDT is always better” or “OT cannot scale.” Both can scale. The trade-offs are ordering, offline behavior, metadata, and operational complexity.

## 4. Multiple application servers behind a load balancer

Imagine Alice connects to WebSocket Server A and Bob connects to WebSocket Server B, but both edit `doc-123`.

The load balancer distributes connections. It does **not** solve collaboration ordering or document consistency.

### OT: route a document to one collaboration authority

A common design is to assign each document to one active collaboration worker/owner at a time.

```text
Alice ──> WebSocket Server A ──┐
                              ├──> Collaboration worker for doc-123
Bob   ──> WebSocket Server B ──┘          │
                                         ├── OT engine + document revision
                                         ├── durable operation log / snapshots
                                         └── broadcast updates to both users
```

- Both WebSocket servers forward operations for the same document to the same logical owner.
- The owner maintains the document revision/order and transforms operations against missed or concurrent operations.
- Ownership can be assigned by a document-to-worker mapping or consistent hashing, for example `hash(documentId) % N`.
- A message broker such as Kafka can help partition operations by `documentId`, preserving order within a partition. Redis Pub/Sub can help with routing/broadcasting, but it is not the OT algorithm itself.
- Persist operations and snapshots so a worker can recover after a crash.

**Important:** “Collaboration worker 7” is just an example name for a process, container, pod, or service instance. It is not a special product.

### CRDT: accept and synchronize replicas

```text
Alice ──> WebSocket/Region A ──> CRDT replica A ──┐
                                                 ├── sync / message bus
Bob   ──> WebSocket/Region B ──> CRDT replica B ──┘
```

- Each replica can accept valid CRDT updates locally.
- Updates are propagated to other replicas.
- CRDT merge rules make replicas converge when they receive the updates.
- A single document owner is not inherently required, but routing, persistence, synchronization, and failure recovery are still required.

### Why sticky sessions are not enough

Sticky sessions may keep a user's connection on one WebSocket server, but Alice and Bob can still land on different servers. A server can also fail. You still need shared collaboration state, routing/synchronization, and recovery.

## 5. Do we build OT/CRDT ourselves?

Usually **no**. Use a mature implementation unless implementing the algorithm is specifically the interview task or the collaboration engine is your product's core technology.

| Technology | What it gives you |
|---|---|
| **ShareDB** | Node.js real-time collaboration framework based on OT; supports document operations and pub/sub-based scaling |
| **Yjs** | CRDT library with shared types such as `Y.Doc`, `Y.Text`, `Y.Map`, and `Y.Array` |
| **Hocuspocus** | Collaboration server built around Yjs; handles WebSocket collaboration and can be scaled with shared infrastructure such as Redis |
| **Automerge** | CRDT/local-first data structures; `automerge-repo` provides repository, storage, and synchronization building blocks |
| **Liveblocks** | Hosted real-time collaboration infrastructure; can be used with Yjs |

Think in layers:

- **OT/CRDT:** the algorithm and data model.
- **ShareDB/Yjs/Automerge:** libraries/frameworks implementing collaboration primitives.
- **Hocuspocus or a ShareDB server:** collaboration runtime that handles connections, synchronization, and related server concerns.
- **Liveblocks:** hosted collaboration infrastructure.

### Where does it run?

- Small application: collaboration logic can run inside the main NestJS application.
- Growing/large application: separate the collaboration service from normal REST APIs so long-lived WebSocket connections and document synchronization can scale independently.
- The collaboration service can still be written in Node.js/TypeScript and integrated with a NestJS backend.

## 6. Users in India, US, and Europe — multi-region design

First ask: **Are users editing different documents, or the same document across regions?**

### Case A: Users mostly edit different documents

Assign each document a **home region** and route operations for that document there.

```text
 doc-1 -> US region
 doc-2 -> Europe region
 doc-3 -> India region
```

This keeps most collaboration traffic close to the users who own/edit that document and avoids replicating every document everywhere.

### Case B: Users in different regions edit the same document

**With OT:**

- Keep one authoritative ordering point for that document, often in its home region.
- Users connect to a nearby regional WebSocket/edge server, which forwards operations to the document authority.
- Apply edits optimistically in the client so typing feels responsive while the authoritative result travels over the network.
- Handle authority failover, durable logs, snapshots, and reconnect/replay carefully.

**With CRDT:**

- Regional replicas can accept updates locally and synchronize them across regions.
- This is attractive when local-first, offline, or multi-master editing matters.
- CRDT does not remove network latency or infrastructure work: replicas still need update propagation, persistence, access control, and recovery.

**Do not replicate every document to every region by default.** Replicate where cross-region collaboration or product requirements justify the storage, bandwidth, and operational cost.

## 7. Production concerns to mention

- **Ordering:** define how operations are ordered (especially for OT).
- **Durability:** persist operations and periodically create snapshots.
- **Recovery:** rebuild state from a snapshot plus later operations.
- **Idempotency:** detect duplicate operations after retries/reconnects.
- **Reconnect:** let clients resume from a known revision/state vector and catch up safely.
- **Fan-out:** broadcast updates to all users editing the document, including users connected to other WebSocket servers.
- **Presence:** manage cursors, selections, and online status separately from durable document content where appropriate.
- **Backpressure:** prevent slow clients from exhausting memory or blocking the collaboration service.
- **Security:** authorize access to each document and validate operations.
- **Failover:** ensure a document owner/region can be replaced without losing acknowledged edits.

## 8. Strong interview answer

> I would separate WebSocket connection handling from document collaboration. The load balancer can send users to different WebSocket servers, but all operations for a document must still be coordinated. With OT, I would typically route a document to one active collaboration authority that maintains revisions and transforms concurrent operations. With CRDT, regional replicas can accept updates independently and synchronize them, which is useful for offline-first or multi-master collaboration. For global users, I would use nearby connection endpoints, assign documents to home regions where possible, and replicate only documents that need cross-region editing. I would also cover optimistic local updates, durable operation logs, snapshots, idempotency, reconnect, fan-out, and failover.

## 9. Quick memory points

- **OT:** transform operations; commonly uses a central ordering authority.
- **CRDT:** merge concurrent updates using data structures with defined convergence rules.
- **Load balancer:** routes connections; it does not coordinate edits.
- **Document partitioning:** route the same document to the same OT authority.
- **Kafka key = documentId:** can preserve per-document ordering within a partition.
- **Redis Pub/Sub:** useful for cross-instance broadcast/routing, not a replacement for OT/CRDT.
- **Sticky sessions:** useful for connection affinity, not sufficient for collaboration correctness.
- **Multi-region:** home region + OT authority is straightforward; CRDT replicas are natural for multi-master/local-first needs.
- **Scale by documents and collaboration workload**, not only by number of registered users.
- **Use libraries** (ShareDB, Yjs, Automerge, Hocuspocus) rather than writing a production algorithm from scratch.

## 10. One-line decision rule

- **Mostly online + central authority acceptable → consider OT.**
- **Offline/local-first + independent replicas or multi-master → consider CRDT.**

The final choice also depends on rich-text requirements, library maturity, expected document size, concurrency, persistence, and operational experience.
