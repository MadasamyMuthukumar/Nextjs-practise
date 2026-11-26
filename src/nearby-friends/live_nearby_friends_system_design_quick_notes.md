# Live Nearby Friends — System Design Quick Notes

## 1. Goal
Let a group of friends share live locations on a map. Each member sees the others move in near real time, even when friends are in different countries.

## 2. Functional Requirements
- Create a sharing group; invite/join/leave members.
- Start and stop location sharing; sharing can expire.
- Send latitude, longitude, timestamp, accuracy, and sequence/version.
- Show each friend's latest location and live/stale/offline status.
- Load an initial snapshot and continue receiving live updates.
- Only authorized group members can see each other.

## 3. Non-Functional Goals
- Low latency: target ~0.5–1 second in normal conditions.
- Scale to millions of active devices.
- Handle disconnects, duplicate/out-of-order updates, and region failures.
- Protect location privacy and avoid unnecessary battery/network usage.

## 4. High-Level Architecture
```text
Mobile App (GPS)
   │ WebSocket / HTTPS
   ▼
Regional API Gateway + WebSocket Gateway
   ▼
Location Ingestion Service ─────► PostgreSQL
   │                              (users, groups, memberships, permissions)
   ├────► Redis Cluster
   │       (latest location + TTL)
   ▼
Realtime Event Bus / Pub-Sub
   ▼
Group Fanout + Connection Directory
   ▼
Regional WebSocket Gateways
   ▼
Friends' Apps (update map markers)
```

## 5. Location Update Flow
1. Phone reads GPS and sends a location update.
2. Backend authenticates the user and checks active sharing permissions.
3. Validate coordinates, timestamp, sequence/version, and rate limits.
4. Atomically update that user's latest location in Redis and refresh its TTL.
5. Publish a `location.updated` event.
6. Fanout routes the event only to authorized sharing-group members who are connected.
7. Their WebSocket gateways push it to their apps; clients update the map marker if the version is newer.

## 6. How to Store Data
- **PostgreSQL:** user accounts, group metadata, members, sharing permissions, expiry settings.
- **Redis / fast distributed cache:** latest location per user, update timestamp/version, freshness TTL.
- **Realtime event bus:** distribute location events across ingestion and gateway instances.
- **Optional history store:** only if route history is a product requirement and retention/consent rules are defined.

**Key rule:** Do not write every one-second GPS update as a permanent PostgreSQL row by default. The live map usually needs the latest state, not the full history.

## 7. Live Delivery
- Use WebSockets instead of polling every second.
- Keep a connection directory: user/group subscription → WebSocket gateway.
- Fanout sends each update to the sender's authorized group members, not to every user in the system.
- Coalesce pending updates for slow clients: send the newest position instead of queueing every intermediate point.
- On reconnect, fetch a fresh snapshot, resubscribe, and resume live updates.

## 8. Different Countries / Multi-Region
- Users connect to a nearby healthy regional gateway (e.g., India, Europe, USA).
- Each region handles local connections and location ingestion.
- Publish events to a cross-region routing layer; relay updates only to regions with authorized recipients.
- Keep group membership/permissions authoritative and replicate metadata carefully.
- Use per-user sequence/version checks; global ordering of every friend's updates is unnecessary.
- If a region fails, reconnect users elsewhere, reauthenticate, fetch a fresh snapshot, then resume updates.
- Consider legal/data-residency requirements before replicating precise locations across borders.

**Simpler first version:** Give each group a home region for coordination. At larger global scale, use regional ingestion and distributed fanout to reduce cross-region latency.

## 9. Scale Example
Assume 1 million active devices, each sending 1 update/second:
- Ingestion: about **1 million updates/second**.
- Average group size 8 (including sender): about **7 million recipient deliveries/second** before batching and optimizations.

Scale with horizontal ingestion workers, sharded Redis, partitioned event routing, multiple fanout workers/gateways, batching, rate limits, backpressure, and load testing.

## 10. Common Failure Cases
- **Duplicate/out-of-order update:** use event IDs and sequence/version checks.
- **Lost connection:** mark location stale after a threshold; refresh snapshot on reconnect.
- **Slow recipient:** coalesce updates and apply backpressure.
- **Cache/node failure:** use replication/failover; recover live state from fresh device updates.
- **Sharing stopped/revoked:** stop future delivery immediately and remove subscriptions.
- **Unauthorized access:** validate membership/permission on reads and subscriptions; never trust a client-supplied user ID.

## 11. Geospatial Index — Do We Need It?
- **Show my current sharing group:** usually no geo index required; get locations by member IDs and plot coordinates.
- **Find friends within 2 km:** use a spatial lookup such as Redis GEO, H3/geohash, PostGIS, or OpenSearch/Elasticsearch, depending on workload.

Group membership answers **who can receive the update**. A geo index answers **who is geographically nearby**.

## 12. Interview Summary
> Phones send GPS updates to nearby regional gateways. The backend validates each update, stores only the latest position in Redis with freshness metadata, and publishes an event. A partitioned fanout system routes it to authorized group members through WebSockets. PostgreSQL stores group membership and permissions. Use versions for ordering, TTL/staleness, reconnect snapshots, coalescing, sharding, and regional failover. Add a geo index only for radius-based discovery.
