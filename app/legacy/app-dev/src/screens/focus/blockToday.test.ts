// 자정을 걸친 집중 블록의 '오늘' 몫 — GROMO-1252 코드리뷰(P2 2건)의 잠금.
//
// 여기서 잠그는 것:
//  1) 일시정지가 자정을 걸쳐도 오늘 몫이 부풀지 않는다. 벽시계 겹침으로 클램프하던 종전
//     규칙은 "가용 집중초가 전부 오늘 발생했다"고 가정해 어제 몫까지 오늘로 넣었다.
//  2) 라이브(미정산) 값도 자정을 넘기면 오늘 몫만 남는다. 세션을 끝내야 값이 줄어드는
//     역전(65분 → 5분)이 생기지 않게.
import {
  newBlockToday,
  creditTick,
  creditTicks,
  blockTodaySeconds,
  type BlockToday,
} from './blockToday';
import { localDateStr } from '@/utils/localDate';
import { resetServerZone, setServerZone } from '@/utils/serverZone';

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

// 서버 벽시계 분할(FocusService.splitByLocalDay)과 같은 반열림 규칙으로 구간을 쪼갠다 —
// 앱 tick 귀속이 서버 경계와 어긋나지 않는지 대조하는 용도(GROMO-1252 ④).
function wallClockSplit(startISO: string, endISO: string): Record<string, number> {
  const out: Record<string, number> = {};
  let cursor = at(startISO).getTime();
  const end = at(endISO).getTime();
  while (cursor < end) {
    const day = localDateStr(new Date(cursor));
    const midnight = new Date(cursor);
    midnight.setHours(0, 0, 0, 0);
    midnight.setDate(midnight.getDate() + 1);
    const sliceEnd = Math.min(midnight.getTime(), end);
    out[day] = (out[day] ?? 0) + (sliceEnd - cursor) / 1000;
    cursor = sliceEnd;
  }
  return out;
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
  let s = newBlockToday();
  s = runTicks(s, '2026-08-07T23:50:00', 300);
  s = runTicks(s, '2026-08-08T00:10:00', 300);

  expect(blockTodaySeconds(s)).toBe(300);
  // 업로드 페이로드(focusSecondsByDate)로 그대로 나가는 값 — 서버가 이 분포로 귀속한다.
  expect(s.server).toEqual({ '2026-08-07': 300, '2026-08-08': 300 });
  // 러너 TZ·서버 존 폴백이 둘 다 KST라 두 축이 같은 날짜로 떨어진다(축 분리 검증은 zone 테스트).
  expect(s.local).toEqual(s.server);
});

it('라이브 값은 자정이 지나면 오늘 몫만 남는다', () => {
  // 23:00~00:05로 이어지는 미정산 세션(3900초). 정산 전이라도 오늘 몫만 보여야 한다.
  jest.setSystemTime(at('2026-08-08T00:05:00'));
  const s = runTicks(newBlockToday(), '2026-08-07T23:00:00', 3900);

  expect(blockTodaySeconds(s)).toBe(300);
});

it('④ 자정 정각 경계는 서버 벽시계 분할과 같은 날짜로 귀속된다', () => {
  // 쉼 없이 이어진 세션은 tick 분포 == 서버 splitByLocalDay 결과여야 한다. 어긋나면
  // 앱 301초 / 서버 300초처럼 임계값에서 목표·10분 스트릭 판정이 뒤집힌다.
  const cases: [string, string, number][] = [
    ['2026-08-07T23:00:00', '2026-08-08T00:05:00', 3900], // 자정을 넘긴다
    ['2026-08-07T23:00:00', '2026-08-08T00:00:00', 3600], // 정확히 자정에 끝난다
    ['2026-08-08T00:00:00', '2026-08-08T00:10:00', 600], // 정확히 자정에 시작한다
  ];
  for (const [startISO, endISO, seconds] of cases) {
    expect(runTicks(newBlockToday(), startISO, seconds).local).toEqual(
      wallClockSplit(startISO, endISO),
    );
  }
});

it('어제로 끝난 블록은 오늘 몫이 0', () => {
  // 앱을 켜 둔 채 자정을 넘겼는데 그 뒤로 집중 tick이 없는 경우(예: 자정 직전 일시정지).
  jest.setSystemTime(at('2026-08-08T00:30:00'));
  const s = runTicks(newBlockToday(), '2026-08-07T23:00:00', 600);

  expect(blockTodaySeconds(s)).toBe(0);
});

it('정산하면 오늘 몫이 0에서 다시 시작한다', () => {
  jest.setSystemTime(at('2026-08-08T10:20:00'));
  const s = runTicks(newBlockToday(), '2026-08-08T10:00:00', 600);
  expect(blockTodaySeconds(s)).toBe(600);

  // settleFocusBlock이 새 블록을 연다
  const next = runTicks(newBlockToday(), '2026-08-08T10:10:00', 120);
  expect(blockTodaySeconds(next)).toBe(120);
});

it('⑤ 이탈 스냅샷은 이후 tick에 오염되지 않아 리플레이가 되감을 수 있다', () => {
  // 실드 세션은 background 이벤트 뒤 JS 정지 전까지 tick이 몇 번 더 돈다. 복귀 리플레이는
  // 세션 상태를 이탈 시점(leftSessionRef)으로 되감고 그 구간을 다시 재생하므로, 날짜 맵도
  // 함께 되감지 않으면 그 여분 tick이 두 번 적립된다(FocusSessionScreen.leftBlockTodayRef).
  // 되감기가 성립하려면 creditTick이 불변 갱신이어야 한다 — 그 계약을 여기서 잠근다.
  const left = runTicks(newBlockToday(), '2026-08-08T10:00:00', 60);
  const snapshot = left; // = leftBlockTodayRef.current (이탈 시점)
  const drifted = runTicks(left, '2026-08-08T10:01:00', 2); // 정지 전에 더 돈 tick 2개

  expect(drifted.local['2026-08-08']).toBe(62);
  expect(snapshot.local['2026-08-08']).toBe(60); // 스냅샷 무오염

  // 복귀: 이탈 시점부터 10초를 리플레이. 되감으면 70, 안 되감으면 72(2초 이중 적립).
  const replayed = runTicks(snapshot, '2026-08-08T10:01:00', 10);
  expect(replayed.local['2026-08-08']).toBe(70);
  expect(replayed.server['2026-08-08']).toBe(70);
});

// GROMO-1252 6차 ④ — 백그라운드 복귀 리플레이가 tick마다 이걸 부르면 최대 28,800회라 JS 스레드가
// 멈춘다. 묶음 적립으로 바꾸되 날짜 귀속 결과는 tick별 호출과 **정확히 같아야** 한다.
describe('creditTicks — 묶음 적립 결과는 tick별 적립과 동일하다', () => {
  afterEach(() => {
    resetServerZone();
  });

  // 같은 구간을 두 방식으로 적립해 대조한다. firstAt은 첫 tick 시각(= start + 1초).
  const bothWays = (startISO: string, seconds: number, base: BlockToday = newBlockToday()) => ({
    perTick: runTicks(base, startISO, seconds),
    batched: creditTicks(base, new Date(at(startISO).getTime() + 1000), seconds),
  });

  it('하루 안 / 자정 걸침 / 자정 정각 위상 모두 같다', () => {
    // 하루 안
    let r = bothWays('2026-08-08T10:00:00', 600);
    expect(r.batched).toEqual(r.perTick);
    // 자정 걸침
    r = bothWays('2026-08-07T23:50:00', 1200);
    expect(r.batched).toEqual(r.perTick);
    expect(r.batched.local).toEqual({ '2026-08-07': 600, '2026-08-08': 600 });
    // 위상 — 첫 tick이 자정 정각(덮은 1초는 전날 마지막 초)
    r = bothWays('2026-08-07T23:59:59', 2);
    expect(r.batched).toEqual(r.perTick);
    expect(r.batched.local).toEqual({ '2026-08-07': 1, '2026-08-08': 1 });
    // 1개·0개
    r = bothWays('2026-08-08T10:00:00', 1);
    expect(r.batched).toEqual(r.perTick);
    expect(creditTicks(newBlockToday(), at('2026-08-08T10:00:00'), 0)).toEqual(newBlockToday());
  });

  it('기존 누적 위에 더해도 같다(정산 전 여러 묶음)', () => {
    const base = runTicks(newBlockToday(), '2026-08-07T23:55:00', 120);
    const r = bothWays('2026-08-08T00:10:00', 300, base);
    expect(r.batched).toEqual(r.perTick);
    expect(base.local).toEqual({ '2026-08-07': 120 }); // 불변 갱신 유지(⑤ 되감기 전제)
  });

  it('두 축의 자정이 다른 존(GB)에서도 같다 — 축마다 갈리는 지점이 다르다', () => {
    setServerZone('Europe/London');
    // KST 08-08 07:50 = 런던 08-07 23:50(BST). 서버 축은 여기서, 로컬(KST) 축은 KST 자정에서 갈린다.
    const r = bothWays('2026-08-08T07:50:00', 1200);
    expect(r.batched).toEqual(r.perTick);
    expect(r.batched.server).toEqual({ '2026-08-07': 600, '2026-08-08': 600 });
    expect(r.batched.local).toEqual({ '2026-08-08': 1200 });
  });

  it('8시간(28,800 tick) 묶음 — 결과가 같고 Intl 포맷 호출이 tick 수에 비례하지 않는다', () => {
    setServerZone('Europe/London');
    const perTick = runTicks(newBlockToday(), '2026-08-08T20:00:00', 8 * 3600);

    const spy = jest.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    const batched = creditTicks(newBlockToday(), at('2026-08-08T20:00:01'), 8 * 3600);

    expect(batched).toEqual(perTick);
    // 종전엔 tick마다 1회(28,800). 이제 날짜 경계 이분탐색뿐이라 수십 회.
    expect(spy.mock.calls.length).toBeLessThan(100);
    spy.mockRestore();
  });
});
