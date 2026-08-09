// StatsSkeleton — 잠그는 규칙은 셋이다.
//   ① 탭마다 **그 탭에 실제로 뜨는 카드 수**만큼 자리표시자를 그린다(구성이 탭별로 다르다).
//   ② 동시 표시 장수가 상한(약 12장)을 넘지 않는다 — 저사양 기기 프레임 예산.
//   ③ 높이는 실제 카드 치수에서 계산된 값이 그대로 스타일까지 내려간다(레이아웃 점프 방지 장치).
// 펄스의 중간 프레임·타이밍은 단언하지 않는다 — jest에서 워클릿은 목이라 거짓 안정감이다.
//
// ⚠️ 스켈레톤은 접근성 트리에서 숨겨져 있어 기본 쿼리로는 찾히지 않는다 → includeHiddenElements.
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { StatsSkeleton } from './StatsSkeleton';
import { CAL_CELL_H, skeletonCards } from './constants';
import { calendarRowCount } from './format';

const HIDDEN = { includeHiddenElements: true } as const;

describe('StatsSkeleton', () => {
  test.each([
    ['DAY', 7],
    ['WEEK', 9],
    ['MONTH', 9],
  ] as const)('%s 탭은 카드 %i장을 그린다 — 상한 12장 이내', async (period, count) => {
    await render(<StatsSkeleton period={period} />);
    const cards = screen.getAllByTestId(/^stats\.skeleton\./, HIDDEN);
    expect(cards).toHaveLength(count);
    expect(cards.length).toBeLessThanOrEqual(12);
  });

  test('일 탭에만 타임테이블이, 주·월에만 첫 시작 카드가 있다', async () => {
    await render(<StatsSkeleton period="DAY" />);
    expect(screen.queryByTestId('stats.skeleton.timetable', HIDDEN)).not.toBeNull();
    expect(screen.queryByTestId('stats.skeleton.firstStart', HIDDEN)).toBeNull();

    await render(<StatsSkeleton period="WEEK" />);
    expect(screen.queryByTestId('stats.skeleton.timetable', HIDDEN)).toBeNull();
    expect(screen.queryByTestId('stats.skeleton.firstStart', HIDDEN)).not.toBeNull();
  });

  test('카드 높이는 constants의 계산값이 그대로 스타일로 내려간다', async () => {
    await render(<StatsSkeleton period="WEEK" />);
    for (const c of skeletonCards('WEEK', 1)) {
      const style = StyleSheet.flatten(
        screen.getByTestId(`stats.skeleton.${c.key}`, HIDDEN).props.style,
      );
      expect(style.height).toBe(c.height);
      expect(style.width).toBe('100%');
    }
  });

  test('주간 타임테이블 카드는 본문 높이(400)가 있어 다른 카드보다 확실히 높다', async () => {
    const byKey = new Map(skeletonCards('WEEK', 1).map((c) => [c.key, c.height]));
    // 실제 카드가 WTT_BODY_H(400)를 쓰므로 스켈레톤도 그만큼 커야 도착 순간 튀지 않는다
    expect(byKey.get('firstStart')).toBeGreaterThan(400);
    expect(byKey.get('firstStart')).toBeGreaterThan(byKey.get('delta') as number);
  });

  // 무한 루프는 **화면당 1개**여야 한다 — 카드마다 펄스를 걸면 9개가 동시에 돈다(codex 리뷰).
  // 재생 자체가 아니라 '어디에 걸려 있는가'만 본다(타이밍·중간 프레임은 단언하지 않는다).
  test('펄스는 묶음 한 겹에만 걸리고 카드들은 정적으로 그려진다', async () => {
    await render(<StatsSkeleton period="WEEK" />);
    // reanimated가 호스트 뷰 style에서 CSS 애니메이션 프로퍼티를 걷어가므로 jestInlineStyle로 본다
    const inline = (testID: string) =>
      StyleSheet.flatten(screen.getByTestId(testID, HIDDEN).props.jestInlineStyle);
    expect(inline('stats.skeleton').animationName).toBeDefined();
    for (const c of skeletonCards('WEEK', 1)) {
      expect(inline(`stats.skeleton.${c.key}`).animationName).toBeUndefined();
    }
  });

  // 월 캘린더는 달마다 5행이거나 6행이다. 스켈레톤이 한쪽으로 박혀 있으면 데이터가 도착하는
  // 순간 목표 달성 카드가 한 행(≈52px) 갑자기 커진다(codex 리뷰).
  describe('월 목표 달성 카드 높이 — 실제 캘린더 행 수를 따른다', () => {
    beforeAll(() => jest.useFakeTimers());
    afterAll(() => jest.useRealTimers());

    const goalHeight = () =>
      skeletonCards('MONTH', calendarRowCount('MONTH', 0)).find((c) => c.key === 'goalAchieve')!
        .height;

    test('6행 달(2026-08: 앞 빈칸 5 + 31일)이 5행 달(2026-07)보다 한 행만큼 높다', () => {
      jest.setSystemTime(new Date('2026-07-15T09:00:00+09:00'));
      const fiveRows = goalHeight();
      jest.setSystemTime(new Date('2026-08-10T09:00:00+09:00'));
      const sixRows = goalHeight();
      expect(calendarRowCount('MONTH', 0)).toBe(6);
      expect(sixRows - fiveRows).toBe(CAL_CELL_H + 1); // 셀 한 행 + 행 사이 1px
    });

    test('렌더된 스켈레톤 카드에도 그 높이가 그대로 내려간다', async () => {
      jest.setSystemTime(new Date('2026-08-10T09:00:00+09:00'));
      await render(<StatsSkeleton period="MONTH" />);
      const style = StyleSheet.flatten(
        screen.getByTestId('stats.skeleton.goalAchieve', HIDDEN).props.style,
      );
      expect(style.height).toBe(goalHeight());
    });
  });

  test('스크린리더 포커스에서 제외된다 — 내용 없는 자리표시자다', async () => {
    await render(<StatsSkeleton period="DAY" />);
    expect(screen.queryByTestId('stats.skeleton.total')).toBeNull();
    const node = screen.getByTestId('stats.skeleton.total', HIDDEN);
    expect(node.props.accessibilityElementsHidden).toBe(true);
  });
});
