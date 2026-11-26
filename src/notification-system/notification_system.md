# Notification System — Interview Quick Notes

## 1. Goal
Build a scalable service that sends **Push, Email, and SMS** asynchronously, with durable processing, duplicate protection, retries, user preferences, and delivery tracking.

## 2. High-Level Architecture

```text
 Business Services (Order / Chat / Auth)
                  |
       DB transaction + Outbox
                  |
           Outbox Relay / CDC
                  |
          Durable Event Broker
           (Kafka / Queue)
                  |
      Notification Orchestrator
      - Idempotency / deduplication
      - Preferences, opt-outs, expiry
      - Template rendering / priority
                  |
        Create delivery tasks
                  |
       +----------+----------+
       |          |          |
   Push Queue  Email Queue  SMS Queue
       |          |          |
   Push Workers Email Workers SMS Workers
       |          |          |
    FCM/APNs  Email Provider SMS Provider
       \          |          /
        Provider callbacks / results
                  |
  PostgreSQL: delivery state + attempts
  Retry scheduler + DLQ + metrics/alerts
```

**Core idea:** accept the request quickly, queue the work durably, and send through independent channel workers. A slow or failed provider should not block other channels.

## 3. Requirements to Mention
- Functional: push/email/SMS, templates, user preferences, scheduling, delivery status.
- Reliability: retries, deduplication, expiry, provider outage handling, dead-letter queue (DLQ).
- Scale: absorb bursts; scale workers independently; respect provider rate limits.
- Security: protect personal data, validate provider webhooks, enforce opt-outs.

## 4. Back-of-the-Envelope (Example)
Assume **10 million daily active users** and **2 logical notifications/user/day**:

- Logical notifications/day = `10M × 2 = 20M`
- Average channels per notification = `1.5`
- Delivery tasks/day = `20M × 1.5 = 30M`
- Average send rate = `30M / 86,400 ≈ 347 tasks/sec`
- If peak is 10× average: `≈ 3,470 tasks/sec`
- At 1.1 attempts per delivery: average attempts `≈ 382/sec`, peak `≈ 3,820/sec`
- If one worker can sustain 40 attempts/sec: `3,820 / 40 ≈ 96 workers` at peak, before safety margin.

These are assumptions, not fixed requirements. Size push, email, and SMS separately because provider quotas and latency differ.

## 5. Minimal Data Model

- **`notification_requests`**: `id`, `tenant_id`, `recipient_id`, `event_type`, `template_key/version`, `payload`, `idempotency_key`, `priority`, `scheduled_at`, `expires_at`.
- **`recipient_endpoints`**: `id`, `recipient_id`, `channel`, encrypted address/token, `is_verified`, `is_active`.
- **`notification_preferences`**: `recipient_id`, `category`, `channel`, `enabled`, quiet hours.
- **`notification_deliveries`**: `id`, `notification_id`, `endpoint_id`, `channel`, `status`, `attempt_count`, `next_attempt_at`, `provider_message_id`, timestamps.
- **`delivery_attempts`**: `delivery_id`, `attempt_no`, `provider`, result/error, timestamps.
- **`outbox_events`**: event ID, aggregate ID, event type, payload, published timestamp.

Useful constraints: unique `(tenant_id, idempotency_key)` for logical requests; unique `(notification_id, endpoint_id)` for delivery creation; unique `(delivery_id, attempt_no)` for attempts. Design idempotency scope carefully so distinct intended notifications are not merged.

## 6. End-to-End Flow
1. Business service commits its business change **and an outbox event in the same DB transaction**.
2. Outbox relay / CDC publishes the event to the broker. It may publish twice, so consumers must be idempotent.
3. Orchestrator deduplicates the event, checks preferences/opt-outs and expiry, renders the template, and creates delivery records.
4. A dispatch outbox (or equivalent durable handoff) publishes delivery IDs to channel queues.
5. Channel workers apply rate limits, send through the provider, and persist outcomes.
6. Provider callbacks update delivery status; monitor queue age, failures, retries, and DLQ.

## 7. Duplicates: What to Say

**Exactly-once external delivery cannot be guaranteed in every case.** Internal processing can be made idempotent, but an external provider can accept a message just before the worker times out or crashes.

- **Duplicate API request:** use a stable idempotency key plus a database unique constraint; return the existing request for the same payload.
- **Duplicate broker event:** make the consumer idempotent; persist a unique event/request identity.
- **Two workers claim one task:** use atomic state transitions/leases and queue visibility/acknowledgement correctly.
- **Provider accepted, worker crashed before DB update:** reuse the same provider idempotency key if supported; otherwise reconcile status where possible, or choose the retry-vs-duplicate trade-off explicitly.
- Deduplicate provider callbacks using the provider event ID; make status updates safe to replay.

## 8. Retry and Failure Handling

| Error | Action |
|---|---|
| Timeout / network error | Treat outcome as possibly ambiguous; reconcile where possible |
| HTTP 429 | Respect `Retry-After`; reduce send rate |
| HTTP 5xx | Retry with backoff and jitter |
| Invalid email / phone / push token | Permanent failure; fix or deactivate endpoint |
| Opt-out / expired notification | Suppress; do not retry |
| Retry limit reached | Move to DLQ / final-failure state; alert and investigate |

Use **bounded exponential backoff + jitter**. Persist `next_attempt_at` or use delayed queues instead of sleeping inside workers. Limit retries by attempt count, elapsed time, and notification expiry. Keep retry/DLQ handling separate per channel.

## 9. Scaling and Production Checklist
- Separate push/email/SMS queues and worker pools.
- Use provider-specific token-bucket rate limits; adding workers cannot exceed provider quotas.
- Keep urgent transactional/security notifications separate from bulk marketing traffic; use quotas/fairness per tenant.
- Recheck current preferences and expiry immediately before sending.
- Track `PENDING → PROCESSING → ACCEPTED → DELIVERED` where supported; also model retry, suppressed, expired, and permanent failure states.
- Provider **accepted** does not mean user **received** it. Delivery receipts differ by channel/provider.
- Use leases/timeouts to recover stuck tasks; never hold a DB transaction open during a provider network call.
- Monitor queue depth and oldest-message age, provider latency/throttling, retry ratio, delivery outcomes, and DLQ size.
- Partition/archive old attempt history; encrypt contact data and validate provider webhooks.

## 10. Interview Summary (30 Seconds)

> I would use a transactional outbox to avoid losing events between business DB commits and publishing. A durable broker buffers work, and a notification orchestrator applies idempotency, preferences, templates, priority, and expiry. It creates per-channel delivery tasks for independent push, email, and SMS workers. PostgreSQL stores durable delivery state and attempt history; workers use provider-specific rate limits, bounded retries with jitter, circuit breakers, and DLQs. Provider callbacks update delivery status. I would design for at-least-once processing and make internal steps idempotent, while being honest that exactly-once external delivery cannot be guaranteed for every provider failure scenario. I would estimate average and peak throughput, then size each channel against its actual provider quotas.

## Remember These 5 Points
1. **Transactional outbox** prevents lost events between a DB commit and broker publish.
2. **Idempotency key + DB uniqueness** protects against duplicate logical requests.
3. **Provider accepted ≠ delivered**; callbacks and receipts are separate signals.
4. **Retries need backoff, jitter, limits, and expiry**; never retry permanent errors blindly.
5. **Provider quotas are the bottleneck**; queues absorb bursts, and channel workers scale independently.
