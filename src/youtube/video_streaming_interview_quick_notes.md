# Video Streaming System Design — Interview Quick Notes

## 1. High-level flow

```text
Upload source video
  -> Object storage (raw file)
  -> Durable queue / workflow
  -> Validate + transcode into multiple qualities
  -> Package into segments + manifests
  -> Store media objects
  -> Mark video READY

Viewer presses Play
  -> Playback API checks permissions
  -> Returns manifest URL
  -> Player reads manifest and requests segments over HTTPS
  -> CDN serves cached segments; cache misses go to shield/origin
  -> Player buffers, decodes, displays and adapts quality
```

**Core rule:** application servers handle metadata, authorization and workflow; object storage holds media; CDN delivers video bytes. Do not proxy all video traffic through API servers.

## 2. Know the terms

- **Codec** (H.264, HEVC, AV1): compresses video/audio.
- **Container** (MP4, MPEG-TS, fragmented MP4): packages encoded tracks and timestamps.
- **Transcoding:** creates different resolutions/bitrates/codecs, e.g. 360p, 480p, 720p, 1080p.
- **Packaging:** arranges encoded media into segments, creates playlists/manifests and related files. It need not re-encode the video.
- **Segment:** a small consecutive piece of media, often a few seconds for VOD.
- **Manifest/playlist:** tells the player which variants and segments are available.
- **CDN:** distributed edge caches that serve media close to viewers.

## 3. Segments and packaging

Example: 10-minute video, 4-second target segments -> about `600 / 4 = 150` segments per rendition.

```text
video/v1/
  master.m3u8
  360p/index.m3u8 + segments...
  720p/index.m3u8 + segments...
  1080p/index.m3u8 + segments...
  audio/ and subtitles/ (if separate)
```

- Segment size roughly equals `bitrate × duration / 8`. At 2.5 Mbps × 4 seconds: about 1.25 MB (before overhead).
- Segment boundaries should align with suitable keyframes/random-access points; renditions need compatible timelines for clean quality switching.
- Publish manifests only after referenced assets are available and validated.
- Use versioned immutable paths such as `videoId/v1/...`; publish a new version rather than overwriting cached segments.

## 4. HLS vs MPEG-DASH

- **HLS:** uses `.m3u8` playlists. A master playlist lists variants; each media playlist lists segment URLs/durations. Segments can be MPEG-TS (`.ts`) or fragmented MP4 (`.m4s` + init segment).
- **MPEG-DASH:** commonly uses an `.mpd` XML manifest with representations and segment addressing; often uses fragmented MP4.
- Both support VOD/live and adaptive bitrate streaming. Choose based on device/player support, DRM and product requirements; some platforms support both.
- **CMAF:** compatible HLS/DASH configurations can sometimes reuse fragmented MP4 media assets with separate manifests.

## 5. Protocols and playback

- Typical VOD: HLS or DASH describes media; **HTTP/HTTPS** transfers manifests and segments; CDN caches/delivers them.
- HTTP/2 or HTTP/3 may be used depending on client/CDN. No custom transport protocol is usually needed.
- Progressive MP4 over HTTP Range can work, but a single-bitrate file does not inherently provide adaptive bitrate switching.
- RTMP is often used for live ingest; WebRTC is for interactive, very-low-latency media—not typical VOD delivery.

## 6. Adaptive Bitrate (ABR)

Player estimates throughput and checks buffer/device capability, then selects the next segment's rendition.

```text
Fast network + healthy buffer -> higher bitrate/resolution
Network slows                 -> lower rendition to avoid rebuffering
Network recovers              -> gradually switch up
```

Player follows HLS/DASH manifest and requests segments for the selected quality. Smooth switching requires aligned segment timelines/keyframes. Manual quality selection may prioritize chosen quality over uninterrupted playback.

## 7. CDN and storage

- Object storage stores raw source, renditions, manifests, segments, thumbnails and subtitles.
- Database stores metadata/status/object keys—not the video bytes.
- Player requests manifest/segments from CDN edge. Cache hit -> edge serves; miss -> regional origin shield -> object storage.
- CDN reduces viewer latency and origin bandwidth. Use long cache TTLs for immutable, versioned segments; tune manifest TTL separately.
- For private/premium video, enforce authorization with signed URLs/cookies, protected origins and DRM where required. Cached bytes must not bypass access control.

## 8. Production reliability / edge cases

- Upload: multipart/resumable, per-part integrity checks, short-lived scoped signed upload, clean abandoned multipart sessions.
- Processing: durable queue, bounded retries/backoff, idempotency key such as `(video_id, source_version, pipeline_version, rendition)`.
- Use transactional outbox/CDC when a DB state change must reliably produce an event; consumers must tolerate duplicates.
- Do not publish incomplete manifests. If worker retries, make outputs deterministic/versioned and publication conditional.
- Deletion/privacy change during encoding: check current video status/version before publishing; disable access promptly.
- Cache stampede/origin overload: request coalescing, origin shield, cache warming for known events, rate limits.
- Monitor startup time, rebuffer ratio, segment download time, CDN hit ratio, origin egress, encoding queue lag/failures, and playback errors.

## 9. Quick BOE example

Assumptions: 30M peak concurrent viewers × 3 Mbps average bitrate:

`30M × 3 Mbps = 90 Tbps` global video egress.

If CDN serves 95% of bytes, illustrative origin-miss traffic is `90 × 5% = 4.5 Tbps`. This shows why global CDN + shield + cache strategy is fundamental. These are assumptions, not actual YouTube metrics.

## 10. Interview answer in 30 seconds

“Upload directly to object storage with resumable multipart upload. A durable workflow validates the source and transcodes multiple renditions. A packager creates aligned media segments and HLS playlists/DASH MPD, which are stored as versioned objects. The playback API authorizes access and returns the manifest URL. The player fetches segments over HTTPS through a global CDN, adapts quality based on throughput and buffer, and decodes locally. Keep video bytes off API servers; use idempotent jobs, conditional publication, cache shields, access-aware CDN controls and multi-region recovery.”
