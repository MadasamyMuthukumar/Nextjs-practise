# BACK-OF-THE-ENVELOPE (BOE)

## System Design Interview Cheat Sheet

### 1. What is BOE?

**BOE = quick estimation of system scale.**

Before designing the architecture, estimate:

**Users → Requests → QPS → Peak QPS → Storage → Bandwidth → Concurrency → Servers**

The goal is **not exact numbers**.

The goal is to know whether the system is:

* Small → one/few servers may be enough
* Medium → caching / replicas may help
* Large → partitioning / queues / CDN / sharding may be needed
* Huge → distributed architecture is required

---

# 2. MEMORIZE THESE 🔥

## Time

```text
1 minute = 60 sec
1 hour   = 3,600 sec
1 day    = 86,400 sec
1 year   ≈ 31.5M sec
```

### Easy approximation

```text
1 day ≈ 100,000 seconds
```

Therefore:

```text
1M requests/day   ≈ 10–12 QPS
10M/day           ≈ 100–120 QPS
100M/day          ≈ 1,000–1,200 QPS
1B/day            ≈ 10,000–12,000 QPS
```

---

## Number conversions

```text
1K = 1,000
1M = 1,000,000
1B = 1,000,000,000
1T = 1,000,000,000,000
```

---

# 3. MOST IMPORTANT FORMULAS 🔥

## Daily requests

```text
DAU × actions/user/day
```

Example:

```text
10M users × 20 actions
= 200M requests/day
```

---

## Average QPS

```text
requests/day ÷ 86,400
```

Example:

```text
200M / 86,400
≈ 2.3K QPS
```

Quick approximation:

```text
200M / 100K ≈ 2K QPS
```

---

## Peak QPS

```text
Average QPS × Peak Factor
```

Usually assume:

```text
3× to 5×
```

unless traffic is highly bursty.

Example:

```text
2K average × 5
= 10K peak QPS
```

---

## Storage

```text
writes/day × object size
```

Example:

```text
10M writes/day × 1KB
= 10GB/day
```

Yearly:

```text
10GB × 365
≈ 3.65TB/year
```

With 3 replicas:

```text
3.65TB × 3
≈ 11TB
```

---

## Bandwidth

```text
QPS × request/response size
```

Example:

```text
10K QPS × 100KB
= 1GB/sec
```

Convert bytes → bits:

```text
1 Byte = 8 bits
```

So:

```text
1GB/sec ≈ 8Gbps
```

---

## Concurrency

```text
Concurrency = QPS × Latency(seconds)
```

Example:

```text
10K QPS × 0.2 sec
= 2,000 concurrent requests
```

This is based on **Little's Law**.

---

## Servers

```text
Required servers
= Peak QPS ÷ capacity/server
```

Example:

```text
50K peak QPS
One server = 2K QPS

50K / 2K = 25 servers
```

Add headroom:

```text
25 × 1.3 ≈ 33 servers
```

**Important:** server capacity must come from benchmarking/testing.

---

## Workers

```text
Workers
= Incoming jobs/sec ÷ jobs/sec per worker
```

Example:

```text
20K jobs/sec
Worker handles 500 jobs/sec

20K / 500
= 40 workers
```

---

## Shards

Think:

```text
Shards needed
≈ max(
    storage requirement,
    traffic requirement
)
```

Example:

```text
100TB data
5TB/shard

100 / 5
= 20 shards
```

---

# 4. BASIC BOE FLOW 🔥

Always think:

```text
1. How many users?
        ↓
2. How many actions/user/day?
        ↓
3. Requests/day?
        ↓
4. Average QPS?
        ↓
5. Peak QPS?
        ↓
6. Read / Write QPS?
        ↓
7. Storage?
        ↓
8. Bandwidth?
        ↓
9. Concurrency?
        ↓
10. Servers / DB / Cache / Shards?
        ↓
11. Architecture decisions
```

---

# 5. BASIC EXAMPLE — 1 → 10

## Problem

Design a simple system.

Assume:

```text
1M DAU
10 requests/user/day
```

### Step 1: Daily requests

```text
1M × 10
= 10M requests/day
```

### Step 2: Average QPS

```text
10M / 86,400
≈ 116 QPS
```

Say:

```text
≈ 100 QPS
```

### Step 3: Peak QPS

Assume 5×:

```text
100 × 5
= 500 QPS
```

### Step 4: Storage

Suppose:

```text
1M writes/day
1KB/write
```

Then:

```text
1M × 1KB
= 1GB/day
```

Year:

```text
1GB × 365
≈ 365GB/year
```

### Conclusion

This is relatively small.

Possible architecture:

```text
Client
  ↓
Load Balancer
  ↓
Few API servers
  ↓
PostgreSQL

Optional Redis cache
```

### Interview takeaway

**Don't over-engineer a 500-QPS system just because you know Kafka, Kubernetes and sharding.**

---

# 6. COMPLEX EXAMPLE — 10 → 100

## Problem

Design a large social-media feed system.

Assume:

```text
10M DAU
100 feed requests/user/day
```

---

## Step 1: Requests/day

```text
10M × 100
= 1B requests/day
```

---

## Step 2: Average QPS

```text
1B / 86,400
≈ 11.6K QPS
```

Say:

```text
≈ 12K QPS average
```

---

## Step 3: Peak QPS

Assume 5× peak:

```text
12K × 5
= 60K QPS
```

So:

```text
Average ≈ 12K QPS
Peak    ≈ 60K QPS
```

---

## Step 4: Read / Write

Suppose:

```text
90% reads
10% writes
```

Then roughly:

```text
Peak reads
= 60K × 90%
= 54K QPS

Peak writes
= 60K × 10%
= 6K QPS
```

This immediately tells us:

**Very read-heavy system → caching/read optimization is important.**

---

## Step 5: Feed response size

Assume:

```text
Average response = 50KB
```

Bandwidth:

```text
60K × 50KB
= 3,000,000KB/sec
≈ 3GB/sec
```

In bits:

```text
3GB/sec × 8
≈ 24Gbps
```

That's very large.

Therefore:

```text
CDN / caching / compression
```

becomes important.

---

## Step 6: Cache

Suppose cache hit rate:

```text
95%
```

Peak requests:

```text
60K QPS
```

DB/origin traffic:

```text
60K × 5%
= 3K QPS
```

Instead of DB handling 60K QPS, it might handle only around:

```text
3K QPS
```

This is why cache hit ratio matters.

---

## Step 7: Concurrency

Suppose average latency:

```text
200ms = 0.2 sec
```

Then:

```text
60K × 0.2
= 12K concurrent requests
```

Approximately:

```text
12,000 requests in flight
```

---

## Step 8: Servers

Assume benchmark:

```text
1 API server safely handles 2K QPS
```

Then:

```text
60K / 2K
= 30 servers
```

Add 30% headroom:

```text
30 × 1.3
≈ 39
```

So roughly:

```text
~40 API servers
```

---

## Step 9: Storage

Suppose:

```text
1M new posts/day
Average metadata = 2KB
```

Then:

```text
1M × 2KB
= 2GB/day
```

Year:

```text
2GB × 365
≈ 730GB/year
```

But images/videos should probably **not** live inside the main relational DB.

Use:

```text
Object Storage
(S3 / GCS)
```

and store metadata in DB.

---

## Architecture derived from BOE

```text
                  Clients
                     |
                     v
                 CDN / Edge
                     |
                     v
               Load Balancer
                     |
          +----------+----------+
          |          |          |
        API 1      API 2      API N
          |          |          |
          +----------+----------+
                     |
                  Redis
                     |
          +----------+----------+
          |                     |
       DB Primary          Read Replicas
          |
       Object Storage
          |
         CDN
```

### Why?

Because BOE showed:

```text
60K peak QPS
54K read QPS
Large bandwidth
High concurrency
Large media
```

Therefore:

```text
Read-heavy
→ Redis / read replicas

Large media
→ Object storage

Large bandwidth
→ CDN

High traffic
→ Multiple API servers

Growing data
→ Partitioning/sharding when needed
```

**This is exactly how BOE should influence your architecture.**

---

# 7. WHAT TO ESTIMATE IN ANY SYSTEM

At minimum, estimate these:

```text
[ ] Users / DAU
[ ] Actions per user/day
[ ] Requests/day
[ ] Average QPS
[ ] Peak QPS
[ ] Read QPS
[ ] Write QPS
[ ] Object/data size
[ ] Daily storage
[ ] Yearly storage
[ ] Replication
[ ] Bandwidth
[ ] Latency
[ ] Concurrency
[ ] Server capacity
[ ] Cache size / hit rate
[ ] Queue throughput
[ ] Number of shards
```

You don't necessarily need every number in every interview.

Estimate the numbers that affect your design.

---

# 8. IMPORTANT NOTES ⚠️

### BOE is approximate

Don't try to calculate:

```text
11,574.398 QPS
```

Instead:

```text
≈ 10K QPS
```

Order of magnitude matters more than precision.

---

### Always state assumptions

Say:

```text
"I'll assume..."
```

Examples:

```text
"I'll assume 10M DAU."

"I'll assume 20 actions/user/day."

"I'll assume a 5× peak factor."

"I'll assume 1KB average record size."
```

---

### Peak is NOT always 5×

5× is only an assumption.

Depending on the system:

```text
Normal traffic → 2–3×
Typical → 3–5×
Highly bursty → potentially much higher
```

Explain your assumption.

---

### Server QPS is NOT universal

Never say:

```text
"One Node.js server can handle 5K QPS."
```

Better:

```text
"Assuming load testing shows one server safely handles 2K QPS..."
```

Because capacity depends on:

```text
CPU
Memory
DB calls
Network
Payload
Query complexity
Latency target
```

---

### Don't forget replication

If raw storage is:

```text
100TB
```

and replication factor is 3:

```text
100 × 3
= 300TB
```

---

### Don't forget overhead

Actual storage also includes:

```text
Indexes
Metadata
WAL
Backups
Replication
DB overhead
```

---

### Don't treat cache as the database

Redis/cache is normally:

```text
Fast temporary copy
```

Primary durable data should generally remain in durable storage.

---

### Don't confuse QPS and concurrency

```text
QPS = how many requests arrive per second

Concurrency = how many requests are currently in progress
```

Formula:

```text
Concurrency = QPS × latency
```

---

# 9. BOE → ARCHITECTURE CHEAT SHEET

```text
High READ traffic
      ↓
Redis
Read replicas
CDN

High WRITE traffic
      ↓
Queues
Batching
Partitioning
Sharding

Large files
      ↓
Object storage
CDN

Async processing
      ↓
Kafka / Queue / Workers

Very large database
      ↓
Partitioning / Sharding

Huge search workload
      ↓
Search engine

Many concurrent connections
      ↓
WebSocket infrastructure
Connection management
Horizontal scaling

Traffic spikes
      ↓
Autoscaling
Queue
Rate limiting
Caching
```

---

# 10. INTERVIEW ANSWER TEMPLATE 🔥

Use this exact structure.

### Opening

> "Before I design the architecture, I'll quickly estimate the scale so we know the traffic and storage requirements."

### Assumptions

> "I'll assume X DAU, Y actions per user per day, and a Z× peak factor."

### Traffic

> "That gives us X requests/day, which is approximately Y QPS on average."

> "Assuming a Z× peak, we're looking at roughly P QPS."

### Reads/Writes

> "Assuming an R:S read/write ratio, that gives us approximately X read QPS and Y write QPS."

### Storage

> "Assuming each record is X KB, daily storage is approximately Y GB, which becomes roughly Z TB/year before replication and overhead."

### Bandwidth

> "With an average payload of X KB and P peak QPS, bandwidth is approximately Y GB/sec."

### Concurrency

> "With an average latency of X ms, estimated concurrency is roughly Y."

### Capacity

> "Assuming one application server safely handles X QPS based on benchmarking, we'd need around Y servers, plus some headroom."

### Architecture

> "Based on those numbers, this is a read-heavy/high-throughput system, so I'd use caching, horizontal API scaling, database replicas, and object storage/CDN where appropriate."

### Closing

> "These are order-of-magnitude estimates. In production I'd validate the assumptions using actual traffic data and load testing."

---

# 11. SUPER-SHORT VERSION TO MEMORIZE BEFORE INTERVIEW

```text
BOE = estimate scale before architecture.

1. USERS
   DAU?

2. ACTIONS
   Actions/user/day?

3. REQUESTS
   DAU × actions/day

4. QPS
   Requests/day ÷ 86,400

5. PEAK
   Average × 3–5×

6. READ / WRITE
   Split traffic

7. STORAGE
   Writes/day × object size

8. BANDWIDTH
   QPS × payload size

9. CONCURRENCY
   QPS × latency(seconds)

10. SERVERS
    Peak QPS ÷ tested server capacity

11. SHARDS
    Based on storage + traffic

12. ARCHITECTURE
    Use the numbers to justify:
    Cache / CDN / Queue / Replicas /
    Object Storage / Partitioning / Sharding
```

---

# 12. GOLDEN RULE ⭐

**Don't do BOE just to show arithmetic.**

The interviewer wants to hear:

```text
"Because I estimate 100K read QPS,
I need caching/read replicas."

"Because I estimate 10PB media,
I need object storage + CDN."

"Because I estimate 500K jobs/sec,
I need many workers and queue partitioning."

"Because one DB cannot handle the traffic,
I need partitioning/sharding."
```

That is the real purpose of BOE:

> **ESTIMATE → IDENTIFY BOTTLENECK → CHOOSE ARCHITECTURE**
