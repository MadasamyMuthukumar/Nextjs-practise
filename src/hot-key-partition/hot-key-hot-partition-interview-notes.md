# Hot Key & Hot Partition — System Design Quick Notes

## 1. Core idea

- **Hot key:** One specific key receives a disproportionate amount of traffic.
- **Hot partition:** One database/cache/broker partition receives much more traffic than others.
- A hot key can create a hot partition, but a hot partition can also be caused by many popular keys or a poor partitioning strategy.
- **Adding more partitions alone does not fix one hot key** if every request for that key still routes to the same partition.

Example: Millions of users read `post:123`. Since `hash(post:123)` always maps to the same shard, that shard becomes overloaded.

## 2. First diagnose the workload

Ask these questions before choosing a solution:

1. Is it one hot key or many keys concentrated on one partition?
2. Is the workload **read-heavy**, **write-heavy**, or both?
3. Can the data be slightly stale, or does it require strong consistency?
4. Is the spike temporary, or is traffic constantly above capacity?

## 3. Solutions to know

| Problem | Common solution | Main idea |
|---|---|---|
| Read-heavy hot key | Cache, read replicas, local cache, CDN | Serve repeated reads without hitting the primary database each time. |
| Write-heavy counter | Key salting / write sharding | Split one counter into multiple independent buckets. |
| Sudden write burst | Queue or event stream + consumers | Buffer events and process at a controlled rate. |
| Many hot keys on one shard | Rebalance / split partition / dedicated shard | Move keys or isolate high-volume tenants. |
| Sequential inserts hit latest range | Hash/composite shard key | Spread new writes across partitions. |
| System is overloaded | Rate limiting, backpressure, load shedding | Protect downstream services and control admission. |

### A. Read-heavy hot key — cache it

Example: Millions of users view the same celebrity post.

- Use Redis or another cache for frequently read data.
- Add read replicas where appropriate; route reads across replicas.
- Use per-instance in-memory cache for very hot, stable data.
- Use a CDN for public static content such as images and videos.
- Handle **cache stampedes** with request coalescing/single-flight, TTL jitter, or stale-while-revalidate.
- Remember: replicas and caches can serve slightly stale data; choose based on consistency needs.

### B. Write-heavy hot key — split the key

Example: Millions of likes increment one post's `likes_count` row. That single row becomes a write bottleneck.

Instead of one counter:

```text
post:123:likes = 1,000,000
```

Create multiple buckets:

```text
post:123:likes:0
post:123:likes:1
...
post:123:likes:63
```

Choose a bucket using a stable hash, for example:

```ts
bucket = hash(userId) % 64;
INCR(`post:${postId}:likes:${bucket}`);
```

- Writes now spread across many keys/buckets.
- Read the total by summing buckets, or periodically maintain a materialized total.
- Choose the bucket count based on measured load; more buckets mean more aggregation work.
- Make likes idempotent: a user retrying or clicking repeatedly must not create duplicate likes. Store/enforce uniqueness for `(postId, userId)` and increment only for a newly accepted like.
- For important counters, use durable events and reliable aggregation; do not rely on a fragile in-memory counter.

### C. Traffic bursts — queue and process asynchronously

Flow:

```text
Client -> API -> Durable queue/stream -> Consumers -> Sharded counters / DB
```

- A queue (e.g. Kafka, SQS, Pub/Sub) absorbs short spikes and decouples API traffic from database writes.
- Consumers process at a controlled rate; monitor queue depth and consumer lag.
- Use idempotent consumers because events may be delivered more than once.
- **Important:** A queue does not automatically remove a hot partition. If all events use `postId` as the partition key, one popular post may still overload one broker partition. For independent events, distribute by a key such as `hash(postId + userId)` and aggregate downstream.
- If arrival rate stays above processing capacity, backlog grows indefinitely. Add capacity, rate-limit, or reject/defer excess work.

### D. Hot partition — rebalance or redesign the shard key

- If many hot keys land on one partition, split/rebalance the partition or move high-volume tenants to dedicated shards.
- Consistent hashing and virtual nodes can help distribute keys more evenly.
- If range partitioning sends every new sequential ID to the latest range, use hash or composite partitioning to spread writes.
- Trade-off: hash partitioning can make range queries (such as time/order ranges) more expensive.
- Moving one hot key to another partition does **not** fix it; that key is still a single hotspot. Split its workload (e.g. counter buckets) or replicate reads.

## 4. Important special case: ticket inventory

Do **not** blindly shard or duplicate inventory counters for reserved seats.

- A seat must never be sold twice.
- Use atomic conditional reservation, e.g. change a seat from `AVAILABLE` to `HELD` only if it is still available.
- Give holds an expiry; confirm after payment or release when the hold expires.
- Use idempotency keys for booking/payment retries.
- For general-admission inventory, allocate fixed quantities to independent buckets (escrow-style). The sum of bucket allocations must never exceed total inventory.
- A waiting room/admission control and rate limiting can protect the booking service during a huge sale.

## 5. Detecting hot keys / partitions

Monitor:

- Requests and read/write QPS per partition.
- Key-level traffic (use sampling or heavy-hitter detection to avoid high-cardinality metrics for every key).
- CPU, memory, connections, and storage I/O per partition.
- P95/P99 latency, timeouts, and lock-wait time.
- Queue depth and consumer lag.

Example: if three partitions receive ~10k requests/sec and one receives 500k/sec, investigate that partition's hottest keys and access pattern.

## 6. Interview decision flow

1. **Identify:** one hot key, many hot keys on one partition, or bad shard-key design?
2. **Classify:** read-heavy or write-heavy?
3. **Check correctness:** can the data be stale or eventually consistent, or must updates be strictly coordinated?
4. **Choose:**
   - Reads -> cache / replicas / local cache / CDN.
   - Counter writes -> key salting / write sharding + aggregation.
   - Bursts -> durable queue + controlled consumers.
   - Partition imbalance -> split / rebalance / dedicated shard.
   - Sequential writes -> change partition key.
5. **Protect:** idempotency, rate limiting, backpressure, retries with exponential backoff, and load shedding.
6. **Verify:** monitor partition load, P99 latency, lock waits, and queue lag.

## 7. Interview answer (speakable)

> I would first identify whether the issue is one hot key or an overall partition imbalance, then determine whether the workload is read-heavy or write-heavy. For read-heavy keys, I would use caching, read replicas, local caches, or a CDN, while handling cache stampedes and accepting staleness only where appropriate. For write-heavy counters, I would use key salting or write sharding to split one counter into multiple buckets and aggregate the results. For sudden bursts, I would buffer events in a durable queue and process them with controlled, idempotent consumers. If many keys overload one partition, I would rebalance, split the partition, or isolate high-volume tenants. I would also use rate limiting and backpressure, monitor per-partition metrics, and preserve business consistency—for example, ticket inventory needs atomic reservations and cannot be naively duplicated.

## 8. Memory shortcut

- **Hot reads -> cache / replicate.**
- **Hot writes -> split the write workload.**
- **Hot partition -> rebalance / redesign partitioning.**
- **Traffic burst -> queue + backpressure.**
- **Critical business invariant -> preserve correctness while scaling.**
