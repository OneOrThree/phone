// 로컬 방 검사용 도구. 127.0.0.1 임시 포트에만 연결한다.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { WebSocket } from "ws";
import { attachRoom, type RoomOptions } from "../server/room";

export type Message = Record<string, any>;
export type RoomClientSocket = {
  ws: WebSocket;
  id: string;
  welcome: Message;
  /** 앞으로 올 메시지 중 조건에 맞는 첫 메시지. */
  next(predicate: (m: Message) => boolean, ms?: number): Promise<Message>;
  command(type: string, payload?: Record<string, unknown>): Promise<Message>;
  move(actor: unknown): void;
  /** 앞서 보낸 메시지가 모두 처리된 뒤의 스냅샷. */
  settled(): Promise<Message>;
};

export async function startRoom(options: RoomOptions = {}) {
  const server = createServer();
  const close = attachRoom(server, {
    snapshotMs: 20,
    moveMinMs: 0,
    ...options,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const host = `127.0.0.1:${port}`;
  const sockets: WebSocket[] = [];
  let sequence = 0;
  const open = (origin = `http://${host}`, autoPong = true) => {
    const ws = new WebSocket(`ws://${host}/island-room`, { origin, autoPong });
    sockets.push(ws);
    return ws;
  };
  /** autoPong=false는 heartbeat에 답하지 않는 연결을 흉내 낸다. */
  async function connect({ autoPong = true } = {}): Promise<RoomClientSocket> {
    const ws = open(undefined, autoPong);
    const waiters = new Set<{
      predicate: (m: Message) => boolean;
      resolve: (m: Message) => void;
    }>();
    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      for (const waiter of [...waiters])
        if (waiter.predicate(message)) {
          waiters.delete(waiter);
          waiter.resolve(message);
        }
    });
    const next = (predicate: (m: Message) => boolean, ms = 3000) =>
      new Promise<Message>((resolve, reject) => {
        const waiter = {
          predicate,
          resolve: (m: Message) => {
            clearTimeout(timer);
            resolve(m);
          },
        };
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error("로컬 방 응답 시간 초과"));
        }, ms);
        waiters.add(waiter);
      });
    const welcomed = next((m) => m.type === "welcome");
    await once(ws, "open");
    const welcome = await welcomed;
    const command = (type: string, payload: Record<string, unknown> = {}) => {
      const requestId = `t${++sequence}`;
      const result = next(
        (m) => m.type === "command-result" && m.requestId === requestId,
      );
      ws.send(JSON.stringify({ type, requestId, ...payload }));
      return result;
    };
    return {
      ws,
      id: welcome.id,
      welcome,
      next,
      command,
      move: (actor) => ws.send(JSON.stringify({ type: "move", actor })),
      async settled() {
        // 같은 연결의 메시지는 순서대로 처리된다. 상태를 바꾸지 않는 명령의 응답 뒤 스냅샷을 본다.
        await command("travel", { island: "nowhere" });
        return next((m) => m.type === "snapshot");
      },
    };
  }
  async function stop() {
    for (const ws of sockets) ws.terminate();
    close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return { host, connect, open, stop };
}

export const resident = (snapshot: Message, id: string) =>
  snapshot.residents.find((p: Message) => p.id === id);
export const reservation = (snapshot: Message, seatId: number) =>
  snapshot.reservations.find((r: Message) => r.seatId === seatId);
