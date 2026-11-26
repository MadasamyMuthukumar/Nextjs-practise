# Search Autocomplete — Interview Quick Notes

## 1. Goal
Return the best 5–10 suggestions while the user types, with low latency (example target: p95 < 50 ms). Design for high read traffic, frequent repeated prefixes, and changing popularity.

## 2. Architecture

```text
User types
   |
   v
Web/Mobile (debounce ~150–250 ms; ignore stale responses)
   |
   v
API Gateway / Rate Limit
   |
   v
NestJS Autocomplete API
   |
   +--> L1 local cache --> Redis hot-prefix cache
   |                              |
   +------------------------------+  cache miss
                                  v
                      Prefix index (OpenSearch completion)
                                  |
                                  v
                        Return top 5–10 results

OFFLINE / UPDATE PIPELINE
PostgreSQL catalog + curated seed phrases + search events
   --> Kafka / batch aggregation (optional at first)
   --> normalize, deduplicate, filter, calculate weights
   --> bulk-index OpenSearch / build new index snapshot
```

**Key principle:** don't query the main SQL database or scan all phrases on every keystroke. Keep a specialized prefix index ready for serving.

## 3. Where does initial data come from?
The index starts empty only until you load it. Seed it before launch from:
- Existing catalog: product names, brands, categories, titles.
- Curated CSV/JSON of useful phrases.
- Later: aggregated search queries and suggestion clicks.

Example seed records:

| Phrase | Initial weight |
|---|---:|
| iphone 17 | 1000 |
| iphone 17 pro | 900 |
| iphone charger | 800 |

Weights are ranking signals; later calculate them from historical popularity, recent trends, engagement, locale, and editorial rules.

## 4. How the prefix index works

- **Trie:** characters form a tree. Follow `i → p → h` to find prefix `iph`. Store top-K suggestions at prefix nodes for fast results. Simple to understand, but a pointer-heavy trie can use lots of memory.
- **Weighted FST:** compressed prefix structure; useful for large read-heavy dictionaries, but requires a suitable library/build pipeline.
- **OpenSearch / Elasticsearch completion:** recommended first production implementation. Configure a `completion` field, bulk-load phrases, and let the engine build its internal completion structure.

**Recommendation:** use OpenSearch completion for the first implementation; consider a custom FST only if measured memory/latency needs justify the extra complexity.

## 5. OpenSearch: build and query

### Create the index

```http
PUT /autocomplete-v1
```

```json
{
  "mappings": {
    "properties": {
      "phrase": { "type": "keyword" },
      "suggest": { "type": "completion", "analyzer": "simple" },
      "locale": { "type": "keyword" }
    }
  }
}
```

### Preload phrases
Use the **Bulk API** (NDJSON, two lines per document) rather than one request per phrase:

```jsonl
{"index":{"_index":"autocomplete-v1","_id":"p001"}}
{"phrase":"iphone 17","suggest":{"input":["iphone 17"],"weight":1000},"locale":"en-IN"}
{"index":{"_index":"autocomplete-v1","_id":"p002"}}
{"phrase":"iphone 17 pro","suggest":{"input":["iphone 17 pro"],"weight":900},"locale":"en-IN"}
```

Check bulk response errors; retry failed items. Load the seed/index **before** sending production traffic.

### Search prefix `iph`

```http
GET /autocomplete-v1/_search
```

```json
{
  "size": 0,
  "suggest": {
    "phrase-suggest": {
      "prefix": "iph",
      "completion": {
        "field": "suggest",
        "size": 5,
        "skip_duplicates": true
      }
    }
  }
}
```

Return the `options[].text` values to the client. The completion field uses its own optimized index; you do not manually create `i`, `ip`, `iph` keys.

## 6. Keep the index updated

- **Catalog updates:** source DB / outbox or CDC → worker → index document upsert/delete.
- **Popularity/trends:** search events → aggregate counts → recalculate weights → update index periodically. Don't build the whole index for every keystroke.
- **Safe full rebuild:** build `autocomplete-v2` while `v1` serves traffic → validate/warm → switch read alias → retain `v1` for rollback.
- Make updates idempotent; use stable document IDs; monitor indexing failures and index freshness.

## 7. Latency and scale

- Debounce client input (~150–250 ms); cancel/ignore stale requests.
- Return only 5–10 results; normalize input consistently.
- Use local cache, then Redis for hot prefixes, then the prefix index.
- Cache key example: `autocomplete:v42:en-IN:iph` (include locale/context and index version when relevant).
- Replicate stateless API instances across zones; load index data near serving compute.
- Short prefixes (`a`, `ma`) can be very hot: precompute/cache top-K results and avoid querying every shard.
- Graceful fallback: if Redis fails, query the index; if a new index build fails, keep serving the last known-good version.
- Filter spam, sensitive/private phrases, and low-quality suggestions before exposing them.

## 8. BOE (Back-of-the-envelope) example
Assumptions: 30M daily users × 5 sessions/day × 4 autocomplete requests/session.

- Daily requests = `30M × 5 × 4 = 600M`
- Average QPS = `600M / 86,400 ≈ 6,944`
- Peak QPS (5× average) ≈ `34,700`
- If overall cache hit rate is 80%, index lookups at peak ≈ `34,700 × 20% = 6,940 QPS` (API still serves all requests).
- If a tested instance handles 3,000 QPS, baseline ≈ `ceil(34,700 / 3,000) = 12`; with 1.5× headroom ≈ **18 instances**. Replace this assumption with load-test results.
- At ~1 KB response each: peak payload ≈ `35 MB/s`; daily payload ≈ `600 GB/day` (decimal units, before overhead).
- For 5M phrases × 54 bytes/record, raw logical data ≈ `270 MB`; real index memory is higher and must be measured with actual data/index implementation.

## 9. Interview summary
“I'd use a stateless API with client debounce, local/Redis hot-prefix caches, and an OpenSearch completion index preloaded from the product catalog and curated seed phrases. A separate pipeline aggregates search events, ranks and filters phrases, then updates the index in batches. I'd deploy versioned index snapshots with safe alias switching, measure p95/p99 and cache hit rate, and size the serving tier using peak QPS plus load-test capacity.”
