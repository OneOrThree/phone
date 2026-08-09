import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { pulse } from '@/constants/motion';
import { T } from '@/constants/theme';
import { useMotion } from '@/hooks/useMotion';

// 로딩 자리표시자 — 콘텐츠가 들어올 자리를 미리 잡아 두는 회색 블록 (GROMO-1381 / 정책 D11).
//
// ⚠️ 시머(sweep)가 아니라 **불투명도 펄스**다. 시머는 LinearGradient + 마스크 + translateX가
//    필요해 요소당 뷰가 2개 늘고, 통계 화면처럼 8~12개를 동시에 띄우면 비용이 크다.
//    펄스는 CSS animationName 한 줄이고 레이아웃 패스가 없다.
//
// ⚠️ CSS API에는 reduce-motion 내장 처리가 없다. 반드시 `m.css(pulse)`를 통과시킨다 —
//    '동작 줄이기'가 켜지면 애니메이션 스타일이 통째로 사라져 **정지한 회색 블록**이 된다.
//
// ⚠️ pulse는 무한 루프다. 데이터가 도착하면 **호출부가 반드시 언마운트**해야 한다.
//    (로딩 분기를 삼항으로 감싸 스켈레톤 자체를 트리에서 빼는 형태)
//
// ⚠️ **치수는 실제 콘텐츠와 같아야 한다.** 스켈레톤이 실제보다 작거나 크면 데이터 도착 순간
//    레이아웃이 튀어서, 스켈레톤을 넣기 전보다 오히려 완성도가 내려간다.
//    `SkeletonCard`가 `height`를 **필수 prop**으로 받는 게 그 장치다 — 호출부가 실제 카드
//    높이(상수)를 넘기도록 강제해서, 카드 높이가 바뀌면 스켈레톤도 같이 바뀌게 묶어 둔다.
//
// 접근성: 내용이 없는 블록이라 스크린리더가 읽을 게 없다. iOS(accessibilityElementsHidden)·
// Android(importantForAccessibility) 양쪽 경로로 포커스에서 제외한다.
//
// 참고: 버튼 안의 pending `ActivityIndicator`는 그대로 둔다. 스켈레톤은 **콘텐츠 자리표시자
// 전용**이고, 스피너는 "내 조작이 처리 중"이라는 다른 의미다.

// 텍스트 한 줄의 높이 — T.text.body(16pt) 본문의 글자 상자 높이에 맞춘 값.
const LINE_H = 14;
// 마지막 줄만 짧게 — 문단 끝은 원래 오른쪽이 비어 있다. 전부 꽉 찬 블록은 표처럼 보인다.
const LAST_LINE_W = '60%' as const;
// 통계 카드 프레임(SectionCard)의 모서리와 같은 값 — 자리표시자와 실제 카드가 같은 실루엣이어야 한다.
const CARD_RADIUS = 18;

interface SkeletonProps {
  /** 너비. 부모 폭에 맞추려면 `'100%'` 같은 퍼센트 문자열을 넘긴다. */
  w: number | `${number}%`;
  /** 높이. 실제 콘텐츠 높이와 같아야 한다(레이아웃 점프 방지). */
  h: number;
  radius?: number;
  testID?: string;
}

/** 단일 블록 자리표시자. 아바타·썸네일·수치 한 칸 등 낱개 요소에 쓴다. */
export function Skeleton({ w, h, radius = 8, testID }: SkeletonProps) {
  const m = useMotion();
  return (
    <Animated.View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[s.block, { width: w, height: h, borderRadius: radius }, m.css(pulse)]}
    />
  );
}

interface SkeletonTextProps {
  /** 실제로 들어올 텍스트의 줄 수. 넘치거나 모자라면 도착 시 레이아웃이 튄다. */
  lines: number;
  gap?: number;
  testID?: string;
}

/** 여러 줄 텍스트 자리표시자. 마지막 줄은 짧게 그려 문단처럼 보이게 한다. */
export function SkeletonText({ lines, gap = T.space.sm, testID }: SkeletonTextProps) {
  return (
    <Animated.View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[s.textWrap, { gap }]}
    >
      {Array.from({ length: Math.max(lines, 0) }, (_, i) => (
        <Skeleton key={i} w={i === lines - 1 ? LAST_LINE_W : '100%'} h={LINE_H} radius={6} />
      ))}
    </Animated.View>
  );
}

interface SkeletonCardProps {
  /**
   * 실제 카드 높이. **필수다** — 호출부가 실제 값(카드 높이 상수)을 넘기게 강제해서
   * 데이터 도착 시 레이아웃 점프가 나지 않게 한다. 기본값을 주면 이 장치가 무력화된다.
   */
  height: number;
  testID?: string;
}

/** 카드 한 장 자리표시자. 통계 화면처럼 카드 여러 장이 한 번에 로딩되는 자리에 쓴다. */
export function SkeletonCard({ height, testID }: SkeletonCardProps) {
  return <Skeleton w="100%" h={height} radius={CARD_RADIUS} testID={testID} />;
}

const s = StyleSheet.create({
  // 베이스색은 진행 트랙과 같은 중립 회색(T.track) — 인디고 틴트를 쓰면 로딩 중인 자리가
  // '선택된 상태'처럼 보인다.
  block: { backgroundColor: T.track },
  textWrap: { width: '100%' },
});
