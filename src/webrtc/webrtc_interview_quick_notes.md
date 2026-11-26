# WebRTC --- Interview Quick Notes

## 1. What is WebRTC?

**WebRTC (Web Real-Time Communication)** is a set of browser APIs and
protocols that enables real-time audio, video, and data communication
between devices.

-   Supports peer-to-peer (P2P) communication when the network allows
    it.
-   Encrypted by default.
-   Commonly uses UDP for low-latency media transport.
-   Works in browsers and native applications.

**Use cases:** video/voice calls, screen sharing, file transfer, remote
desktop, multiplayer games, and real-time collaboration.

## 2. High-level architecture

``` text
             Signaling server (e.g. NestJS + WebSocket)
                    /                 \
               Browser A           Browser B
                    \                 /
                     \               /
                   ICE connectivity checks
                            |
                 P2P path or TURN relay
```

Important distinction: - **Signaling server:** helps peers find each
other and exchange connection information. - **Media/data path:**
usually flows directly between peers, or through a TURN server when
direct connectivity fails. - The signaling server does not normally
carry the audio/video stream.

## 3. Connection setup: Offer / Answer

1.  Both users join the same call/room through signaling.
2.  Caller creates an `RTCPeerConnection`.
3.  Caller optionally adds microphone, camera, or data-channel tracks.
4.  Caller creates an **SDP offer** and sends it to the other peer
    through signaling.
5.  Callee sets the remote offer, creates an **SDP answer**, and sends
    it back.
6.  Both sides exchange **ICE candidates**.
7.  ICE checks candidate pairs and selects a working network path.
8.  A secure transport is established; media/data can flow.

Simplified browser APIs:

``` js
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: "stun:stun.example.com:3478" },
    {
      urls: "turn:turn.example.com:3478",
      username: "temporary-user",
      credential: "temporary-password"
    }
  ]
});

const offer = await pc.createOffer();
await pc.setLocalDescription(offer);

// Send pc.localDescription to the remote peer via signaling.
```

Remote side:

``` js
await pc.setRemoteDescription(offer);

const answer = await pc.createAnswer();
await pc.setLocalDescription(answer);

// Send pc.localDescription back via signaling.
```

ICE candidate exchange:

``` js
pc.onicecandidate = ({ candidate }) => {
  if (candidate) {
    signalingSocket.emit("ice-candidate", candidate);
  }
};

// On receiving a remote candidate:
await pc.addIceCandidate(candidate);
```

In production, handle candidates that arrive before
`setRemoteDescription` by temporarily queueing them, then add them after
the remote description is set.

## 4. Key concepts

### Signaling

Signaling is the process of exchanging setup information between peers.
It is **not a WebRTC-defined transport**; applications commonly use
WebSocket or Socket.IO.

Typical messages: - `join-room` - `offer` - `answer` - `ice-candidate` -
`leave-room`

### SDP --- Session Description Protocol

A text description of the session's communication capabilities and
parameters.

It can describe: - Audio/video media sections - Supported codecs
(e.g. Opus, VP8, H.264) - ICE credentials - DTLS certificate
fingerprint - Transport and media parameters

SDP is metadata, **not the actual audio/video**.

### ICE --- Interactive Connectivity Establishment

ICE discovers and tests possible network paths between peers.

Common candidate types: - **Host:** local interface address. -
**Server-reflexive (srflx):** public mapped address discovered using
STUN. - **Relay:** address allocated by a TURN server.

ICE performs connectivity checks on candidate pairs and selects a viable
path.

### STUN

STUN helps a device discover the public IP address and port that a STUN
server sees.

It helps with NAT traversal, but **does not relay media** and cannot
solve every NAT/firewall situation.

### TURN

TURN relays traffic when a direct peer-to-peer path cannot be
established.

``` text
Peer A  <---->  TURN server  <---->  Peer B
```

-   More reliable in restrictive networks.
-   Adds latency and server bandwidth cost.
-   Production systems should plan for TURN capacity and cost.

### NAT

NAT allows multiple private-network devices to share a public IP. It can
prevent unsolicited inbound connections, which makes direct P2P
connectivity difficult. ICE, STUN, and TURN work together to find a
usable path.

### DTLS and SRTP

-   **DTLS:** performs the secure handshake and establishes keying
    material.
-   **SRTP:** protects real-time audio/video packets.
-   WebRTC media transport is encrypted; applications should still
    secure signaling and authenticate users.

### Data Channels

`RTCDataChannel` sends arbitrary application data peer-to-peer.

-   Reliable/ordered mode is useful for chat or file transfer.
-   Unreliable/unordered options can suit fast game-state updates where
    newer data is more useful than retransmitting old data.

## 5. Media APIs

Capture microphone/camera:

``` js
const stream = await navigator.mediaDevices.getUserMedia({
  audio: true,
  video: true
});

stream.getTracks().forEach(track => {
  pc.addTrack(track, stream);
});
```

Receive remote media:

``` js
pc.ontrack = ({ streams }) => {
  remoteVideo.srcObject = streams[0];
};
```

Screen sharing:

``` js
const screenStream =
  await navigator.mediaDevices.getDisplayMedia({ video: true });
```

The application must handle permissions, device changes, track stopping,
and browser compatibility.

## 6. NestJS signaling server: responsibility

NestJS generally handles **signaling and call coordination**, not media
processing.

Example event flow:

``` text
Client A -- join-room(room-1) --> NestJS
Client B -- join-room(room-1) --> NestJS

Client A -- offer -------------> NestJS -- offer ------> Client B
Client B -- answer ------------> NestJS -- answer -----> Client A
Client A -- ICE candidate -----> NestJS -- candidate --> Client B
Client B -- ICE candidate -----> NestJS -- candidate --> Client A
```

Simplified Socket.IO gateway idea:

``` ts
@WebSocketGateway({ namespace: "calls", cors: true })
export class SignalingGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage("join-room")
  joinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    // Authenticate/authorize before allowing room access.
    client.join(data.roomId);
  }

  @SubscribeMessage("signal")
  relaySignal(
    @MessageBody() data: { roomId: string; payload: unknown },
    @ConnectedSocket() client: Socket,
  ) {
    // Validate message type, size, room membership and recipient.
    client.to(data.roomId).emit("signal", {
      from: client.id,
      payload: data.payload,
    });
  }
}
```

This is an illustrative starting point, not production-ready. In
production: - Authenticate the socket and authorize room membership. -
Validate payloads and message types; do not trust client-supplied room
IDs. - Route signaling to the intended peer(s), not every user
indiscriminately. - Handle disconnects, reconnects, call cleanup,
timeouts, and duplicate messages. - Use short-lived TURN credentials;
never expose permanent TURN secrets. - Apply rate limits and
message-size limits. - Use a shared adapter/state strategy (e.g. Redis
with Socket.IO) when signaling servers run as multiple instances.

## 7. Scaling: P2P vs SFU vs MCU

### 1-to-1 P2P

``` text
Peer A  <---------->  Peer B
```

Simple and efficient when a direct connection works.

### Mesh P2P (small group)

Every participant sends media to every other participant.

For `N` participants, each participant may need `N-1` outgoing streams.
Upload bandwidth and CPU grow quickly, so mesh is suitable only for
small groups.

### SFU --- Selective Forwarding Unit

``` text
       Peer A
          |
       Peer B ---- SFU ---- Peer C
          |
       Peer D
```

Each participant sends media to the SFU; the SFU selectively forwards
streams to others, usually without decoding and re-encoding them.

-   Common choice for group video meetings.
-   Reduces each client's upload requirement.
-   Requires media servers and significant network capacity.

### MCU --- Multipoint Control Unit

The MCU receives, decodes, mixes, and re-encodes media into combined
output.

-   Can simplify what clients receive.
-   Usually requires more server CPU and processing than an SFU.

**Interview rule of thumb:** 1-to-1 → P2P is often suitable; group calls
→ consider an SFU; use an MCU when server-side media mixing/composition
is required.

## 8. Advantages and trade-offs

**Advantages** - Low-latency real-time communication. - Direct P2P can
reduce media-server bandwidth. - Built-in browser support; no browser
plugin required. - Supports audio, video, screen sharing, and arbitrary
data. - Encrypted media transport.

**Challenges** - NAT/firewall traversal is complex. - TURN relay traffic
costs money and adds latency. - Mesh does not scale well for large
groups. - Network conditions and browser differences make debugging
harder. - Production group calls need an SFU/media-server architecture.

## 9. Common interview questions

**Q: Is WebRTC peer-to-peer?**\
A: It supports P2P, but the path may use a TURN relay. Group calls often
use an SFU.

**Q: Is signaling part of WebRTC?**\
A: WebRTC does not prescribe a signaling protocol. The application
implements signaling, commonly using WebSocket.

**Q: Does STUN carry video?**\
A: No. STUN helps discover the public mapped address. TURN relays
traffic.

**Q: What is the difference between STUN and TURN?**\
A: STUN helps discover network mapping; TURN provides a relay path when
direct connectivity fails.

**Q: What is ICE?**\
A: ICE gathers possible candidates and tests candidate pairs to find a
working connection path.

**Q: What is SDP?**\
A: A session description containing media capabilities and connection
parameters; it is not the media itself.

**Q: Why use UDP?**\
A: Real-time media often prefers low latency over waiting for
retransmission of old packets. WebRTC can also use other transport
mechanisms in some situations.

**Q: How is WebRTC secured?**\
A: DTLS establishes keying material and SRTP protects media. Signaling
still needs authentication and secure transport (HTTPS/WSS).

**Q: How do you scale to 100 participants?**\
A: Avoid full mesh. Use an SFU, deploy it across regions as needed, and
manage signaling separately.

**Q: Does NestJS process video?**\
A: Not in a typical design. NestJS handles authentication, rooms,
signaling, and call coordination. Browsers and the SFU handle media
transport.

## 10. Final mental model

Remember these responsibilities:

  -----------------------------------------------------------------------
  Component                           Responsibility
  ----------------------------------- -----------------------------------
  WebSocket / NestJS                  Signaling: exchange offer, answer,
                                      ICE candidates

  SDP                                 Describes session capabilities and
                                      parameters

  ICE                                 Finds and tests a working network
                                      path

  STUN                                Discovers public mapped IP/port

  TURN                                Relays traffic if direct connection
                                      fails

  DTLS                                Secure handshake and key
                                      establishment

  SRTP                                Encrypts/protects audio and video

  RTCPeerConnection                   Browser API managing the peer
                                      connection

  RTCDataChannel                      Peer-to-peer application data

  SFU                                 Forwards media streams for group
                                      calls

  MCU                                 Mixes and re-encodes media
  -----------------------------------------------------------------------

**One-line interview answer:**\
"WebRTC enables encrypted, low-latency real-time audio, video, and data
communication. Peers exchange SDP offers/answers and ICE candidates
through an application-level signaling server. ICE uses STUN and, when
needed, TURN to establish a network path. For large group calls, an SFU
is commonly used instead of a full-mesh P2P topology."
