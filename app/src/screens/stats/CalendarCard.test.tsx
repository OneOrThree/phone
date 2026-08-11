// 캘린더 카드(GROMO-974)의 **조회 실패 계약**을 잠근다(GROMO-1499).
// 이 카드의 실패 표현(불러오지 못했어요 + 다시 시도)은 통계 화면 전체가 베껴 쓰는 정본인데
// 테스트가 하나도 없었다 — 여기가 깨지면 다른 카드들이 맞춰 놓은 화면 일관성도 같이 깨진다.
//
// 잠그는 축은 넷이다:
//   1) 실패 ↔ 무데이터 구분 — `cells=null`(실패)과 `cells=[]`(빈 기록)은 다른 화면이다.
//      현재 기간(offset 0)은 **부모가 판정**(cells==null), 과거 페이지는 **카드의 failedKeys**로
//      판정한다. 경로가 둘이라는 것 자체가 회귀 지점이라 양쪽을 따로 세운다.
//   2) 재시도가 실제로 재조회를 일으킨다 — offset 0은 부모 retryCurrent, 과거는 카드 재조회.
//   3) 실패는 캐시하지 않는다 — 실패한 키는 요청 기록에서 지워야 재시도가 같은 키를 다시 판다.
//      (성공한 키는 반대로 캐시된다 — 대조군을 같이 세워야 '캐시가 통째로 죽은' 회귀도 잡힌다)
//   4) 재시도가 성공하면 에러 표시가 사라진다.
//      ⚠️ 성공 핸들러의 `failedKeys` 삭제 자체는 **화면으로 관측되지 않는다** — `failed`가
//         `noData` 뒤에 가려져 있고, 성공 응답이 `pastCells[key]`를 채우는 순간 그 키는 영원히
//         `noData=false`가 되기 때문이다(그 줄을 지워도 이 파일은 전부 통과한다 — 확인함).
//         그래서 여기서는 사용자에게 보이는 계약(에러가 걷히고 그 페이지 데이터가 뜬다)을 잠근다.
//
// ⚠️ 이 RTL(v14)의 `render`·`fireEvent`는 **async**다. `await` 없이 쓰면 다음 쿼리가
//    'render function has not been called'로 엉뚱하게 터진다.
// ⚠️ 화살표 버튼엔 텍스트 라벨이 없다 — 아이콘을 이름 텍스트로 목킹해 눌러 본다.
// ⚠️ 애니메이션 프레임은 단언하지 않는다(워클릿이 목이라 거짓 안정감). 진입 연출은 결정만
//    고정해 두고(useReduceMotion 목) 실패/무데이터의 **화면 상태**만 본다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { CalendarCard } from './CalendarCard';
import { calendarPage } from './format';
import type { FocusPeriodStatsResponse, HeatmapCellResponse } from '@/types/dto/stats';
import { getFocusPeriodStats, getHeatmap } from '@/services/statsApi';

jest.mock('@/services/statsApi', () => ({
  getHeatmap: jest.fn(),
  getFocusPeriodStats: jest.fn(),
}));
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => false,
  useReduceMotionReady: () => true,
  whenReduceMotionReady: () => Promise.resolve(),
}));
// 아이콘만 있는 ‹ › 버튼을 누를 수 있게 아이콘 이름을 그대로 텍스트로 낸다.
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, null, name);
  },
}));

const mockGetHeatmap = getHeatmap as jest.MockedFunction<typeof getHeatmap>;
const mockGetPeriodStats = getFocusPeriodStats as jest.MockedFunction<typeof getFocusPeriodStats>;

const ERROR_TEXT = '불러오지 못했어요';
const RETRY_TEXT = '다시 시도';

// 지난 주 페이지 — 과거 페이지 경로(카드 자체 조회)의 조회 키·기준일이 여기서 나온다
const pastWeek = calendarPage('WEEK', -1);
const pastKey = pastWeek.days[0];
const pastAnchor = pastWeek.days[pastWeek.days.length - 1];

const cell = (date: string, totalFocusMinutes: number): HeatmapCellResponse => ({
  date,
  totalFocusMinutes,
  sessionCount: 1,
  focusGoalAchieved: false,
  actualScreenTimeMinutes: 30,
  screenTimeGoalAchieved: false,
});

const periodStats = (totalFocusMinutes: number): FocusPeriodStatsResponse => ({
  period: 'WEEK',
  from: pastKey,
  to: pastAnchor,
  totalFocusMinutes,
  previousTotalFocusMinutes: 0,
  deltaMinutes: 0,
});

// 커밋·이펙트·마이크로태스크를 흘린다(조회 프라미스 해소 → setState 반영).
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

async function renderCard(cells: HeatmapCellResponse[] | null, periodTotal: number | null = 0) {
  const retryCurrent = jest.fn();
  await render(
    <CalendarCard
      period="WEEK"
      cells={cells}
      today={null}
      elapsedDays={null}
      periodTotal={periodTotal}
      retryCurrent={retryCurrent}
    />,
  );
  return { retryCurrent };
}

const goPrev = async () => {
  await fireEvent.press(screen.getByText('chevron-back'));
  await flush();
};
const goNext = async () => {
  await fireEvent.press(screen.getByText('chevron-forward'));
  await flush();
};
const pressRetry = async () => {
  await fireEvent.press(screen.getByText(RETRY_TEXT));
  await flush();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetHeatmap.mockResolvedValue([]);
  mockGetPeriodStats.mockResolvedValue(periodStats(0));
});

// ── 축 1: 실패 ↔ 무데이터 ─────────────────────────────────────────────
describe('CalendarCard 조회 실패 — 실패와 빈 기록은 다른 화면이다', () => {
  test('현재 기간 cells=null(부모 판정 실패)이면 에러 + 재시도를 그리고 총합을 지어내지 않는다', async () => {
    await renderCard(null, null);
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
    expect(screen.getByText(RETRY_TEXT)).toBeTruthy();
    // 실패를 '0시간 0분'으로 그리면 일시 에러가 진짜 기록처럼 보인다
    expect(screen.getByText('총 집중 —')).toBeTruthy();
  });

  test('현재 기간 cells=[](기록이 없을 뿐 조회는 성공)면 에러를 그리지 않는다', async () => {
    await renderCard([], 0);
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
    expect(screen.queryByText(RETRY_TEXT)).toBeNull();
    expect(screen.getByText('총 집중 0시간 0분')).toBeTruthy();
  });

  test('과거 페이지는 조회 중(응답 전)엔 실패가 아니다 — 에러 대신 로딩', async () => {
    mockGetHeatmap.mockReturnValue(new Promise(() => {})); // 영영 끝나지 않는 조회
    await renderCard([]);
    await goPrev();
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
    expect(screen.queryByText(RETRY_TEXT)).toBeNull();
    expect(screen.getByText('총 집중 —')).toBeTruthy();
  });

  test('과거 페이지 실패는 카드 자신의 failedKeys로 판정한다 — 부모 cells가 정상이어도 에러다', async () => {
    mockGetHeatmap.mockRejectedValue(new Error('network'));
    await renderCard([cell(calendarPage('WEEK', 0).days[0], 60)], 60); // 현재 기간은 정상
    await goPrev();
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
    expect(screen.getByText(RETRY_TEXT)).toBeTruthy();
    expect(mockGetHeatmap).toHaveBeenCalledWith(pastKey, pastAnchor);
  });

  test('기간 총합 조회만 실패하면 페이지 실패가 아니다 — 셀 합산으로 폴백한다', async () => {
    mockGetPeriodStats.mockRejectedValue(new Error('network'));
    mockGetHeatmap.mockResolvedValue([cell(pastKey, 30), cell(pastWeek.days[1], 90)]);
    await renderCard([]);
    await goPrev();
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
    expect(screen.getByText('총 집중 2시간 0분')).toBeTruthy();
  });
});

// ── 축 2·3·4: 재시도 → 재조회 → 에러 해제 ─────────────────────────────
describe('CalendarCard 재시도 — 두 경로 다 실제로 다시 조회한다', () => {
  test('현재 기간(offset 0)의 재시도는 부모 재조회다 — 카드가 직접 긁지 않는다', async () => {
    const { retryCurrent } = await renderCard(null, null);
    await pressRetry();
    expect(retryCurrent).toHaveBeenCalledTimes(1);
    // 현재 기간 heatmap은 useStatsData 몫이다. 카드가 여기서 직접 조회하면 요청이 두 벌 된다.
    expect(mockGetHeatmap).not.toHaveBeenCalled();
  });

  test('과거 페이지의 재시도는 같은 키를 다시 조회한다 — 실패를 캐시하지 않기 때문이다', async () => {
    mockGetHeatmap.mockRejectedValue(new Error('network'));
    const { retryCurrent } = await renderCard([]);
    await goPrev();
    expect(mockGetHeatmap).toHaveBeenCalledTimes(1);

    await pressRetry();
    // 실패 키를 요청 기록에 남겨 두면(=실패 캐시) 이펙트가 조기 반환해 2번째 조회가 없다.
    expect(mockGetHeatmap).toHaveBeenCalledTimes(2);
    expect(mockGetHeatmap).toHaveBeenNthCalledWith(2, pastKey, pastAnchor);
    // 과거 페이지는 부모 재조회가 아니다 — 부모를 부르면 현재 기간만 새로 오고 이 페이지는 그대로다
    expect(retryCurrent).not.toHaveBeenCalled();
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy(); // 두 번째도 실패했으니 에러 유지
  });

  test('재시도가 성공하면 에러 표시가 사라지고 그 페이지 데이터가 뜬다', async () => {
    mockGetHeatmap.mockRejectedValueOnce(new Error('network'));
    mockGetHeatmap.mockResolvedValueOnce([cell(pastKey, 45)]);
    mockGetPeriodStats.mockResolvedValue(periodStats(45));
    await renderCard([]);
    await goPrev();
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();

    await pressRetry();
    // 성공 응답이 failedKeys에서 키를 지우지 않으면 데이터가 왔는데도 에러가 남는다
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
    expect(screen.queryByText(RETRY_TEXT)).toBeNull();
    expect(screen.getByText('총 집중 0시간 45분')).toBeTruthy();
  });

  test('실패한 페이지는 재시도 버튼 없이 다시 들어와도 재조회된다 — 실패가 캐시되지 않는다', async () => {
    mockGetHeatmap.mockRejectedValueOnce(new Error('network'));
    mockGetHeatmap.mockResolvedValueOnce([cell(pastKey, 45)]);
    mockGetPeriodStats.mockResolvedValue(periodStats(45));
    await renderCard([]);
    await goPrev();
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();

    await goNext(); // 현재 기간으로 나갔다가
    await goPrev(); // 실패했던 페이지로 되돌아온다 — 재시도 버튼을 거치지 않는 경로
    expect(mockGetHeatmap).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
    expect(screen.getByText('총 집중 0시간 45분')).toBeTruthy();
  });

  test('성공한 페이지는 다시 들어가도 재조회하지 않는다 — 캐시되는 건 성공뿐이다', async () => {
    mockGetHeatmap.mockResolvedValue([cell(pastKey, 45)]);
    await renderCard([]);
    await goPrev();
    expect(mockGetHeatmap).toHaveBeenCalledTimes(1);

    await goNext(); // 현재 기간으로 복귀
    await goPrev(); // 같은 과거 페이지 재방문
    expect(mockGetHeatmap).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  });
});
