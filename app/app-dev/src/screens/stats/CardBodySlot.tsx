// 카드 본문 조회 중 자리표시 (GROMO-1381).
//
// 통계 카드 여럿은 화면 데이터(useStatsData)와 **별개로 자체 조회**를 한다(세션·태그·평균 등).
// 그래서 로딩이 두 단계다:
//   ① 화면 스켈레톤 — 카드 목록 자체가 아직 없다 (StatsSkeleton)
//   ② 카드 안 스피너 — 카드는 떴고 이 카드의 데이터만 아직
// 둘은 시간상 겹치지 않지만, **넘겨주는 순간이 문제였다.** 스켈레톤이 완성 높이로 자리를 잡아
// 놨는데 카드가 마운트되면서 본문 대신 작은 스피너만 그리면, 카드가 확 수축했다가 조회가 끝나며
// 다시 확장한다 — 애써 맞춘 높이가 오히려 점프를 두 번 만든다(codex 리뷰).
//
// 그래서 스피너를 **완성 본문 높이의 컨테이너 안에 중앙 배치**한다. 스켈레톤 → 스피너 → 실제
// 본문이 전부 같은 높이라 전환 내내 카드가 미동도 하지 않는다.
//
// ⚠️ 카드 안에 또 스켈레톤(펄스)을 쓰지 않는 이유: 카드마다 `SkeletonGroup`이 생겨 무한 루프가
//    화면당 1개 상한을 다시 깬다(카드 7~9장 = 루프 7~9개). 높이 예약만으로 점프는 사라지고,
//    스피너는 "내 조작/이 카드가 처리 중"이라는 원래 뜻을 유지한다(Skeleton.tsx 헤더 주석과 같은 구분).
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { T, withAlpha } from '@/constants/theme';
import { cs } from './cardStyles';

/** 조회 중 — 완성 본문 높이를 예약하고 그 안에 스피너를 중앙 배치한다. */
export function CardBodyLoading({ height, testID }: { height: number; testID?: string }) {
  return (
    <View testID={testID} style={[s.wrap, { height }]}>
      <ActivityIndicator color={T.accent} size="small" />
    </View>
  );
}

/**
 * 기록 없음 — **로딩과 같은 높이를 유지한다.**
 *
 * ⚠️ 빈 상태를 한 줄 텍스트로만 두면 예약이 무의미해진다. 예컨대 월간 첫 시작 카드는 조회 중
 *    184px을 차지하다가 "아직 기록이 없어요" 한 줄(≈41px)로 줄어, 신규 사용자·그 달에 세션이
 *    없는 사용자에게는 카드가 143px 수축하며 아래가 통째로 올라온다(codex 리뷰).
 *    `minHeight`라 안내 문구가 예약분보다 길어지면(줄바꿈) 자연스럽게 늘어난다.
 */
export function CardBodyEmpty({
  height,
  children,
  testID,
}: {
  height: number;
  children: string;
  testID?: string;
}) {
  return (
    <View testID={testID} style={[s.wrap, { minHeight: height }]}>
      <Text style={cs.emptyText}>{children}</Text>
    </View>
  );
}

/**
 * 조회 실패 — 안내 문구 + '다시 시도' 버튼(GROMO-1500).
 *
 * ⚠️ **한 화면 안에서 실패 표현이 갈리면 같은 장애가 카드마다 다른 사고처럼 보인다.** 그래서
 *    문구·버튼 모양을 카드마다 따로 두지 않고 여기로 모았다(charts.tsx·CalendarCard 중복 제거).
 *
 * 배치는 카드마다 다르고, 그 차이만 prop으로 받는다:
 *   • **본문 자리**(`height`) — 본문 대신 그려지므로 완성 본문 높이를 **고정**으로 예약한다.
 *     실패 표시가 더 짧으면 아래 카드가 위로 튄다(CardBodyLoading과 같은 이유·같은 값).
 *   • **오버레이**(`overlay`) — 이미 그려진 본문(예: 캘린더 셀 그리드) 위에 겹친다. 높이는
 *     본문이 이미 잡고 있어 예약이 필요 없고, 대신 아래 내용 위에서 문구가 읽히도록
 *     반투명 배경을 깐다.
 */
export function CardBodyError({
  onRetry,
  height,
  overlay,
  testID,
}: {
  onRetry: () => void;
  /** 본문 자리 배치용 고정 높이. 오버레이면 넘기지 않는다(본문이 이미 높이를 잡고 있다). */
  height?: number;
  /** true면 본문 위에 겹치는 절대 배치 + 반투명 배경 */
  overlay?: boolean;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[s.wrap, overlay ? s.overlay : null, height != null ? { height } : null]}
    >
      <Text style={s.errorText}>불러오지 못했어요</Text>
      <TouchableOpacity style={s.retryBtn} activeOpacity={0.8} onPress={onRetry}>
        <Text style={s.retryText}>다시 시도</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  // 본문 위 겹침 — 중립 셀 위에서도 읽히도록 반투명 배경(친구 목록 에러 패턴 축소판)
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: withAlpha(T.white, 0.75),
  },
  errorText: { ...T.text.caption, fontSize: 12, color: T.inkSub },
  retryBtn: {
    marginTop: T.space.sm,
    backgroundColor: T.accent,
    borderRadius: 999,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.xs,
  },
  retryText: { ...T.text.caption, fontWeight: '700', color: T.white },
});
