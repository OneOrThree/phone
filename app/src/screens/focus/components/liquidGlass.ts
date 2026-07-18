import { cubicBezier } from 'react-native-reanimated';
import { T, withAlpha } from '@/constants/theme';

// GROMO-848 리퀴드 글래스 선택 연출 공통값 — 탭바 하이라이트와 같은 오버슛 슬라이드를
// 집중 플로우 선택 UI(과목 리스트·타이머 방식 시트)에서 공유한다.
// 흰 배경 위라 탭바의 순백 유리 대신 포인트색 틴트로 가시성을 확보한다.

export const SLIDE_MS = 350;

export const glassSlide = {
  transitionProperty: ['transform', 'opacity'] as ('transform' | 'opacity')[],
  transitionDuration: SLIDE_MS,
  // 탭바(1.56)보다 오버슛을 낮춘 커브 — 세로 이동 거리가 길어 같은 값이면 과하게 튄다
  transitionTimingFunction: cubicBezier(0.3, 1.15, 0.5, 1), // 슉 미끄러지고 아주 살짝 넘쳤다 안착
} as const;

// 알약 공통 질감 — 틴트 유리 + 옅은 포인트색 테두리.
// (탭바식 흰 테두리는 흰 카드 위를 미끄러질 때 흰 줄로 도드라져 제거)
export const glassPill = {
  backgroundColor: withAlpha(T.accent, 0.12),
  borderWidth: 1,
  borderColor: withAlpha(T.accent, 0.35),
} as const;
