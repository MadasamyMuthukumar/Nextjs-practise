# Ticket Booking System (BookMyShow) — Interview Quick Notes

> **Core principle:** Seat availability may be eventually consistent across apps, but seat ownership must be strongly consistent at the inventory owner.

## 1. Requirements

**Functional:** Search movies/events by city, category, venue and date; view shows, seat layouts, prices and availability; hold seats; pay through a gateway; confirm bookings; generate e-tickets/QR codes; send email/SMS; support cancellations, refunds, partner integrations and ticket scanning.

**Non-functional:** No double booking; high availability and low latency; handle blockbuster traffic spikes; scale reads and writes independently; secure payments and partner APIs.

## 2. Who owns the inventory?

There is **no single government-owned national seat database** for all cinemas and events. The inventory authority is normally the cinema, venue, event organizer, or its appointed ticketing technology provider. It controls shows, layouts, pricing, holds and confirmed sales. Aggregators (BookMyShow, TicketNew, District, etc.) are sales channels; in some commercial arrangements an aggregator may also operate the inventory platform.

**If launching a new app:**
1. Partner directly with cinemas/organizers and integrate with their box-office/ticketing system.
2. Become an authorized reseller/distribution partner of an existing ticketing provider.
3. Become the primary ticketing provider for venues/events and operate their inventory yourself.

You need a commercial agreement and authorized API access. Seeing another app's seat map does not grant the ability or permission to reserve those seats.

### Two models for multiple apps
- **Shared inventory (preferred):** Every sales channel calls the same authoritative inventory API to hold/confirm a seat.
- **Exclusive allocation:** The organizer gives each channel non-overlapping seats or quantities. Each channel sells only its allocation. This avoids overlap but can leave unsold inventory stranded.

A webhook alone cannot prevent double booking. The hold/booking operation itself must be coordinated.

## 3. High-level architecture

```text
Users / Aggregators / Cinema App
              |
          CDN + WAF
              |
         API Gateway
              |
    +---------+----------+
    |                    |
 Catalog/Search       Booking APIs
    |                    |
 OpenSearch          Inventory Service
 Redis cache              |
                          v
                 PostgreSQL (source of truth)
                          |
                    Payment Service
                          |
                  Payment Gateway
                          |
                 Verified payment result
                          |
             Booking confirmation transaction
                          |
                 Transactional Outbox
                          |
                        Kafka
          +---------------+----------------+
          |               |                |
      Ticket Service  Partner Sync   Notifications
          |               |                |
       S3/CDN        Partner webhooks    SMS/Email
```

**Typical technology choices:** API services (NestJS/Java/Go); OpenSearch for catalog search; Redis for cache/rate limits; PostgreSQL for transactional inventory/bookings; Kafka for events; WebSocket/SSE for live seat updates; S3/GCS + CDN for tickets/assets. Keep boundaries logical; don't create a microservice for every small feature prematurely.

## 4. Core data model

```text
Venue -> Screen -> Versioned Seat Layout -> Physical Seats
Event/Movie -> Show -> Show Seat Inventory
Show + Seat -> AVAILABLE / HELD / BOOKED / BLOCKED
Hold -> Booking -> Payment Attempt -> Ticket
Partner Mapping: partner external IDs -> canonical internal IDs
```

Important tables:
- `venues(id, name, city, timezone)`
- `screens(id, venue_id, name)`
- `seat_layout_versions(id, screen_id, version, layout_data)`
- `seats(id, screen_id, row_name, seat_number, type, x, y)`
- `events(id, title, category, ...)`
- `shows(id, event_id, screen_id, starts_at, ends_at, status)`
- `show_seats(show_id, seat_id, status, price, currency, hold_id, hold_expires_at, booking_id, version)` — primary key `(show_id, seat_id)`
- `seat_holds(id, show_id, user_id, partner_id, status, expires_at, idempotency_key)`
- `bookings(id, user_id, show_id, partner_id, hold_id, status, total_amount)`
- `booking_seats(booking_id, show_id, seat_id, price_snapshot)`
- `payment_attempts(id, booking_id, provider, provider_payment_id, status, idempotency_key)`
- `partner_mappings(partner_id, entity_type, external_id, internal_id)`
- `outbox_events(id, aggregate_id, event_type, payload, published_at)`

**Modeling reminders:** A physical seat is different from its availability for a particular show. `show_id + seat_id` identifies one sellable seat instance. A1 can be booked for the 7 PM show but available for the 10 PM show. Version seat layouts; snapshot prices when held/booked. General-admission events need section/quantity inventory instead of individual seat rows.

## 5. Seat selection and concurrency (critical)

Seat states:

```text
AVAILABLE -> HELD -> BOOKED
                |
                +----> AVAILABLE (hold expires/cancelled)
```

Selecting a seat in the frontend is **not** a reservation. The seat is reserved only after the inventory service confirms a hold.

**Race example:** A BookMyShow user and a TicketNew user both see A5 as available and click it. Both call the same inventory authority. The database atomically transitions A5 from AVAILABLE to HELD for one request. The other sees it is no longer available and gets `SEAT_UNAVAILABLE`.

Use a short PostgreSQL transaction with row locking (`SELECT ... FOR UPDATE`) or a conditional update:

```sql
UPDATE show_seats
SET status = 'HELD', hold_id = :hold_id,
    hold_expires_at = NOW() + INTERVAL '5 minutes',
    version = version + 1
WHERE show_id = :show_id
  AND seat_id = :seat_id
  AND status = 'AVAILABLE'
RETURNING seat_id;
```

If no row is returned, the seat was not available. For multiple seats, lock in a consistent order, validate that **all** requested seats are available, then update all in one transaction; otherwise roll back all.

**Do not rely on Redis locks as the final correctness mechanism.** Redis is useful for cache/rate limits, but the authoritative database transaction enforces ownership.

**Hold expiry:** A hold might last around 5 minutes (configurable). An expiry worker conditionally releases only seats still owned by that hold. Payment-pending holds may need a bounded extension or explicit policy. A late successful payment after the hold is lost must not create a duplicate booking; refund it if inventory cannot be fulfilled.

## 6. Payment: Saga + idempotency

The payment gateway and our database cannot share one normal ACID transaction.

1. Create a seat hold.
2. Create payment intent with an idempotency key.
3. Customer completes payment.
4. Verify signed gateway webhook; do not trust browser redirect as proof.
5. Transactionally validate the hold, mark seats BOOKED and booking CONFIRMED, and insert an outbox event.
6. Generate ticket and send notifications asynchronously.

Where supported, authorization followed by capture can reduce risk: authorize, commit booking, capture; compensate/release if capture permanently fails. Other payment methods need clear timeout/refund policies.

Handle duplicate payment requests with idempotency keys; deduplicate webhook event IDs; reconcile payment timeouts with the provider; refund successful payments when inventory can no longer be fulfilled; make booking transitions idempotent.

## 7. How aggregators synchronize

**Catalog/show data (changes less frequently):** Venue/organizer/ticketing provider supplies canonical venue, screen, layout, event, showtime and price data. Each aggregator maps its external IDs to canonical IDs.

**Dynamic availability (changes frequently):**
- Initial snapshot: `GET /shows/{id}/seat-map`.
- Live deltas: WebSocket/SSE for customers viewing a show.
- Partner updates: signed webhooks.
- Internal distribution: Kafka.
- Recovery: snapshot refresh and periodic reconciliation.

Example event:

```json
{
  "eventId": "evt-1001",
  "type": "SEATS_BOOKED",
  "showId": "SHOW-9001",
  "seats": ["A5", "A6"],
  "version": 106
}
```

Use unique event IDs, per-show increasing versions, deduplication, retries with backoff, dead-letter handling and reconciliation. Ignore stale versions. Partner webhook failure must not fail an already-committed booking.

**Transactional Outbox:** In the same PostgreSQL transaction that confirms a booking, update the seats/booking and insert an outbox event. A background publisher reads the outbox and publishes to Kafka. This prevents the “DB commit succeeded but server crashed before event publish” gap. Consumers must be idempotent because delivery is generally at-least-once.

**Consistency split:** Booking/seat ownership is strongly consistent at the inventory authority. Other apps' displayed availability is eventually consistent. A stale display is possible, but the hold API must reject a seat that is no longer available.

## 8. Handling a blockbuster / hot show

A huge burst targets one show or a few popular seats. Adding API servers alone does not solve a hot database row/partition.

1. **CDN + WAF + bot protection:** Serve static assets and protect APIs.
2. **Virtual waiting room:** Queue users before booking APIs. Use FIFO or randomized admission policy; issue short-lived, signed, session-bound admission tokens.
3. **Admission controller:** Admit users at a rate the inventory service can safely process. Keep spare capacity; derive the rate through load tests.
4. **Per-show rate limits:** Redis token bucket or gateway limits so one show does not starve all others.
5. **Cache reads:** Cache static seat layout for a long time; cache availability snapshots in Redis. Never trust cache to confirm a booking.
6. **Atomic writes:** Database conditional update/row lock is the final guard against two users holding the same seat.
7. **Dedicated hot-show capacity:** Give a very popular show a well-provisioned inventory partition and bound concurrency. Sharding by `show_id` distributes different shows, but one hot show still has one write owner.
8. **Backpressure:** Return queue status or `429 Retry-After`; prevent aggressive client retries.
9. **WebSocket fanout:** Send small seat-status deltas, not the entire map. On reconnect, fetch a fresh snapshot/version.
10. **Sellout handling:** Stop admitting users to the purchase path when sold out; never fail open to stale cache if the inventory DB is unavailable.

**Example:** 500,000 users arrive for a sale. If load tests show the inventory service safely handles 300 hold transactions/sec, configure a lower initial target, e.g. 200/sec. The waiting room releases users gradually. These are illustrative numbers, not universal capacity guarantees.

Remember the separate responsibilities:
- Waiting room -> controls how many users enter.
- Rate limiter -> controls request rate per show/user/partner.
- Cache -> makes reads cheaper.
- Database transaction -> guarantees seat ownership.

## 9. Scaling and multi-region

- Search: OpenSearch; cache popular searches and show details in Redis.
- Static seat layout: versioned data via CDN/object storage.
- Availability reads: Redis snapshots + WebSocket deltas.
- Writes: PostgreSQL inventory/booking; partition or shard by `show_id` so one show's seats are co-located.
- Hot shows: dedicated capacity, admission control and short transactions.
- Multi-region: assign each show a **home region / single active writer**. Route all booking writes for that show to its owner, regardless of customer location. Replicate for reads/DR.
- Failover: fence the old primary and ensure only one writer epoch is active. Never let two regions independently accept bookings for the same show.

## 10. Core APIs

```text
GET  /cities
GET  /events?city=...&date=...
GET  /shows/{showId}
GET  /shows/{showId}/seat-map
POST /holds
GET  /holds/{holdId}
POST /payments/intents
POST /webhooks/payment
GET  /bookings/{bookingId}
POST /bookings/{bookingId}/cancel
POST /partners/webhooks
```

Partner contracts should also define catalog sync, inventory snapshots, hold, confirm and cancel operations, plus authentication, tenant isolation and rate limits.

## 11. Other production concerns

- **Tickets:** Generate after confirmed booking; store PDF in S3/GCS; QR contains a signed, non-guessable token, not a sequential booking ID.
- **Check-in:** Validate QR and redeem atomically; prevent duplicate scans.
- **Notifications:** Email/SMS are asynchronous and retryable; don't delay booking confirmation.
- **Cancellation:** Check policy, refund, update booking, release resellable inventory, publish updates and notify partners.
- **Security:** HMAC-signed webhooks, authN/authZ, partner isolation, rate limits, audit trail, compliant payment-provider flow.
- **Monitoring:** Hold conflicts, payment/booking mismatches, expired holds, webhook lag, outbox lag, queue length, DB lock waits and per-show QPS.

## 12. Back-of-the-envelope estimate (illustrative)

Assumptions: 10M daily active users; 10 search/browse requests per user/day; 10% of searches open seat maps; 5% of seat-map views attempt holds; 70% of holds convert; 2.5 seats per hold.

- Search: 10M x 10 = 100M/day; average = 100M / 86,400 = **~1,157 QPS**; 8x peak = **~9,300 QPS**.
- Seat maps: 10M/day; average **~116 QPS**; 8x peak = **~930 QPS**.
- Holds: 500K/day; average **~5.8 QPS**; 8x peak ~46 QPS; extra 10x hot-event burst = **~460 hold QPS**.
- Seat changes: 460 holds/sec x 2.5 seats = **~1,150 seat-row changes/sec** in this burst scenario.
- Bookings: 500K holds/day x 70% = **350K bookings/day**.

These are interview assumptions, not actual company traffic or guaranteed sizing. Real limits require load tests and production measurements.

## 13. Interview answer structure

1. Clarify scope: reserved seating vs general admission; cinema vs concerts; one operator vs multiple aggregators.
2. Identify inventory authority and integration model (shared inventory or exclusive allocations).
3. State requirements and draw high-level architecture.
4. Explain entities and `show_id + seat_id` inventory model.
5. Deep dive into concurrent seat holds and all-or-nothing multi-seat booking.
6. Explain payment Saga, webhooks and idempotency.
7. Explain outbox + Kafka + partner synchronization.
8. Handle hot shows with waiting room, rate limiting, cache and single-writer inventory.
9. Cover sharding, multi-region failover and observability.
10. Do a quick BOE calculation.

## 14. Five points to remember

1. **Inventory authority:** Cinema/organizer/their ticketing provider controls sellable inventory; there is no universal government seat database.
2. **No double booking:** All channels call the same authoritative hold/booking operation, or receive exclusive non-overlapping allocations.
3. **Strong writes, eventual displays:** Seat ownership is strongly consistent; partner caches and UIs synchronize asynchronously.
4. **Reliable events:** Use transactional outbox + Kafka/webhooks, with idempotent consumers and reconciliation.
5. **Hot shows:** Waiting room controls admission; rate limits protect capacity; cache protects reads; DB transactions protect correctness.

> **One-line summary:** The aggregator owns the customer experience, but the cinema, organizer or its authorized ticketing provider controls the actual sellable inventory. Every booking channel must coordinate with that authority to prevent double booking.
