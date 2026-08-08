// blockPause 유닛 테스트(GROMO-1214 코드리뷰 ⑤) — 일시정지가 서버에서 집중으로 계상되던 돈 경로.
//
// 잠그는 것:
//  1) 수동 일시정지 구간이 방해초로 잡힌다(안 잡히면 서버가 그 시간을 집중으로 지급·집계한다).
//  2) 정산 후(새 블록 시작) 리셋된다 — 세션 누적을 매 블록에 중복으로 실으면 과다 차감이다.
//  3) 정지 중 정산(정지 상태에서 정지 버튼)도 열린 구간까지 센다.
//  4) 일시정지가 없으면 0 — 뽀모도로 휴식·실드 이탈 크레딧은 여기 들어오지 않으므로 그대로 0이다.
import {
  newBlockPause,
  pauseStart,
  pauseEnd,
  blockPauseSeconds,
  type BlockPause,
} from './blockPause';

const T0 = 1_800_000_000_000; // 기준 시각(ms)

test('일시정지가 없으면 방해초 0 — 뽀모도로 휴식·실드 크레딧은 애초에 여기 안 들어온다', () => {
  const b = newBlockPause(undefined, T0);
  expect(blockPauseSeconds(b, T0 + 25 * 60 * 1000)).toBe(0);
  expect(b.count).toBe(0);
});

test('정지 → 재개 구간이 방해초로 잡히고 횟수도 센다', () => {
  let b: BlockPause = newBlockPause(undefined, T0);
  b = pauseStart(b, T0 + 60_000); // 1분 집중 후 정지
  b = pauseEnd(b, T0 + 660_000); // 10분 정지 후 재개
  expect(blockPauseSeconds(b, T0 + 720_000)).toBe(600);
  expect(b.count).toBe(1);
});

test('여러 번 정지하면 누적되고 횟수도 누적된다', () => {
  let b: BlockPause = newBlockPause(undefined, T0);
  b = pauseEnd(pauseStart(b, T0), T0 + 30_000);
  b = pauseEnd(pauseStart(b, T0 + 60_000), T0 + 90_000);
  expect(blockPauseSeconds(b, T0 + 120_000)).toBe(60);
  expect(b.count).toBe(2);
});

// 정지 버튼은 일시정지 중에도 눌린다 — 열린 구간을 안 세면 그 정지분이 집중으로 남는다.
test('정지 중 정산이면 아직 안 닫힌 구간까지 센다', () => {
  const b = pauseStart(newBlockPause(undefined, T0), T0 + 60_000);
  expect(blockPauseSeconds(b, T0 + 360_000)).toBe(300);
});

// 이게 이 항목에서 제일 중요하다 — 리셋을 빼먹으면 세션 누적이 매 블록에 실려 과다 차감된다.
test('새 블록 시작(정산 후)에 리셋된다 — 이전 블록 방해초가 넘어오지 않는다', () => {
  let b: BlockPause = newBlockPause(undefined, T0);
  b = pauseEnd(pauseStart(b, T0), T0 + 600_000);
  expect(blockPauseSeconds(b, T0 + 600_000)).toBe(600);

  const next = newBlockPause(b, T0 + 600_000);
  expect(blockPauseSeconds(next, T0 + 900_000)).toBe(0);
  expect(next.count).toBe(0);
});

test('정지 중에 블록이 바뀌면 남은 정지분만 새 블록 몫이 된다', () => {
  const paused = pauseStart(newBlockPause(undefined, T0), T0);
  // 5분 정지한 상태에서 새 블록 시작 → 이전 5분은 이전 블록 몫, 이후만 새 블록에 붙는다
  const next = newBlockPause(paused, T0 + 300_000);
  expect(blockPauseSeconds(next, T0 + 480_000)).toBe(180);
});

test('중복 정지 시작은 무시한다 — 기준 시각이 밀려 방해초가 줄지 않게', () => {
  let b: BlockPause = pauseStart(newBlockPause(undefined, T0), T0);
  b = pauseStart(b, T0 + 60_000);
  expect(blockPauseSeconds(b, T0 + 120_000)).toBe(120);
  expect(b.count).toBe(1);
});

test('서버 검증 상한(24h)으로 자른다 — 넘기면 400이라 업로드가 영영 실패한다', () => {
  const b = pauseStart(newBlockPause(undefined, T0), T0);
  expect(blockPauseSeconds(b, T0 + 48 * 3600 * 1000)).toBe(24 * 3600);
});
