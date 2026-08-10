import { StyleSheet, type ColorValue } from 'react-native';
import { LiquidGlassView, isLiquidGlassSupported } from '@callstack/liquid-glass';
import { M, transition } from '@/constants/motion';
import { T, withAlpha } from '@/constants/theme';

// GROMO-848 리퀴드 글래스 선택 연출 공통 모듈 — 탭바·집중 플로우 선택 UI가 공유한다.
// (원래 screens/focus/components 소속이었으나 탭바도 쓰게 되어 전역 승격)
// iOS 26+(Xcode 26 빌드 + iOS 26 기기)는 네이티브 리퀴드 글래스, 미지원은 틴트 유리 폴백.
// ⚠️ @callstack/liquid-glass는 네이티브 모듈 — 이 JS를 구 바이너리에 OTA로 내보내면 크래시.

export { isLiquidGlassSupported };

// 알약 슬라이드 시간 — 값은 M.dur.base가 정본이다. export 이름은 유지한다(호출부가
// `setTimeout(..., SLIDE_MS + 60)`으로 연출이 끝나길 기다린다: TimerMethodSheet·FocusCategoryScreen).
export const SLIDE_MS = M.dur.base;

// 탭바(overshoot 1.56)보다 오버슛을 낮춘 glide 커브 — 세로 이동 거리가 길어 같은 값이면
// 과하게 튄다. 슉 미끄러지고 아주 살짝 넘쳤다 안착.
// ⚠️ transitionDuration은 숫자(350)에서 문자열('350ms')로 표기만 바뀐다 — reanimated의
//    normalizeTimeUnit이 둘을 같은 350ms로 정규화하므로 런타임 동작은 동일하다.
export const glassSlide = transition({
  property: ['transform', 'opacity'],
  duration: SLIDE_MS,
  curve: 'glide',
});

// 폴백 알약 질감(미지원 기기) — 틴트 유리 + 옅은 포인트색 테두리.
// (탭바식 흰 테두리는 흰 카드 위를 미끄러질 때 흰 줄로 도드라져 제거)
export const glassPill = {
  backgroundColor: withAlpha(T.accent, 0.12),
  borderWidth: 1,
  borderColor: withAlpha(T.accent, 0.35),
} as const;

// 네이티브 유리 알약 채움 — 지원 시에만 그린다. 미지원이면 null을 반환하므로
// 호출부는 래퍼에 glassPill 폴백 스타일을 조건부로 유지해야 한다.
// ⚠️ 유리는 뒤 콘텐츠를 블러시킨다 — 콘텐츠가 유리 "위"에 그려지는 구조(탭바: 아이콘이 알약 위)
//    에서만 쓸 것. 글자 위에 얹는 오버레이(과목·타이머 선택 알약)에 쓰면 글자가 안 보인다.
export function GlassPillFill({
  borderRadius,
  tintColor = withAlpha(T.accent, 0.15),
}: {
  borderRadius: number;
  tintColor?: ColorValue;
}) {
  if (!isLiquidGlassSupported) return null;
  return (
    <LiquidGlassView
      effect="clear"
      colorScheme="light"
      tintColor={tintColor}
      style={[StyleSheet.absoluteFill, { borderRadius }]}
    />
  );
}
