# Web Crawler — System Design Quick Notes

## 1. Goal

Build a **production-friendly, highly scalable web crawler** that:

- Starts from seed URLs
- Crawls pages and discovers new URLs
- Avoids duplicate crawling
- Respects `robots.txt`
- Controls request rate per host
- Handles retries, failures, redirects and recrawling
- Scales horizontally to millions/billions of URLs

---

## 2. High-Level Architecture

```text
                  Seed URLs
                     |
                     v
             +------------------+
             | URL Normalizer   |
             | + Dedup          |
             +--------+---------+
                      |
                      v
             +------------------+
             |  URL Frontier    |
             |------------------|
             | Priority         |
             | Per-host queue   |
             | Retry scheduling |
             | Recrawl timing   |
             +--------+---------+
                      |
                      v
              +---------------+
              |  Ready Queue  |
              | Kafka / Queue |
              +-------+-------+
                      |
          +-----------+-----------+
          |           |           |
          v           v           v
       Fetcher     Fetcher     Fetcher
          |           |           |
          +-----------+-----------+
                      |
                      v
                 +---------+
                 | Parser  |
                 +----+----+
                      |
              +-------+-------+
              |               |
              v               v
        New URLs          Page Content
              |               |
              v               v
        URL Frontier      S3/Object Store
                              |
                              v
                         Metadata DB
```

Supporting services:

```text
Robots.txt Cache
DNS Cache
Rate Limiter
Retry Manager
Monitoring / Metrics
```

---

## 3. Most Important Component: URL Frontier

Think of the **URL Frontier as the brain of the crawler**.

It decides:

- **WHAT** to crawl → priority
- **WHEN** to crawl → scheduling / retry / recrawl
- **HOW FAST** to crawl → per-host rate + concurrency
- **WHETHER** to crawl → dedup + robots + crawl policy

For scale, partition frontier state by **hostname**.

Example:

```text
Scheduler 1 -> amazon.com, cnn.com
Scheduler 2 -> example.com, github.com
Scheduler 3 -> reddit.com, wikipedia.org
```

This prevents one global scheduler from becoming a bottleneck.

---

## 4. End-to-End Flow

### Step 1 — Seed URL

```text
https://example.com
```

### Step 2 — Normalize

Convert equivalent URLs into a consistent form.

Example:

```text
HTTP://Example.COM
https://example.com/
```

should normally map to the same normalized URL.

Remove fragments like:

```text
/page#section
```

for normal HTTP crawling.

---

### Step 3 — Deduplicate

Create a URL hash:

```text
urlHash = SHA256(normalizedUrl)
```

Use an atomic **insert-if-absent** operation.

Important:

> Bloom Filter = fast optimization  
> Durable URL store = source of truth

---

### Step 4 — Check robots.txt

Before crawling the host:

```text
https://example.com/robots.txt
```

Cache the robots rules.

If URL is disallowed → skip it.

---

### Step 5 — Frontier Scheduling

Store:

```text
host
priority
nextCrawlAt
retryCount
```

Also enforce:

```text
per-host rate limit
per-host concurrency limit
```

Example:

```text
example.com -> max 2 concurrent requests
```

Even if we have 1000 crawler workers.

---

### Step 6 — Put Ready URL on Queue

When the URL is allowed to run:

```text
URL Frontier
      |
      v
Kafka / Ready Queue
```

Fetcher workers consume tasks.

---

### Step 7 — Fetch

Fetcher performs HTTP request with:

- Connection pooling / keep-alive
- DNS caching
- Timeouts
- Maximum response size
- HTTP/HTTPS only
- Redirect limit

---

### Step 8 — Handle Response

Examples:

```text
200 -> process
301/302 -> follow redirect
404 -> mark failed/not found
429 -> respect Retry-After and slow host
500/502/503/504 -> retry
```

---

### Step 9 — Store Content

Raw HTML:

```text
S3 / Object Storage
```

Metadata:

```text
URL
status code
content hash
crawl time
content type
storage key
```

Do not put huge HTML bodies in the main DB.

---

### Step 10 — Parse HTML

Extract links:

```text
/about
/products
/blog
```

Resolve relative URLs and normalize them.

---

### Step 11 — Dedup + Enqueue New URLs

For every discovered URL:

```text
Normalize
   |
Dedup
   |
Policy checks
   |
Frontier
```

Then the same cycle continues.

---

## 5. Important Data

### URL State

```text
urlHash
normalizedUrl
host
status
depth
priority
retryCount
nextCrawlAt
lastCrawledAt
etag
lastModified
contentHash
```

### Host State

```text
host
robotsRules
robotsExpiry
crawlDelay
maxConcurrency
nextAllowedAt
failureCount
crawlBudget
```

---

## 6. Scaling

### Stateless Fetchers

Fetcher workers should be stateless.

```text
Queue depth ↑
   -> add workers

Queue depth ↓
   -> remove workers
```

### Partitioning

Partition the frontier by host:

```text
hash(host) % N
```

This gives horizontal scaling.

### Storage

Use:

```text
URL metadata -> Distributed DB
Raw pages    -> S3 / Object Storage
Search data  -> OpenSearch / Elasticsearch (if needed)
```

### Backpressure

If parser/indexer is slower than fetchers:

```text
Fetcher -> Queue -> Parser
                  ^
              queue grows
```

Use queue monitoring + backpressure + autoscaling.

---

## 7. Retries

Use **exponential backoff + jitter**.

Example:

```text
1st retry -> ~1 sec
2nd retry -> ~2 sec
3rd retry -> ~4 sec
4th retry -> ~8 sec
```

Jitter prevents many workers from retrying at exactly the same time.

Retry mainly for:

```text
Timeouts
429
500
502
503
504
```

After max attempts:

```text
Dead Letter Queue (DLQ)
```

---

## 8. Worker Crash Handling

Use **at-least-once processing** with a lease / visibility timeout.

```text
Queue
  |
  v
Worker picks URL
  |
  v
leaseUntil = now + 60s
  |
  +--> worker succeeds -> ACK
  |
  +--> worker crashes -> lease expires -> retry
```

Important:

> Prefer at-least-once + idempotency instead of trying to guarantee end-to-end exactly-once.

---

## 9. Important Edge Cases

### 1. Duplicate URLs

Solution:

```text
Normalize + hash + atomic insert-if-absent
```

### 2. Same content on different URLs

Use:

```text
contentHash = SHA256(content)
```

for content deduplication.

### 3. Crawl Traps / Infinite URLs

Examples:

```text
/calendar?date=...
/products?page=...
/shop?filter=...
```

Use:

- Per-host crawl budget
- URL/depth limits
- Query parameter rules
- URL pattern detection
- Content deduplication

### 4. One Host Becomes Hot

Use:

```text
Per-host rate limit
Per-host concurrency
Host crawl budget
```

### 5. 429 Too Many Requests

Respect:

```text
Retry-After
```

and slow/pause that host.

### 6. Redirect Loop

Limit redirects, e.g. configurable max redirects.

### 7. Huge Response

Set:

```text
max response size
max decompressed size
request timeout
```

### 8. JavaScript-Heavy Pages

Use a separate:

```text
Browser Queue
    |
Playwright / Chromium Workers
```

Only render pages that actually need JS.

### 9. SSRF / Security

If URLs are user-controlled, block:

```text
localhost
127.0.0.1
private IP ranges
link-local addresses
cloud metadata endpoints
```

Also validate redirect targets and DNS results.

---

## 10. Recrawling

Not every page needs the same crawl frequency.

Example:

```text
News page      -> every hour
Normal page    -> every day
Rarely changed -> every week
```

Store:

```text
lastCrawledAt
nextCrawlAt
changeFrequency
```

Use conditional requests:

```http
If-None-Match
If-Modified-Since
```

If server returns:

```text
304 Not Modified
```

avoid downloading the full content again.

---

## 11. Useful Extra Sources

Do not depend only on links.

Also process:

```text
robots.txt
XML sitemaps
```

Sitemaps can quickly provide large numbers of URLs.

For huge sitemaps, use a **streaming parser** instead of loading everything into memory.

---

## 12. Back-of-the-Envelope Example

Suppose:

```text
100M pages/day
```

Average:

```text
100,000,000 / 86,400
≈ 1,157 pages/sec
```

If peak = 5x:

```text
≈ 5,800 pages/sec
```

If average page = 300 KB:

```text
100M × 300 KB
≈ 30 TB/day
```

This shows why we need:

```text
Distributed workers
Distributed queue
Distributed URL store
Object storage
```

---

## 13. Interview Answer Structure

Use this order:

```text
1. Clarify requirements
2. Draw high-level architecture
3. Explain URL Frontier
4. Explain crawl flow
5. Explain deduplication
6. Explain per-host rate limiting / robots
7. Explain retries + worker failure
8. Explain storage
9. Explain scaling
10. Discuss edge cases
```

---

## 14. 30-Second Interview Summary

You can say:

> "I would build a distributed crawler around a URL Frontier. The frontier handles URL deduplication, priority, retry scheduling, recrawling, and per-host politeness. URLs are partitioned by hostname so scheduling scales horizontally and each host can have its own rate and concurrency limit. Ready URLs are pushed to a durable queue such as Kafka and processed by stateless fetcher workers. Fetched pages are stored in object storage, metadata in a distributed database, and extracted links are normalized and fed back into the frontier. I would use at-least-once processing with leases and idempotency, exponential backoff for retries, robots.txt caching, crawl budgets and URL-pattern filtering for crawl traps, and isolated browser workers for JavaScript-heavy pages."

---

## 15. Keywords to Remember Before the Interview

```text
URL Frontier
URL normalization
Deduplication
Bloom Filter
Atomic insert-if-absent
Per-host scheduling
Rate limiting
Concurrency limiting
robots.txt
Kafka / durable queue
Stateless workers
At-least-once processing
Lease / visibility timeout
Exponential backoff + jitter
Dead Letter Queue
Crawl budget
Crawl traps
Content hashing
S3 / object storage
Recrawling
ETag / Last-Modified
Backpressure
Autoscaling
DNS caching
Connection pooling
SSRF protection
```

## Core Idea

```text
The crawler is NOT just:

URL -> HTTP request -> parse

The real system is:

URL
 |
 +--> Normalize
 |
 +--> Dedup
 |
 +--> robots / policy
 |
 +--> Frontier
        |
        +--> priority
        +--> when to crawl
        +--> host rate
        +--> host concurrency
        +--> retry / recrawl
        |
        v
      Fetch
        |
        v
      Parse
        |
        +--> Store content
        |
        +--> Discover URLs
                    |
                    v
                 Frontier
```
