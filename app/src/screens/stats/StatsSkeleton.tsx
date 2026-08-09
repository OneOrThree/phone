// 통계 화면 첫 로딩 자리표시자 (GROMO-1381) — 가운데 스피너 하나를 카드 모양 스켈레톤
// 여러 장으로 바꾼 것.
//
// 왜 스피너가 아니라 카드인가: 스피너는 "뭔가 하는 중"만 말하고 무엇이 올지는 말하지 않는다.
// 이 화면은 카드가 세로로 쌓이는 구조가 고정돼 있어서, 올 모양을 미리 그려 두면 도착 순간
// 화면이 다시 그려지는 게 아니라 **채워지는 것처럼** 보인다.
//
// ⚠️ 카드 높이는 `constants.ts`의 `skeletonCards(period)`가 준다 — 실제 카드가 쓰는 치수
//    (차트 높이·도넛 지름·격자 칸·카드 프레임)에서 계산한 값이라 카드가 바뀌면 같이 바뀐다.
//    스켈레톤이 실제보다 크거나 작으면 도착 순간 레이아웃이 튀어서 넣기 전보다 나빠진다.
// ⚠️ 펄스는 **무한 루프**다. 데이터가 도착하면 호출부(StatsScreen)가 삼항으로 이 트리 자체를
//    걷어내야 한다 — opacity 0으로 숨기면 루프가 그대로 남는다.
// ⚠️ 동시 표시 장수는 일 7 / 주·월 9로, 저사양 기기 프레임 예산 상한(약 12장) 안이다.
//
// 하위 카드 컴포넌트(차트·비교·최장 세션 등)가 각자 들고 있는 작은 ActivityIndicator는
// **그대로 둔다.** 이 스켈레톤은 "카드 목록 자체가 아직 없다"는 상태고, 그쪽은 "카드는 떴고
// 그 카드의 데이터만 아직"이라는 다른 상태다. 둘은 시간상 겹치지 않는다 — 이 트리가 사라진
// 다음에야 카드가 마운트되고 그때 각자 조회를 시작한다.
import { StyleSheet, View } from 'react-native';
import { SkeletonCard } from '@/components/Skeleton';
import { T } from '@/constants/theme';
import type { StatsPeriod } from '@/types/dto/stats';
import { skeletonCards } from './constants';

export function StatsSkeleton({ period }: { period: StatsPeriod }) {
  return (
    <View testID="stats.skeleton" style={s.wrap}>
      {skeletonCards(period).map((c) => (
        <SkeletonCard key={c.key} height={c.height} testID={`stats.skeleton.${c.key}`} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  // CardOrderEditor의 콘텐츠 여백·간격과 같은 값 — 로딩에서 실제 목록으로 넘어갈 때 카드가
  // 같은 자리에서 시작해야 한다.
  wrap: {
    flex: 1,
    overflow: 'hidden',
    paddingHorizontal: T.space.xl,
    gap: T.space.lg,
  },
});
