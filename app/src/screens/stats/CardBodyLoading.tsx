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
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { T } from '@/constants/theme';

export function CardBodyLoading({ height, testID }: { height: number; testID?: string }) {
  return (
    <View testID={testID} style={[s.wrap, { height }]}>
      <ActivityIndicator color={T.accent} size="small" />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
