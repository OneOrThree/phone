import { RoomEngine } from "./room-engine.ts";

const PING = '{"type":"ping"}';
const PONG = '{"type":"pong"}';
const MAX_BYTES = 2048;
const STALE_MS = 5 * 60 * 1000;

// 앱 운영 API와 별개인 공개 체험용 방. 사용자가 지정한 방 ID를 받지 않는다.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz")
      return Response.json({
        ok: true,
        service: "cattus-3d-room",
        protocol: 1,
      });
    if (url.pathname !== "/island-room")
      return new Response("Not found", { status: 404 });
    if (
      request.method !== "GET" ||
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
    )
      return new Response("WebSocket required", { status: 426 });
    if (request.headers.get("Origin") !== env.ALLOWED_ORIGIN)
      return new Response("Origin not allowed", { status: 403 });
    const id = env.ISLAND_ROOM.idFromName("public-island-v1");
    return env.ISLAND_ROOM.get(id).fetch(request);
  },
};

export class IslandRoom {
  constructor(ctx) {
    this.ctx = ctx;
    this.engine = new RoomEngine();
    this.connections = new Map();
    this.flushTimer = null;
    for (const ws of ctx.getWebSockets()) {
      const saved = ws.deserializeAttachment();
      if (!saved?.peer || ws.readyState !== 1) continue;
      this.engine.peers.set(saved.peer.id, saved.peer);
      this.connections.set(ws, saved);
    }
    // 아무도 움직이지 않으면 JS 타이머 없이 절전 상태에서도 연결을 유지한다.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }
  async fetch() {
    const peer = this.engine.join(crypto.randomUUID());
    if (!peer)
      return new Response("Room full", {
        status: 503,
        headers: { "Retry-After": "30" },
      });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const saved = { peer, seenAt: Date.now(), windowAt: Date.now(), count: 0 };
    this.connections.set(server, saved);
    server.serializeAttachment(saved);
    server.send(JSON.stringify(this.engine.welcome(peer)));
    this.broadcast();
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + 60000);
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, raw) {
    const saved = this.connections.get(ws);
    if (!saved) return;
    if (
      typeof raw !== "string" ||
      new TextEncoder().encode(raw).length > MAX_BYTES
    ) {
      this.remove(ws, 1009, "Message too large");
      return;
    }
    const at = Date.now();
    if (at - saved.windowAt >= 1000) {
      saved.windowAt = at;
      saved.count = 0;
    }
    if (++saved.count > 30) {
      this.remove(ws, 1008, "Too many messages");
      return;
    }
    const before = JSON.stringify([saved.peer.actor, saved.peer.session]);
    try {
      const reply = this.engine.receive(saved.peer, raw);
      saved.seenAt = at;
      ws.serializeAttachment(saved);
      if (reply) ws.send(JSON.stringify(reply));
      if (before !== JSON.stringify([saved.peer.actor, saved.peer.session]))
        this.scheduleSnapshot();
    } catch {
      this.remove(ws, 1008, "Invalid message");
    }
  }
  scheduleSnapshot() {
    if (this.flushTimer !== null) return;
    // 움직임이 몰려도 최대 10Hz로 한 번만 직렬화·전송한다. 유휴 상태에서는 타이머가 없다.
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.broadcast();
    }, 100);
  }
  broadcast() {
    const payload = JSON.stringify(this.engine.snapshot());
    for (const ws of this.connections.keys()) {
      try {
        ws.send(payload);
      } catch {
        this.remove(ws, 1011, "Connection lost");
      }
    }
  }
  remove(ws, code = 1000, reason = "") {
    const saved = this.connections.get(ws);
    if (!saved) return;
    this.connections.delete(ws);
    this.engine.peers.delete(saved.peer.id);
    try {
      if (ws.readyState < 2) ws.close(code, reason);
    } catch {
      /* 이미 닫힌 연결 */
    }
    this.scheduleSnapshot();
  }
  webSocketClose(ws) {
    this.remove(ws);
  }
  webSocketError(ws) {
    this.remove(ws, 1011, "Connection lost");
  }
  async alarm() {
    const at = Date.now();
    for (const [ws, saved] of this.connections) {
      const ping =
        this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      if (at - Math.max(saved.seenAt, ping) > STALE_MS)
        this.remove(ws, 1001, "Inactive connection");
    }
    if (this.connections.size) await this.ctx.storage.setAlarm(at + 60000);
  }
}
