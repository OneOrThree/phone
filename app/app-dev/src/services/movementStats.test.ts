/**
 * 이동 동기화 실기기 집계(GROMO-2250, 개발 전용) — 백분위·RTT 짝·Snapshot 간격·점프·재접속·게이트·출력 문자열.
 */
import assert from 'node:assert/strict';
import { createMovementStats, pct } from '@/services/movementStats';

const ME = 'me';
const clock = () => {
  const c = { t: 0, now: () => c.t };
  return c;
};
const snap = (moving: boolean) => ({
  type: 'Snapshot',
  entities: [{ state: moving ? 'MOVING' : 'IDLE' }],
});

describe('movementStats', () => {
  test('pct 는 최근접 순위 a[ceil(p·n)−1], 빈 배열은 null', () => {
    assert.equal(pct([], 0.5), null);
    assert.equal(pct([10, 20, 30, 40], 0.5), 20);
    assert.equal(pct([10, 20, 30, 40], 0.99), 40);
    assert.equal(pct([7], 0.01), 7);
  });

  test('RTT 는 같은 commandSeq 의 내 PathAccepted 만 — 다른 사람·모르는 seq 는 무시, MoveRejected 는 대기만 지운다', () => {
    const c = clock();
    const s = createMovementStats(c.now);
    s.reset();
    s.sent(1);
    s.sent(2);
    c.t = 40;
    s.onMessage({ type: 'PathAccepted', userId: 'other', commandSeq: 1 }, ME);
    s.onMessage({ type: 'PathAccepted', userId: ME, commandSeq: 9 }, ME);
    assert.equal(s.summary().rtt.count, 0);
    c.t = 60;
    s.onMessage({ type: 'PathAccepted', userId: ME, commandSeq: 1 }, ME);
    s.onMessage({ type: 'MoveRejected', userId: ME, commandSeq: 2 }, ME);
    const r = s.summary();
    assert.deepEqual([r.rtt.count, r.rtt.max, r.pending], [1, 60, 0]);
  });

  test('Snapshot 간격은 직전이 MOVING 일 때만, ≥100ms 비율', () => {
    const c = clock();
    const s = createMovementStats(c.now);
    s.reset();
    s.onMessage(snap(true), ME); // 0
    c.t = 50;
    s.onMessage(snap(false), ME); // 50 push
    c.t = 500;
    s.onMessage(snap(true), ME); // 직전 IDLE — 정지 뒤 공백 제외
    c.t = 650;
    s.onMessage(snap(true), ME); // 150 push
    const r = s.summary().snapshot;
    assert.deepEqual([r.count, r.p50, r.over100Ratio], [2, 50, 0.5]);
  });

  test('opened 는 Snapshot 짝을 끊고, 재접속 횟수·FullState 시간을 잰다', () => {
    const c = clock();
    const s = createMovementStats(c.now);
    s.reset();
    s.opened(false);
    c.t = 96;
    s.onMessage({ type: 'FullState' }, ME);
    s.onMessage(snap(true), ME);
    c.t = 1000;
    s.opened(true);
    c.t = 1050;
    s.onMessage(snap(true), ME); // opened 뒤 첫 스냅샷 — 간격 없음
    c.t = 1412;
    s.onMessage({ type: 'FullState' }, ME);
    c.t = 1500;
    s.onMessage({ type: 'FullState' }, ME); // 두 번째 FullState 는 무시
    const r = s.summary();
    assert.deepEqual(
      [r.reconnects, r.firstFullStateMs, r.lastReconnectToFullStateMs, r.snapshot.count],
      [1, 96, 412, 0],
    );
  });

  test('점프는 이미지 px 최댓값만 갱신하고 그때의 배율로 화면 px 를 남긴다(0 무시)', () => {
    const s = createMovementStats(() => 0);
    s.reset();
    s.jump({ x: 0, y: 0 }, { x: 0, y: 0 }, 9);
    assert.equal(s.summary().jump.maxImagePx, 0);
    s.jump({ x: 0, y: 0 }, { x: 3, y: 4 }, 2);
    s.jump({ x: 0, y: 0 }, { x: 1, y: 0 }, 10);
    assert.deepEqual(s.summary().jump, { maxImagePx: 5, maxScreenPx: 10, scaleAtMax: 2 });
  });

  test('reset 전·stop 뒤에는 기록하지 않는다', () => {
    const s = createMovementStats(() => 0);
    s.sent(1);
    s.opened(true);
    s.jump({ x: 0, y: 0 }, { x: 5, y: 0 }, 1);
    s.reset();
    s.stop();
    s.sent(2);
    s.opened(true);
    s.jump({ x: 0, y: 0 }, { x: 5, y: 0 }, 1);
    const r = s.summary();
    assert.deepEqual([r.pending, r.reconnects, r.jump.maxImagePx], [0, 0, 0]);
  });

  test('format 2줄 — 표본이 있으면 숫자, 없으면 —', () => {
    const c = clock();
    const s = createMovementStats(c.now);
    s.reset();
    assert.equal(
      s.format(),
      'RTT 0건 — (대기 0) | Snap 0건 —\n점프 — · 재접속 0 · FullState —(첫 —) · 0s',
    );
    s.opened(false);
    s.sent(1);
    s.sent(2);
    s.onMessage(snap(true), ME);
    c.t = 58;
    s.onMessage({ type: 'PathAccepted', userId: ME, commandSeq: 1 }, ME);
    c.t = 96;
    s.onMessage({ type: 'FullState' }, ME);
    c.t = 146;
    s.onMessage(snap(true), ME);
    s.jump({ x: 0, y: 0 }, { x: 31, y: 0 }, 0.75);
    c.t = 72_000;
    assert.equal(
      s.format(),
      'RTT 1건 p50 58 · p99 58 · max 58ms (대기 1) | Snap 1건 p50 146 · p99 146 · ≥100ms 100.0%\n' +
        '점프 max 23px(img 31 · z0.75) · 재접속 0 · FullState —(첫 96ms) · 72s',
    );
  });
});
