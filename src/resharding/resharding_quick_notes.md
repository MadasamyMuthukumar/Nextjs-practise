# Database Sharding & Online Resharding — Interview Quick Notes

> **Core idea:** Keep data placement stable at the logical level. When servers change, move logical partitions between physical databases instead of changing `hash(key) % physicalShardCount`.

## 1. Why resharding is needed

A shard stores only part of the total dataset. Over time, a shard may become too large, too busy, or need to be removed.

Naive routing:

```ts
shard = hash(userId) % numberOfShards;
```

Changing from `% 3` to `% 6` remaps many keys. The application may start reading a new shard while the row still exists on the old shard. The hash calculation changes the *expected location*; it does not physically move the data.

## 2. Placement strategies

| Strategy | How it works | Main benefit | Main drawback |
|---|---|---|---|
| Modulo hashing | `hash(key) % N` | Simple, spreads keys | Changing `N` remaps many keys |
| Range sharding | Key ranges belong to shards | Good range-query locality | Uneven ranges / hot shards |
| Consistent hashing | Keys and nodes are placed on a hash ring; a key goes to the next node clockwise | Adding/removing a node moves only part of the keyspace | Can be uneven without virtual nodes |
| Virtual shards / buckets | Hash key to a fixed number of logical buckets; map each bucket to a physical DB | Easy, controlled rebalancing | Need a bucket-to-shard map |
| Directory mapping | A directory explicitly maps tenant/key/bucket to a physical DB | Flexible; can move individual tenants/buckets | Directory must be reliable and cached |

### Virtual shards: the important pattern

Example: keep 1,024 logical buckets regardless of physical DB count.

```text
userId --hash--> bucket (0..1023) --directory--> physical DB

Initially:  DB1 owns V0..V255; DB2 owns V256..V511; ...
After scale: move selected virtual buckets to new DBs.
```

The hash/bucket calculation stays fixed. Only the directory changes:

```text
Before: V729 -> DB2
After:  V729 -> DB5
```

A virtual bucket is a logical partition, **not** a physical database. Virtual buckets make it possible to move manageable chunks of data.

### Consistent hashing vs virtual buckets

- **Consistent hashing** is a placement algorithm that reduces key movement when nodes change.
- **Virtual nodes/buckets** improve balance and make smaller partitions movable.
- **Directory mapping** records which physical node currently owns each logical partition.
- These ideas can be combined; they are not mutually exclusive.

## 3. Adding or removing physical shards

### Add three shards

1. Add DB4, DB5 and DB6.
2. Choose virtual buckets to rebalance from existing DBs to the new DBs.
3. Create migration records and copy those buckets.
4. Keep the old owner authoritative during copying; stream changes to the target.
5. Validate, cut over routing, drain old copies, then clean up.

Only selected buckets move. Do not change the fixed bucket count/hash formula just because physical DB count changed.

### Remove one shard

1. Mark the DB as `DRAINING`; do not assign new buckets to it.
2. List all buckets it owns.
3. Select destination DBs and migrate those buckets using the same process.
4. Cut over each bucket after it is synchronized and validated.
5. Confirm no traffic/data remains, then decommission the DB.

Adding and removing shards are both bucket rebalancing operations.

## 4. Online resharding: snapshot + CDC + cutover

**Online resharding** moves data while the application continues serving traffic.

Example: move bucket V729 from DB2 to DB5.

```text
                 Historical data
DB2 ----------------------------------> DB5
 |
 | database transaction log (WAL/binlog)
 v
 CDC tool -----------------------------> DB5
                 Live changes
```

There are two pipelines:

- **Snapshot / bulk copy:** copies rows that already exist.
- **CDC (Change Data Capture):** copies INSERT, UPDATE and DELETE operations that happen while the snapshot is running.

Without CDC, a row could be copied as `balance=100`, then updated on the source to `balance=200` while the target remains at 100.

### Typical migration states

```text
PLANNED -> PREPARING -> COPYING -> CATCHING_UP
        -> READY -> CUTOVER -> DRAINING -> COMPLETED
```

A migration may also enter `FAILED` and then resume/retry from a durable checkpoint.

### Practical sequence

1. **Plan:** choose bucket, source DB and target DB.
2. **Prepare CDC:** establish a replication/log position so changes during the copy are not missed.
3. **Snapshot:** copy existing bucket rows in small chunks (not all rows into memory).
4. **Capture changes:** CDC reads the source transaction log and streams changes to the target.
5. **Catch up:** wait until the target has applied all changes up to the required source log position.
6. **Validate:** compare row counts, checksums or samples; check CDC lag and errors.
7. **Cut over:** change the bucket's owner in the shard directory.
8. **Drain:** handle stale routers/requests that still point to the old DB.
9. **Clean up:** delete old bucket data only after the safety period and validation.

## 5. What is CDC? Do we build it?

Usually, **use an existing CDC tool**. Do not build a WAL/binlog parser unless there is a special reason.

For PostgreSQL, committed changes are recorded in the **WAL (Write-Ahead Log)**. Logical decoding/replication exposes row changes to CDC tools.

Common choices:

| Option | Typical use |
|---|---|
| PostgreSQL logical replication | PostgreSQL-to-PostgreSQL replication when its capabilities fit the migration |
| Debezium + Kafka | Flexible CDC event stream; useful when Kafka/event streaming already exists |
| AWS DMS | Managed AWS migration/replication, including full load + CDC |

A typical Debezium flow:

```text
PostgreSQL WAL -> Debezium connector -> Kafka topic -> CDC consumer -> target DB
```

CDC events represent operations such as INSERT, UPDATE and DELETE. A consumer applies them to the target. The CDC tool tracks log positions/offsets so it can resume after a restart, provided required source logs are still retained.

**Important:** PostgreSQL replication slots can retain WAL while a CDC consumer is behind. Monitor replication-slot lag and disk usage; an abandoned slot can fill storage.

## 6. Queue vs CDC — do not confuse them

| Tool/pattern | What it carries | Example |
|---|---|---|
| SQS / RabbitMQ / BullMQ | Work to perform | `Copy bucket 729, chunk 1..10000` |
| Kafka CDC topic | Database changes that occurred | `user 42 was updated` |

They can be used together:

```text
Coordinator -> SQS copy jobs -> migration workers -> bulk copy
Source DB -> WAL -> Debezium -> Kafka -> CDC consumers -> apply changes
```

- Queue workers are useful for parallel chunk-copy jobs, retries and backpressure.
- CDC is the live change stream; it is not simply an application job queue.

## 7. What does the migration coordinator do?

The coordinator is a **control-plane service**. It plans and tracks migrations; it should not copy millions of rows itself.

Responsibilities:

- choose buckets and destination shards;
- create migration records and copy jobs;
- start/monitor snapshot and CDC;
- track checkpoints and CDC progress;
- validate target data;
- coordinate cutover and cleanup;
- retry/resume failed work.

Example metadata:

```text
shard_map
---------
bucket_id | owner_db | map_version
729       | DB2      | 100

shard_migrations
----------------
migration_id | bucket_id | source | target | state       | epoch
M1001        | 729       | DB2    | DB5    | CATCHING_UP | 101
```

The coordinator can be replicated. Use durable DB state plus a lease/lock so another coordinator instance can take over if one crashes. Workers should be stateless/restartable and save progress checkpoints.

## 8. Consistency and safe cutover

During migration, define one authoritative owner:

| Phase | Authoritative for application writes | Target |
|---|---|---|
| Before / during copy | Source DB | Snapshot + CDC replica/copy |
| After cutover | Target DB | New owner |

Avoid naive dual writes: source write may succeed while target write fails. Snapshot + CDC avoids making every application request synchronously write to both databases.

### Cutover options

**Simple and interview-friendly:** briefly pause writes for the bucket only, let CDC drain, verify target is caught up, update the shard map, then resume writes to the target.

**For stricter zero-write-pause designs:** use versioned routing and fencing/epoch tokens. After ownership changes, the old DB must reject or redirect stale writes. A stale router must not be allowed to keep writing to the former owner.

Example:

```text
Before: V729 -> DB2, epoch 100
After:  V729 -> DB5, epoch 101
```

Routers cache the shard map and refresh on version changes. The old owner rejects/forwards requests carrying an outdated epoch. Do not let both DBs independently accept authoritative writes.

## 9. Failure handling and operational checks

- **Worker crashes:** resume from saved chunk/checkpoint; make copy jobs idempotent.
- **Duplicate queue/CDC delivery:** use idempotent upserts and safe event application.
- **CDC consumer crashes:** resume from saved offset/LSN; ensure source logs are retained.
- **Target DB unavailable:** keep source authoritative; pause/retry migration.
- **CDC lag too high:** do not cut over; monitor until caught up.
- **Wrong/stale routing map:** use map versions and fencing; refresh router caches.
- **Data correctness:** compare row counts, checksums, samples and deletes/updates—not only inserts.
- **Ordering:** preserve transaction/order semantics required for the same key/row; partition CDC processing appropriately.
- **Schema/indexes:** ensure target schema, indexes, constraints and related tables are ready.
- **Cleanup:** never delete source data immediately after changing the map; drain and validate first.

## 10. Interview-ready answer

> I would avoid changing `hash(key) % physicalShardCount`, because it remaps many keys. I would hash each shard key to a fixed number of virtual buckets and maintain a directory mapping each bucket to a physical database. When adding or removing DBs, I would rebalance selected buckets.
>
> For each bucket migration, a coordinator records the source, target and state, then schedules chunk-copy jobs through a queue. The source remains authoritative while workers copy the snapshot. CDC—such as PostgreSQL logical replication, Debezium with Kafka, or AWS DMS—streams changes from the source transaction log to the target. Once CDC catches up and data is validated, I cut over the bucket using a versioned shard map and a short write pause or fencing tokens. Then I drain stale traffic and delete the old copy safely.

## 11. Last-minute memory aid

**Placement:** `Hash key -> Virtual bucket -> Shard directory -> Physical DB`

**Migration:** `Plan -> Snapshot -> CDC -> Catch up -> Validate -> Cutover -> Drain -> Cleanup`

**Tool distinction:** `Queue = copy jobs`; `CDC = database changes`.

**Golden rule:** During migration there may be two copies, but there must be one clearly defined authoritative owner for writes.
