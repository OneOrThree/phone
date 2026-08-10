// StatsSkeleton — 잠그는 규칙은 셋이다.
//   ① 탭마다 **그 탭에 실제로 뜨는 카드 수**만큼 자리표시자를 그린다(구성이 탭별로 다르다).
//   ② 동시 표시 장수가 상한(약 12장)을 넘지 않는다 — 저사양 기기 프레임 예산.
//   ③ 높이는 실제 카드 치수에서 계산된 값이 그대로 스타일까지 내려간다(레이아웃 점프 방지 장치).
// 펄스의 중간 프레임·타이밍은 단언하지 않는다 — jest에서 워클릿은 목이라 거짓 안정감이다.
//
// ⚠️ 스켈레톤은 접근성 트리에서 숨겨져 있어 기본 쿼리로는 찾히지 않는다 → includeHiddenElements.
import { Dimensions, StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { StatsSkeleton } from './StatsSkeleton';
import {
  CARD_CHROME_H,
  SHARE_BTN_H,
  WTT_BODY_BLOCK_H,
  WTT_FOOTER_LINE_H,
  calendarCellH,
  skeletonCards,
} from './constants';
import { calendarRowCount, mergeCardOrder } from './format';

const HIDDEN = { includeHiddenElements: true } as const;
// 렌더된 컴포넌트가 useWindowDimensions로 읽는 것과 같은 폭 — 캘린더 셀 높이가 여기서 파생된다
const W = Dimensions.get('window').width;

describe('StatsSkeleton', () => {
  test.each([
    ['DAY', 7],
    ['WEEK', 9],
    ['MONTH', 9],
  ] as const)('%s 탭은 카드 %i장을 그린다 — 상한 12장 이내', async (period, count) => {
    await render(<StatsSkeleton period={period} subjectCount={3} />);
    const cards = screen.getAllByTestId(/^stats\.skeleton\./, HIDDEN);
    expect(cards).toHaveLength(count);
    expect(cards.length).toBeLessThanOrEqual(12);
  });

  test('일 탭에만 타임테이블이, 주·월에만 첫 시작 카드가 있다', async () => {
    await render(<StatsSkeleton period="DAY" subjectCount={3} />);
    expect(screen.queryByTestId('stats.skeleton.timetable', HIDDEN)).not.toBeNull();
    expect(screen.queryByTestId('stats.skeleton.firstStart', HIDDEN)).toBeNull();

    await render(<StatsSkeleton period="WEEK" subjectCount={3} />);
    expect(screen.queryByTestId('stats.skeleton.timetable', HIDDEN)).toBeNull();
    expect(screen.queryByTestId('stats.skeleton.firstStart', HIDDEN)).not.toBeNull();
  });

  test('카드 높이는 constants의 계산값이 그대로 스타일로 내려간다', async () => {
    await render(<StatsSkeleton period="WEEK" subjectCount={3} />);
    for (const c of skeletonCards({
      period: 'WEEK',
      calendarRows: 1,
      screenWidth: W,
      subjectCount: 3,
    })) {
      const style = StyleSheet.flatten(
        screen.getByTestId(`stats.skeleton.${c.key}`, HIDDEN).props.style,
      );
      expect(style.height).toBe(c.height);
      expect(style.width).toBe('100%');
    }
  });

  test('주간 타임테이블 카드는 본문 높이(400)가 있어 다른 카드보다 확실히 높다', async () => {
    const byKey = new Map(
      skeletonCards({ period: 'WEEK', calendarRows: 1, screenWidth: W, subjectCount: 3 }).map(
        (c) => [c.key, c.height],
      ),
    );
    // 실제 카드가 WTT_BODY_H(400)를 쓰므로 스켈레톤도 그만큼 커야 도착 순간 튀지 않는다
    expect(byKey.get('firstStart')).toBeGreaterThan(400);
    expect(byKey.get('firstStart')).toBeGreaterThan(byKey.get('delta') as number);
  });

  // 무한 루프는 **화면당 1개**여야 한다 — 카드마다 펄스를 걸면 9개가 동시에 돈다(codex 리뷰).
  // 재생 자체가 아니라 '어디에 걸려 있는가'만 본다(타이밍·중간 프레임은 단언하지 않는다).
  test('주간 타임테이블 예약에 표 아래 슬롯(안내·범례) 한 줄이 포함된다', async () => {
    // 표 아래에 안내 문구나 범례가 **항상** 붙으므로, 트랙까지만 예약하면 도착 순간 카드가
    // 그만큼 늘어나 아래가 밀린다(codex 리뷰).
    const firstStart = skeletonCards({
      period: 'WEEK',
      calendarRows: 1,
      screenWidth: W,
      subjectCount: 3,
    }).find((c) => c.key === 'firstStart')!.height;
    // 트랙(400) + 요일 헤더 + 슬롯 + 공유 버튼 + 카드 프레임
    expect(firstStart).toBe(CARD_CHROME_H + WTT_BODY_BLOCK_H + SHARE_BTN_H);
    expect(WTT_BODY_BLOCK_H).toBeGreaterThan(400 + WTT_FOOTER_LINE_H);
  });

  test('펄스는 묶음 한 겹에만 걸리고 카드들은 정적으로 그려진다', async () => {
    await render(<StatsSkeleton period="WEEK" subjectCount={3} />);
    // reanimated가 호스트 뷰 style에서 CSS 애니메이션 프로퍼티를 걷어가므로 jestInlineStyle로 본다
    const inline = (testID: string) =>
      StyleSheet.flatten(screen.getByTestId(testID, HIDDEN).props.jestInlineStyle);
    expect(inline('stats.skeleton').animationName).toBeDefined();
    for (const c of skeletonCards({
      period: 'WEEK',
      calendarRows: 1,
      screenWidth: W,
      subjectCount: 3,
    })) {
      expect(inline(`stats.skeleton.${c.key}`).animationName).toBeUndefined();
    }
  });

  // 월 캘린더는 달마다 5행이거나 6행이다. 스켈레톤이 한쪽으로 박혀 있으면 데이터가 도착하는
  // 순간 목표 달성 카드가 한 행(≈52px) 갑자기 커진다(codex 리뷰).
  describe('월 목표 달성 카드 높이 — 실제 캘린더 행 수를 따른다', () => {
    beforeAll(() => jest.useFakeTimers());
    afterAll(() => jest.useRealTimers());

    const goalHeight = () =>
      skeletonCards({
        period: 'MONTH',
        calendarRows: calendarRowCount('MONTH', 0),
        screenWidth: W,
        subjectCount: 3,
      }).find((c) => c.key === 'goalAchieve')!.height;

    test('6행 달(2026-08: 앞 빈칸 5 + 31일)이 5행 달(2026-07)보다 한 행만큼 높다', () => {
      jest.setSystemTime(new Date('2026-07-15T09:00:00+09:00'));
      const fiveRows = goalHeight();
      jest.setSystemTime(new Date('2026-08-10T09:00:00+09:00'));
      const sixRows = goalHeight();
      expect(calendarRowCount('MONTH', 0)).toBe(6);
      expect(sixRows - fiveRows).toBeCloseTo(calendarCellH(W) + 1); // 셀 한 행 + 행 사이 1px
    });

    test('렌더된 스켈레톤 카드에도 그 높이가 그대로 내려간다', async () => {
      jest.setSystemTime(new Date('2026-08-10T09:00:00+09:00'));
      await render(<StatsSkeleton period="MONTH" subjectCount={3} />);
      const style = StyleSheet.flatten(
        screen.getByTestId('stats.skeleton.goalAchieve', HIDDEN).props.style,
      );
      expect(style.height).toBe(goalHeight());
    });
  });

  // 셀 높이가 폭에서 파생되는데(flex:1 + aspectRatio) 스켈레톤만 고정값이면 큰 화면에서
  // 카드가 짧아져 로딩 완료 순간 아래가 전부 밀린다(codex 리뷰).
  test('캘린더 카드 높이는 화면 폭에 따라 달라진다', () => {
    const goalOn = (screenWidth: number) =>
      skeletonCards({ period: 'MONTH', calendarRows: 6, screenWidth, subjectCount: 3 }).find(
        (c) => c.key === 'goalAchieve',
      )!.height;
    // 넓은 화면일수록 셀이 커지므로 카드도 커진다 — 6행이면 차이가 눈에 띄게 벌어진다
    expect(goalOn(430)).toBeGreaterThan(goalOn(390));
    expect(goalOn(430) - goalOn(390)).toBeCloseTo((calendarCellH(430) - calendarCellH(390)) * 6);
    // 390pt 기준 셀은 51px 언저리(기존에 상수로 박아 두던 값)
    expect(calendarCellH(390)).toBeCloseTo(50.93, 1);
  });

  // 큰 카드를 위로 올려 둔 사용자는 기본 순서로 그리면 로딩 완료 순간 화면 대부분이 밀린다.
  // 정렬 규칙은 실제 목록(StatsScreen)과 **같은 함수**여야 한다 — 두 곳이 다르면 결국 같은 증상이다.
  const renderedKeys = () =>
    screen
      .getAllByTestId(/^stats\.skeleton\./, HIDDEN)
      .map((n) => String(n.props.testID).replace('stats.skeleton.', ''));

  test('저장된 순서를 실제 목록과 같은 규칙(mergeCardOrder)으로 반영한다', async () => {
    const saved = ['firstStart', 'delta', 'total'];
    await render(<StatsSkeleton period="WEEK" savedOrder={saved} subjectCount={3} />);
    const keys = renderedKeys();
    // 사용자가 맨 위로 올려 둔 큰 카드(주간 타임테이블)가 실제로 첫 장이다
    expect(keys[0]).toBe('firstStart');
    expect(keys).toEqual(
      mergeCardOrder(
        skeletonCards({ period: 'WEEK', calendarRows: 1, screenWidth: W, subjectCount: 3 }).map(
          (c) => c.key,
        ),
        saved,
      ),
    );
  });

  test('저장에 없는 키는 채워 넣고, 이제 없는 키는 버린다', async () => {
    // 'grass'는 폐기된 카드 키 — 무시돼야 하고, 기본 카드는 하나도 빠지면 안 된다
    await render(<StatsSkeleton period="DAY" savedOrder={['grass', 'longest']} subjectCount={3} />);
    const keys = renderedKeys();
    expect(keys).not.toContain('grass');
    expect(keys).toHaveLength(7);
    expect(new Set(keys).size).toBe(7);
  });

  test('저장된 순서가 없으면 기본 순서 그대로다', async () => {
    await render(<StatsSkeleton period="WEEK" subjectCount={3} />);
    expect(renderedKeys()[0]).toBe('total');
  });

  test('스크린리더 포커스에서 제외된다 — 내용 없는 자리표시자다', async () => {
    await render(<StatsSkeleton period="DAY" subjectCount={3} />);
    expect(screen.queryByTestId('stats.skeleton.total')).toBeNull();
    const node = screen.getByTestId('stats.skeleton.total', HIDDEN);
    expect(node.props.accessibilityElementsHidden).toBe(true);
  });
});

// ⚠️ 범례는 행마다 T.space.sm를 누적하므로 6줄부터 132px 링보다 높아진다. 링 높이로 고정하면
//    과목을 많이 만든 사용자는 도착 순간 도넛 카드가 자라 아래 카드들이 밀린다(codex 리뷰).
describe('도넛 카드 높이 — 범례 행 수', () => {
  const category = (subjectCount: number) =>
    skeletonCards({ period: 'WEEK', calendarRows: 1, screenWidth: 375, subjectCount }).find(
      (c) => c.key === 'category',
    )!.height;

  test('5줄까지는 링이 지배해 높이가 같다', () => {
    expect(category(5)).toBe(category(0));
    expect(category(3)).toBe(category(0));
  });

  test('6줄부터는 범례가 링을 넘어 카드가 더 높아진다', () => {
    expect(category(6)).toBeGreaterThan(category(5));
    expect(category(9)).toBeGreaterThan(category(6));
  });
});

// ⚠️ 일간 타임테이블 범례도 20줄부터 405px 격자를 넘어선다 — 도넛과 같은 구조의 누락이었다.
describe('일간 타임테이블 카드 높이 — 범례 행 수', () => {
  const timetable = (subjectCount: number) =>
    skeletonCards({ period: 'DAY', calendarRows: 0, screenWidth: 375, subjectCount }).find(
      (c) => c.key === 'timetable',
    )!.height;

  test('19줄까지는 격자가 지배해 높이가 같다', () => {
    expect(timetable(19)).toBe(timetable(0));
    expect(timetable(5)).toBe(timetable(0));
  });

  test('20줄부터는 범례가 격자를 넘어 카드가 더 높아진다', () => {
    expect(timetable(20)).toBeGreaterThan(timetable(19));
    expect(timetable(24)).toBeGreaterThan(timetable(20));
  });
});
