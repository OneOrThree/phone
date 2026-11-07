import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Worker 전송 계층은 플랫폼 JS이며 상태 엔진은 TypeScript로 검사한다.
import worker, { IslandRoom } from "../server/worker.mjs";
import { RoomEngine } from "../server/room-engine";

test("DO 절전 복원 뒤에도 집중 예약·휴식 시간·주제가 유지된다", () => {
  const engine = new RoomEngine();
  const peer = engine.join("saved-cat")!;
  engine.receive(
    peer,
    JSON.stringify({ type: "travel", requestId: "1", island: "focus" }),
  );
  engine.receive(
    peer,
    JSON.stringify({
      type: "claim-seat",
      requestId: "2",
      seatId: 4,
      subject: "읽기",
    }),
  );
  engine.receive(peer, JSON.stringify({ type: "pause-focus", requestId: "3" }));
  const saved = JSON.parse(
    JSON.stringify({
      peer,
      seenAt: Date.now(),
      windowAt: Date.now(),
      count: 0,
    }),
  );
  const global = globalThis as any;
  const previous = global.WebSocketRequestResponsePair;
  global.WebSocketRequestResponsePair = class {};
  try {
    const ws = { readyState: 1, deserializeAttachment: () => saved };
    const restored = new IslandRoom({
      getWebSockets: () => [ws],
      setWebSocketAutoResponse() {},
    });
    const p = restored.engine.peers.get("saved-cat");
    assert.equal(p.session.status, "paused");
    assert.equal(p.session.seatId, 4);
    assert.equal(p.session.subject, "읽기");
    const other = restored.engine.join("other");
    restored.engine.receive(
      other,
      JSON.stringify({ type: "travel", requestId: "4", island: "focus" }),
    );
    const result = restored.engine.receive(
      other,
      JSON.stringify({ type: "claim-seat", requestId: "5", seatId: 4 }),
    );
    assert.equal(result.ok, false);
    assert.equal(
      restored.engine.receive(
        p,
        JSON.stringify({ type: "resume-focus", requestId: "6" }),
      ).ok,
      true,
    );
    assert.equal(p.session.elapsedMs, peer.session!.elapsedMs);
  } finally {
    global.WebSocketRequestResponsePair = previous;
  }
});

test("공개 Worker는 등록한 출처와 단일 방 경로만 연결한다", async () => {
  let forwarded = 0;
  const env = {
    ALLOWED_ORIGIN: "https://try.oneorthree.world",
    ISLAND_ROOM: {
      idFromName: (id: string) => {
        assert.equal(id, "public-island-v1");
        return id;
      },
      get: () => ({
        fetch: () => {
          forwarded++;
          return new Response("ok");
        },
      }),
    },
  };
  for (const origin of [
    "https://evil.example",
    "null",
    "https://try.oneorthree.world.evil.example",
  ]) {
    const r = await worker.fetch(
      new Request("https://room.example/island-room", {
        headers: { Upgrade: "websocket", Origin: origin },
      }),
      env,
    );
    assert.equal(r.status, 403);
  }
  const r = await worker.fetch(
    new Request("https://room.example/island-room", {
      headers: { Upgrade: "websocket", Origin: env.ALLOWED_ORIGIN },
    }),
    env,
  );
  assert.equal(r.status, 200);
  assert.equal(forwarded, 1);
});
