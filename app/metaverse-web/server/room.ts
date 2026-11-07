import { ROOM_CAPACITY } from "../src/layout.ts";
import { randomUUID } from "node:crypto";
import type { HttpServer } from "vite";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { RoomEngine, type Peer, type RoomOptions } from "./room-engine.ts";
export type { RoomOptions } from "./room-engine.ts";
export function attachRoom(server: HttpServer, options: RoomOptions = {}) {
  const engine = new RoomEngine(options.now, options.moveMinMs);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  const peers = new Map<WebSocket, Peer>();
  let upgrading = 0;
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.split("?")[0] !== "/island-room") return;
    const origin = req.headers.origin;
    try {
      if (
        !origin ||
        new URL(origin).host !== req.headers.host ||
        peers.size + upgrading >= ROOM_CAPACITY
      ) {
        socket.destroy();
        return;
      }
    } catch {
      socket.destroy();
      return;
    }
    // 동시에 들어온 업그레이드도 정원 60을 넘지 않게 핸드셰이크 중인 연결을 센다.
    upgrading++;
    let counted = true;
    const release = () => {
      if (counted) upgrading--;
      counted = false;
    };
    socket.once("close", release);
    wss.handleUpgrade(req, socket, head, (ws) => {
      release();
      wss.emit("connection", ws);
    });
  });
  const remove = (ws: WebSocket) => {
    const peer = peers.get(ws);
    if (peer) engine.peers.delete(peer.id);
    peers.delete(ws);
  };
  wss.on("connection", (ws: WebSocket) => {
    const peer = engine.join(randomUUID());
    if (!peer) {
      ws.close(1013, "방이 가득 찼어요");
      return;
    }
    peers.set(ws, peer);
    const reply = (payload: unknown) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    };
    reply(engine.welcome(peer));
    ws.on("pong", () => {
      peer.alive = true;
    });
    ws.on("message", (raw, isBinary) => {
      try {
        if (isBinary || !peers.has(ws)) return;
        const result = engine.receive(peer, raw.toString());
        if (result) reply(result);
      } catch {
        /* 잘못된 메시지는 상태를 바꾸지 않는다. */
      }
    });
    ws.on("close", () => remove(ws));
    ws.on("error", () => {
      remove(ws);
      ws.terminate();
    });
  });
  const snapshots = setInterval(() => {
    if (!peers.size) return;
    const payload = JSON.stringify(engine.snapshot());
    for (const ws of peers.keys())
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536)
        ws.send(payload);
  }, options.snapshotMs ?? 100);
  // pong이 없으면 연결을 끊고 같은 자리에서 좌석·휴식 예약도 해제한다.
  const heartbeat = setInterval(() => {
    for (const [ws, peer] of peers) {
      if (!peer.alive) {
        remove(ws);
        ws.terminate();
        continue;
      }
      peer.alive = false;
      try {
        ws.ping();
      } catch {
        remove(ws);
        ws.terminate();
      }
    }
  }, options.heartbeatMs ?? 10000);
  const close = () => {
    clearInterval(snapshots);
    clearInterval(heartbeat);
    for (const ws of peers.keys()) ws.terminate();
    peers.clear();
    engine.peers.clear();
    wss.close();
  };
  server.once("close", close);
  return close;
}
