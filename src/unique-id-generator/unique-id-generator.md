# Distributed Unique ID Generator — Interview Cheat Sheet

## 1. Recommended Design

Use a **Snowflake-style distributed ID generator**.

### Goals
- Globally unique IDs
- Very high throughput
- Low latency
- No DB/Redis call for every ID
- Horizontally scalable
- Roughly time-ordered IDs
- Multi-region friendly

---

## 2. Production Architecture

```text
                         ┌──────────────────────────┐
                         │       CONTROL PLANE      │
                         │                          │
                         │  etcd / ZooKeeper /     │
                         │  Consul                 │
                         │  Worker ID + Lease      │
                         └────────────┬─────────────┘
                                      │
                         startup / renew only
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
   ┌──────────────┐            ┌──────────────┐            ┌──────────────┐
   │ Generator A  │            │ Generator B  │            │ Generator C  │
   │ Worker = 12  │            │ Worker = 13  │            │ Worker = 14  │
   │              │            │              │            │              │
   │ local memory │            │ local memory │            │ local memory │
   │ timestamp    │            │ timestamp    │            │ timestamp    │
   │ sequence     │            │ sequence     │            │ sequence     │
   └──────┬───────┘            └──────┬───────┘            └──────┬───────┘
          │                           │                           │
          │ generate locally          │ generate locally          │
          └─────────────────────┬─────┴─────────────────────┬─────┘
                                │                           │
                                ▼                           ▼
                         Application Services
                    Orders / Users / Payments / etc.
                                │
                                ▼
                             Database

       IMPORTANT: No network/database call on every ID generation.
```

---

## 3. ID Structure

Typical 64-bit Snowflake layout:

```text
┌──────────────┬───────────────┬──────────────┐
│  Timestamp   │   Worker ID   │   Sequence   │
│    41 bits   │    10 bits    │    12 bits   │
└──────────────┴───────────────┴──────────────┘
```

### What each part does

**Timestamp (41 bits)**
- Gives approximate chronological ordering.
- Usually store `currentTime - customEpoch`.

**Worker ID (10 bits)**
- Identifies the generator node.
- `2^10 = 1024` workers.

**Sequence (12 bits)**
- Makes IDs unique when one worker generates many IDs in the same millisecond.
- `2^12 = 4096` IDs/ms/worker.

---

## 4. Core Formula

```text
ID =
(timestamp << 22)
| (workerId << 12)
| sequence
```

Why `22`?

```text
worker bits   = 10
sequence bits = 12

10 + 12 = 22
```

Conceptually:

```text
Timestamp              Worker         Sequence
[...................] [..........] [............]
        41 bits           10 bits       12 bits
```

---

## 5. Example

Suppose:

```text
timestamp = 1000
workerId  = 5
sequence  = 7
```

Then:

```text
ID = (1000 << 22)
   | (5 << 12)
   | 7
```

Each server has a different worker ID, so two servers can generate IDs independently.

---

## 6. Generation Algorithm

```text
generate():

    now = currentTimeMillis()

    if now < lastTimestamp:
        handleClockRollback()

    if now == lastTimestamp:
        sequence++

        if sequence > 4095:
            wait until next millisecond
            now = currentTimeMillis()
            sequence = 0
    else:
        sequence = 0

    lastTimestamp = now

    return compose(now, workerId, sequence)
```

### Keep in memory

```text
workerId
lastTimestamp
sequence
```

This makes generation extremely fast.

---

## 7. Capacity Calculations

### Workers

```text
10 bits
2^10 = 1024 workers
```

### IDs per worker

```text
12 bits
2^12 = 4096 IDs/ms
```

Per second:

```text
4096 × 1000
= 4,096,000 IDs/sec/worker
```

Example:

```text
500 workers × 4,096,000
≈ 2.048 billion IDs/sec theoretical capacity
```

> Real throughput depends on language, CPU, synchronization, and implementation. These are bit-layout capacity calculations.

---

## 8. Sequence Overflow

If one worker generates:

```text
0 ... 4095
```

within the same millisecond:

```text
sequence = 4095   ✅
next ID            ❌ overflow
```

Solution:

```text
wait for next millisecond
↓
timestamp++
↓
sequence = 0
```

---

## 9. Worker ID Allocation

Never allow:

```text
Server A → worker 10
Server B → worker 10
```

because collisions become possible.

Use a coordinator:

```text
Server starts
   ↓
Acquire worker ID
   ↓
Lease + TTL
   ↓
Keep worker ID in memory
   ↓
Renew lease periodically
```

Example:

```text
/generators/worker-10 → server-A
/generators/worker-11 → server-B
/generators/worker-12 → server-C
```

If a node dies:

```text
lease expires
   ↓
worker ID becomes reusable
```

### Key rule

> **Coordinate worker IDs, NOT every generated ID.**

---

## 10. Multi-Region Design

Avoid cross-region coordination during normal ID generation.

Example:

```text
India  → workers 0–255
US     → workers 256–511
Europe → workers 512–767
```

Or split worker bits into:

```text
Region bits + Node bits
```

This ensures:

```text
India + worker 5
US    + worker 5
```

are still globally different because the region portion differs.

---

## 11. Critical Production Edge Cases

### 1. Clock rollback

Problem:

```text
lastTimestamp = 10000
now           = 9998
```

Do NOT blindly continue.

Possible strategies:
- Wait until clock catches up
- Use a logical-clock policy
- Fail/stop generation for large rollback
- Monitor and alert

Use NTP/chrony, but **never assume clocks are perfect**.

---

### 2. Sequence overflow

```text
> 4095 IDs in one millisecond on one worker
```

→ wait for next millisecond.

---

### 3. Duplicate worker ID

Two active nodes must never own the same worker ID.

→ coordinator + lease.

---

### 4. Worker crash

Existing worker dies:

```text
lease expires
→ worker ID can be reassigned
```

New owner should generate using a current/future timestamp.

---

### 5. Coordinator outage

Already-running generators can usually continue generating because IDs are local.

New nodes may not be able to obtain a worker ID until coordination is available.

This gives good availability for the hot path.

---

### 6. Split-brain / stale worker

Advanced production concern:

```text
Old node still thinks it owns worker 10
New node gets worker 10
```

Use:
- leases
- heartbeats
- fencing tokens
- safe lease expiration

---

## 12. Ordering: Important Interview Point

Snowflake IDs are:

✅ roughly time ordered

They are NOT:

❌ a strict global sequence

Example:

```text
Server A clock = 10:00:00.100
Server B clock = 10:00:00.099
```

So do not claim:

> "Snowflake guarantees perfect global ordering."

Say:

> "It provides approximate ordering based on time."

---

## 13. Snowflake vs UUID vs DB Sequence

| Approach | Pros | Cons |
|---|---|---|
| **Snowflake** | Fast, distributed, sortable-ish, compact | Worker coordination + clock handling |
| **UUID** | Simple, no coordination, globally unique | Larger, random, poor locality/order |
| **DB Sequence** | Very simple, strong sequence | DB bottleneck/dependency |

### Interview choice

Use **Snowflake** when:
- huge scale
- distributed services
- high write throughput
- low ID-generation latency
- roughly ordered IDs are useful

Use **UUID** when:
- simplicity matters
- ordering is not needed
- you want almost zero coordination

Use **DB sequence** when:
- scale is moderate
- database is already the natural source of truth

---

## 14. Database Usage

The generator creates the ID first:

```text
API
 ↓
Service
 ↓
generateId()       ← local memory
 ↓
184739182739182
 ↓
INSERT INTO orders
 ↓
Postgres
```

Example:

```sql
INSERT INTO orders (id, user_id, amount)
VALUES (184739182739182, 1001, 2500);
```

Use:

```text
BIGINT
```

for the internal ID in many systems.

---

## 15. Public ID vs Internal ID

Snowflake IDs reveal approximate creation time.

If enumeration/time leakage is a concern:

```text
Internal ID:
184739182739182

Public ID:
ord_x8K29Lm...
```

Use an opaque public identifier where appropriate.

---

# 16. Interview Explanation — 30 Seconds

> "I would use a Snowflake-style distributed ID generator. Each application node gets a unique worker ID through a coordination service such as etcd, using a lease. After startup, ID generation happens entirely in memory, so there is no database or network call per ID.
>
> The ID contains a timestamp, worker ID, and sequence number. The timestamp provides approximate ordering, the worker ID provides uniqueness across nodes, and the sequence handles multiple IDs generated in the same millisecond.
>
> With 10 worker bits we support 1024 workers, and with 12 sequence bits each worker can generate 4096 IDs per millisecond. I also handle clock rollback, sequence overflow, worker crashes, and stale-worker/split-brain scenarios."

---

# 17. Must-Remember Numbers

```text
41 bits → Timestamp
10 bits → Worker
12 bits → Sequence

2^10 = 1024 workers

2^12 = 4096 IDs/ms/worker

4096 × 1000
= 4.096 million IDs/sec/worker

41 + 10 + 12 = 63 usable bits
```

---

# 18. Must-Remember Architecture

```text
                  Worker ID Coordinator
                         |
                 allocate + lease
                         |
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
        Node A         Node B         Node C
        WID=1          WID=2          WID=3
          |              |              |
          └──────── local generation ───┘
                         |
                         ▼
                    App Services
                         |
                         ▼
                      Database
```

### Golden rule

> **Coordinate worker IDs, but never coordinate every ID.**
