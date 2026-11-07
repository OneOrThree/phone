import { WebSocket } from "ws";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
const url = "ws://127.0.0.1:8787/island-room";
const origin = "http://127.0.0.1:4176";
const clients = [];
const checks = [];
async function connect() {
  const ws = new WebSocket(url, { origin });
  const queue = [];
  const waiters = [];
  ws.on("message", (raw) => {
    const data = JSON.parse(raw);
    queue.push(data);
    for (const f of [...waiters]) f();
  });
  const next = (predicate) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(check), 1);
        reject(new Error("Worker response timeout"));
      }, 4000);
      function check() {
        const i = queue.findIndex(predicate);
        if (i < 0) return;
        clearTimeout(timer);
        const j = waiters.indexOf(check);
        if (j >= 0) waiters.splice(j, 1);
        resolve(queue.splice(i, 1)[0]);
      }
      waiters.push(check);
      check();
    });
  let sequence = 0;
  const client = {
    ws,
    queue,
    next,
    command: async (type, fields = {}) => {
      const requestId = String(++sequence);
      ws.send(JSON.stringify({ type, requestId, ...fields }));
      return next(
        (m) => m.type === "command-result" && m.requestId === requestId,
      );
    },
  };
  clients.push(client);
  client.welcome = await next((m) => m.type === "welcome");
  return client;
}
try {
  assert.equal((await fetch("http://127.0.0.1:8787/healthz")).status, 200);
  assert.equal((await fetch("http://127.0.0.1:8787/unknown")).status, 404);
  assert.equal((await fetch("http://127.0.0.1:8787/island-room")).status, 426);
  const bad = new WebSocket(url, { origin: "https://evil.example" });
  const code = await new Promise((resolve) => {
    bad.on("unexpected-response", (_, r) => {
      resolve(r.statusCode);
      r.resume();
      bad.terminate();
    });
    bad.on("error", () => {});
  });
  assert.equal(code, 403);
  checks.push("공개 경로·Origin 제한");
  const a = await connect(),
    b = await connect();
  await Promise.all([
    a.command("travel", { island: "focus" }),
    b.command("travel", { island: "focus" }),
  ]);
  const claims = await Promise.all([
    a.command("claim-seat", { seatId: 0, subject: "검증" }),
    b.command("claim-seat", { seatId: 0, subject: "검증" }),
  ]);
  assert.equal(claims.filter((x) => x.ok).length, 1);
  checks.push("실제 Worker 두 연결의 같은 의자 동시 예약 배타성");
  const winner = claims[0].ok ? a : b,
    other = winner === a ? b : a;
  const paused = await winner.command("pause-focus");
  assert.equal(paused.session.status, "paused");
  assert.equal((await other.command("claim-seat", { seatId: 0 })).ok, false);
  const resumed = await winner.command("resume-focus");
  assert.equal(resumed.session.seatId, 0);
  assert.equal(resumed.session.subject, "검증");
  assert.equal((await winner.command("finish-focus")).result.subject, "검증");
  checks.push("휴식 예약·이어가기·종료");
  await other.command("claim-seat", { seatId: 0 });
  other.ws.close();
  await winner.next(
    (m) =>
      m.type === "snapshot" &&
      !m.residents.some((r) => r.id === other.welcome.id),
  );
  assert.equal((await winner.command("claim-seat", { seatId: 0 })).ok, true);
  checks.push("퇴장 뒤 즉시 좌석 해제");
  await new Promise((r) => setTimeout(r, 250));
  winner.queue.length = 0;
  winner.ws.send('{"type":"ping"}');
  await winner.next((m) => m.type === "pong");
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(winner.queue.filter((m) => m.type === "snapshot").length, 0);
  checks.push("유휴 방은 snapshot 반복 전송 없이 자동 heartbeat 응답");
  const oversize = await connect();
  const closed = new Promise((r) => oversize.ws.once("close", r));
  oversize.ws.send("x".repeat(2049));
  assert.equal(await closed, 1009);
  checks.push("큰 메시지 차단");
  await mkdir("artifacts/optimization", { recursive: true });
  await writeFile(
    "artifacts/optimization/worker.json",
    JSON.stringify({ checks, passed: checks.length, localOnly: true }, null, 2),
  );
  console.log({ passed: checks.length, checks });
} finally {
  for (const c of clients) c.ws.close();
}
