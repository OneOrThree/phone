// 자정을 걸친 집중 블록의 '오늘' 몫 — GROMO-1252 코드리뷰(P2 2건)의 잠금.
//
// 여기서 잠그는 것:
//  1) 일시정지가 자정을 걸쳐도 오늘 몫이 부풀지 않는다. 벽시계 겹침으로 클램프하던 종전
//     규칙은 "가용 집중초가 전부 오늘 발생했다"고 가정해 어제 몫까지 오늘로 넣었다.
//  2) 라이브(미정산) 값도 자정을 넘기면 오늘 몫만 남는다. 세션을 끝내야 값이 줄어드는
//     역전(65분 → 5분)이 생기지 않게.
import { newBlockToday, creditTick, blockTodaySeconds, type BlockToday } from './blockToday';

// jest.config.js가 TZ=Asia/Seoul로 고정 — 로컬 자정 = KST 자정.
const at = (iso: string) => new Date(`${iso}+09:00`);

// startISO부터 1초에 1 tick씩 seconds번. tick은 '지나간 1초의 끝'에 발생하므로
// i번째 tick 시각 = start + i초 (세션 화면의 실제 타이머·리플레이와 같은 규칙).
function runTicks(state: BlockToday, startISO: string, seconds: number): BlockToday {
  const base = at(startISO).getTime();
  let s = state;
  for (let i = 1; i <= seconds; i++) s = creditTick(s, new Date(base + i * 1000));
  return s;
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

it('일시정지가 자정을 걸치면 자정 이후 집중분만 오늘 몫', () => {
  // 23:50~23:55 집중 → 일시정지(tick 없음) → 00:10~00:15 집중.
  // 집중초는 600이고 벽시계 겹침(00:00~00:15)은 900이라, min(delta, 겹침)은 600을 골라
  // 600 전부를 오늘로 넣었다 — 실제 오늘 몫은 300이다.
  jest.setSystemTime(at('2026-08-08T00:15:00'));
  let s = newBlockToday(at('2026-08-07T23:50:00'));
  s = runTicks(s, '2026-08-07T23:50:00', 300);
  s = runTicks(s, '2026-08-08T00:10:00', 300);

  expect(blockTodaySeconds(s)).toBe(300);
});

it('라이브 값은 자정이 지나면 오늘 몫만 남는다', () => {
  // 23:00~00:05로 이어지는 미정산 세션(3900초). 정산 전이라도 오늘 몫만 보여야 한다.
  // 00:00:00에 끝나는 tick까지 새 날짜로 세므로 300 + 경계 1초.
  jest.setSystemTime(at('2026-08-08T00:05:00'));
  const s = runTicks(newBlockToday(at('2026-08-07T23:00:00')), '2026-08-07T23:00:00', 3900);

  expect(blockTodaySeconds(s)).toBe(301);
});

it('어제로 끝난 블록은 오늘 몫이 0', () => {
  // 앱을 켜 둔 채 자정을 넘겼는데 그 뒤로 집중 tick이 없는 경우(예: 자정 직전 일시정지).
  jest.setSystemTime(at('2026-08-08T00:30:00'));
  const s = runTicks(newBlockToday(at('2026-08-07T23:00:00')), '2026-08-07T23:00:00', 600);

  expect(blockTodaySeconds(s)).toBe(0);
});

it('정산하면 오늘 몫이 0에서 다시 시작한다', () => {
  jest.setSystemTime(at('2026-08-08T10:20:00'));
  const s = runTicks(newBlockToday(at('2026-08-08T10:00:00')), '2026-08-08T10:00:00', 600);
  expect(blockTodaySeconds(s)).toBe(600);

  // settleFocusBlock이 endedAt으로 새 블록을 연다
  const next = runTicks(newBlockToday(at('2026-08-08T10:10:00')), '2026-08-08T10:10:00', 120);
  expect(blockTodaySeconds(next)).toBe(120);
});
