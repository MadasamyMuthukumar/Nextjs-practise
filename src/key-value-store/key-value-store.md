# Key-Value Store — System Design Interview Cheat Sheet

## 1. Architecture

```text
                         CLIENTS
                            |
                            v
                     Load Balancer
                            |
              +-------------+-------------+
              |             |             |
              v             v             v
          KV API Server  KV API Server  KV API Server
              \             |             /
               \            |            /
                +-----------+-----------+
                            |
                    Partition Router
                            |
                    Partition Metadata
                            |
        +-------------------+-------------------+
        |                   |                   |
        v                   v                   v
   Partition P1        Partition P2        Partition P3
        |                   |                   |
   +----+----+         +----+----+         +----+----+
   |         |         |         |         |         |
 Leader    Replica   Leader    Replica   Leader    Replica
   A       B,C         D       E,F         G       H,I
   |
   +--> WAL --> MemTable --> SSTables --> Compaction
```

## 2. Core design to remember

- **API:** `GET`, `PUT`, `DELETE`, optional `TTL` / `CAS`.
- **Partitioning:** `hash(key) -> logical partition`.
- Use **many logical partitions**, not `hash(key) % physical_servers`.
- **Replication:** typically 3 replicas per partition; spread across AZs/racks.
- **Consistency:** leader-based replication + quorum/consensus for strong consistency.
- **Write path:** `Client -> Router -> Partition Leader -> WAL -> Replicas -> Commit -> MemTable`.
- **Read path:** `Client -> Router -> Cache (optional) -> MemTable -> Bloom Filter/Index -> SSTable`.
- **Storage:** WAL for durability + MemTable in memory + immutable SSTables on disk.
- **Compaction:** merges SSTables and removes obsolete versions/tombstones when safe.
- **Delete:** use a **tombstone**, not immediate physical deletion.
- **TTL:** store `expiresAt`; check on read + background cleanup.
- **Versioning:** every update gets a version/logical sequence number.

## 3. Scaling

- Scale **horizontally** by adding nodes and moving logical partitions.
- Rebalance **online**: copy -> catch up writes -> switch ownership -> remove old copy.
- Monitor partition **QPS, size, CPU, disk, P99 latency**.
- Detect **hot keys / hot partitions**.
- Hot reads -> cache, request coalescing, replica reads where consistency allows.
- Hot writes -> logical key sharding / redesign when application semantics allow.

## 4. Failure handling

- **Node dies:** replica continues serving.
- **Leader dies:** elect/promote a healthy replica.
- **Replica comes back:** catch up before becoming healthy.
- **Network partition:** with strong consistency, minority side should reject writes.
- **Disk failure:** replace node and rebuild replica.
- **Metadata/control-plane failure:** use cached routing metadata for existing traffic.
- **Client timeout + retry:** make writes idempotent; use `requestId` for non-idempotent operations.

## 5. Important edge cases

- **Concurrent writes:** leader serializes writes; version numbers define order.
- **CAS:** `PUT only if version == expectedVersion`.
- **Cache stale:** update/invalidate cache after successful DB commit.
- **Cache stampede:** single-flight/request coalescing + jittered TTL.
- **Large values:** enforce max size; store very large blobs in object storage and keep a pointer.
- **Delete resurrection:** tombstones prevent stale replicas/SSTables from bringing old data back.
- **Overload:** bounded queues, backpressure, rate limits, load shedding.
- **Multi-key transactions:** avoid initially; cross-partition transactions add distributed coordination.
- **Range queries:** hash partitioning is poor; use range partitioning/indexing if range scans are a core requirement.

## 6. Interview trade-offs

| Decision | Why |
|---|---|
| Hash partitioning | Fast exact-key lookup + easy distribution |
| Logical partitions | Easier scaling/rebalancing |
| 3 replicas | Fault tolerance + majority quorum |
| Leader-based replication | Simpler ordering + strong consistency |
| LSM + WAL | High write throughput + durability |
| Cache | Lower read latency / DB load |
| No multi-key transactions initially | Keeps system simpler |

## 7. Requirement clarification — ask first

- What operations: GET / PUT / DELETE / TTL / CAS?
- Number of keys and average/max value size?
- Read QPS / write QPS?
- Latency target (P95/P99)?
- Strong or eventual consistency?
- Availability target?
- Durability requirement?
- Single-region or multi-region?
- Need range queries or multi-key transactions?

## 8. 30-second interviewer explanation

> "I'll build a distributed point-lookup KV store. Keys are hashed into many logical partitions, and each partition has three replicas across failure domains. A leader handles writes and replicates them through a durable WAL before committing. The storage engine uses a MemTable plus immutable SSTables with background compaction. Reads can use a cache, then MemTable and SSTable indexes/Bloom filters. Nodes can fail and replicas take over, while failed replicas catch up later. New nodes are added through online partition rebalancing. I'll keep single-key atomicity initially and add multi-region or multi-key transactions only if the requirements need them."

## 9. Memorize this flow

```text
KEY
 ↓
HASH
 ↓
PARTITION
 ↓
LEADER
 ↓
REPLICAS
 ↓
WAL + MEMTABLE
 ↓
SSTABLE
 ↓
COMPACTION
```
