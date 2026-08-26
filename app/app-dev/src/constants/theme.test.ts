// 글자 배율 상한(GROMO-1485)이 근거로 삼은 산수를 잠근다.
//
// FIXED_BOX_FONT_SCALE_MAX = 1.5는 "포디움 열(width 100) 안에 caption 13pt짜리 HH:MM:SS가
// 상한 배율에서도 들어간다"에서 나온 값이다. 그 근거가 지금까지는 주석 산문에만 있어서,
// 토큰이나 칸 폭이 바뀌어도 아무것도 실패하지 않고 포디움 시간만 조용히 옆 칸을 침범했다.
// (readoutLayout.test.ts가 같은 부류의 산수를 배율 스윕으로 잠근 선례를 따른다.)
import { FIXED_BOX_FONT_SCALE_MAX, T } from './theme';

/**
 * 상한을 건 칸들의 폭 계약. 값을 바꿀 때는 **저쪽 StyleSheet도 같이** 고쳐야 한다.
 * · podium: `screens/league/LeagueScreen.tsx`의 `s.podiumCol.width`
 * · friendCard: 같은 파일 `s.friendCard`가 width '48%' — 375pt 기기 기준 내부 폭 근사
 */
const FIXED_BOX_W = { podium: 100, friendCard: 137 };

/**
 * `HH:MM:SS`(숫자 6 + 콜론 2, tabular-nums) 한 줄의 폭 ÷ fontSize.
 * 숫자 0.6em·콜론 0.3em 기준 = 6×0.6 + 2×0.3 = 4.2. readoutLayout.ts의 TIMER_W_PER_PT(3.85)와
 * 다른 건 그쪽이 52pt 실측 기반이라 그렇다 — 여기선 보수적으로 더 넓게 잡는다.
 */
const HMS_W_PER_PT = 4.2;

const hmsWidth = (fontSize: number, scale: number) => fontSize * scale * HMS_W_PER_PT;

describe('FIXED_BOX_FONT_SCALE_MAX', () => {
  test('상한 배율에서 포디움 열 안에 HH:MM:SS가 들어간다', () => {
    expect(hmsWidth(T.text.caption.fontSize, FIXED_BOX_FONT_SCALE_MAX)).toBeLessThanOrEqual(
      FIXED_BOX_W.podium,
    );
  });

  test('상한 배율에서 친구 카드 안에 HH:MM:SS가 들어간다', () => {
    expect(hmsWidth(T.text.caption.fontSize, FIXED_BOX_FONT_SCALE_MAX)).toBeLessThanOrEqual(
      FIXED_BOX_W.friendCard,
    );
  });

  test('iOS 표준 Dynamic Type 최대(1.35)는 상한에 걸리지 않는다', () => {
    // 상한을 이 아래로 낮추면 접근성이 아니라 '평범하게 글자 키운 사용자'가 손해를 본다.
    expect(FIXED_BOX_FONT_SCALE_MAX).toBeGreaterThanOrEqual(1.35);
  });

  // 랭킹 행(핀 모드)은 이 앱에서 가로가 가장 빠듯한 줄이다 — 순위·티어·아바타·핀이 전부 고정
  // 폭이라 이름 칸만 줄어든다. "부호 붙은 격차(+HH:MM:SS)가 행을 넘긴다"는 리뷰 지적이 있었는데
  // 실제로는 넘치지 않는다(아래 계산). 다만 고정 폭을 하나라도 늘리면 그때 진짜로 넘치므로,
  // 근거를 여기 못 박아 둔다. 값 출처: LeagueScreen `s.list`(paddingHorizontal 16),
  // RankRow `s.row`(paddingHorizontal 12, gap 12) · `s.rank` 22 · TierBadge 30 · MemberAvatar 36 ·
  // `s.pinBtn` 26.
  test('상한 배율에서 랭킹 행이 가장 긴 격차 문구를 담고도 넘치지 않는다', () => {
    const NARROWEST_DEVICE = 375; // 최소 지원 iOS 16.4 → SE2/SE3가 하한. 320pt 기기는 대상 밖.
    const inner = NARROWEST_DEVICE - 16 * 2 - 12 * 2;
    const fixed = 22 + 30 + 36 + 26 + 12 * 5; // 고정 폭 자식 4개 + 자식 6개 사이 간격 5
    const budget = inner - fixed; // 이름 칸 + 시간 칸이 나눠 쓸 폭

    // 최악: 주간 168시간(세 자리 시) + 부호. 숫자 0.6em · 콜론 0.3em · 부호 0.55em.
    const worstTime = T.text.label.fontSize * FIXED_BOX_FONT_SCALE_MAX * (7 * 0.6 + 2 * 0.3);
    const worstDelta =
      T.text.caption.fontSize * FIXED_BOX_FONT_SCALE_MAX * (0.55 + 7 * 0.6 + 2 * 0.3);

    // 시간 칸은 둘 중 넓은 쪽을 차지하고, 남는 폭이 있어야 이름이 한 글자라도 보인다.
    expect(Math.max(worstTime, worstDelta)).toBeLessThan(budget);
  });

  test('상한을 거는 토큰에는 lineHeight가 없다 — 안드로이드에서 줄 상자만 자란다', () => {
    // 안드 <Text>는 fontSize에만 상한을 넘기고 lineHeight는 시스템 배율 전체를 먹는다
    // (TextAttributeProps.kt). 상한을 쓰는 자리의 토큰에 lineHeight가 생기면 그 순간 깨진다.
    for (const token of [T.text.caption, T.text.label, T.text.title]) {
      expect(token).not.toHaveProperty('lineHeight');
    }
  });
});
