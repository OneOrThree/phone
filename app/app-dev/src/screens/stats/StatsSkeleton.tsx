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
// ⚠️ 그래서 카드 목록을 `SkeletonGroup`으로 감싼다. 카드마다 펄스를 걸면 일 7 / 주·월 9개의
//    무한 CSS 애니메이션이 동시에 돈다(codex 리뷰 지적). 그룹은 펄스를 **한 겹**에만 걸고
//    하위 카드는 정적으로 그리므로, 화면당 무한 루프가 1개로 유지되고 카드들이 같은 불투명도를
//    공유해 눈에는 똑같이 보인다.
//
// 하위 카드 컴포넌트(차트·비교·최장 세션 등)가 각자 들고 있는 작은 ActivityIndicator는
// **그대로 둔다.** 이 스켈레톤은 "카드 목록 자체가 아직 없다"는 상태고, 그쪽은 "카드는 떴고
// 그 카드의 데이터만 아직"이라는 다른 상태다. 둘은 시간상 겹치지 않는다 — 이 트리가 사라진
// 다음에야 카드가 마운트되고 그때 각자 조회를 시작한다.
import { StyleSheet, useWindowDimensions } from 'react-native';
import { SkeletonCard, SkeletonGroup } from '@/components/Skeleton';
import { T } from '@/constants/theme';
import type { StatsPeriod } from '@/types/dto/stats';
import { LIST_PAD_H, skeletonCards } from './constants';
import { calendarRowCount, mergeCardOrder } from './format';

export function StatsSkeleton({
  period,
  savedOrder,
  subjectCount,
  unclassifiedRow = false,
}: {
  period: StatsPeriod;
  /**
   * 이 탭에 저장된 카드 순서(AsyncStorage). 아직 못 읽었으면 undefined.
   *
   * ⚠️ 없다고 기본 순서로 그리면, 사용자가 400px 넘는 주간 타임테이블을 맨 위로 올려 뒀을 때
   *    로딩이 끝나는 순간 짧은 첫 카드가 큰 카드로 바뀌며 화면 대부분이 밀린다(codex 리뷰).
   *    정렬은 실제 목록과 **같은 함수**(mergeCardOrder)를 쓴다 — 저장에 없는 새 카드·이제
   *    없는 카드 처리가 두 곳에서 갈리면 결국 같은 증상이 난다.
   */
  savedOrder?: string[];
  /**
   * 이번에 범례에 뜰 과목 수(0초 과목 제외) — 도넛·일간 타임테이블 범례 행 수.
   *
   * ⚠️ 범례가 6줄부터 132px 링보다 높아진다. 이걸 안 넘기면 과목을 많이 만든 사용자는
   *    도착 순간 도넛 카드가 수십 px 자라 아래 카드들이 밀린다(codex 리뷰).
   */
  subjectCount: number;
  /**
   * 도넛 범례에 '미분류' 행이 하나 더 붙는지(일 탭 총계 > 과목 합).
   * ⚠️ 도넛에만 붙는다 — 타임테이블 범례엔 없다(constants.skeletonCards 주석).
   */
  unclassifiedRow?: boolean;
}) {
  // 목표 달성 카드의 캘린더 행 수 — **실제 그리드와 같은 함수**로 구한다(format.calendarRows).
  // 월은 달마다 5행이거나 6행이라 상수로 박으면 도착 순간 한 행이 갑자기 늘어난다.
  const rows = period === 'DAY' ? 0 : calendarRowCount(period, 0);
  // 캘린더 셀 높이는 화면 폭에서 파생된다(flex:1 + aspectRatio) — 실제 폭을 넘겨야 큰 화면에서
  // 카드가 짧아지지 않는다.
  const { width } = useWindowDimensions();

  const cards = skeletonCards({
    period,
    calendarRows: rows,
    screenWidth: width,
    subjectCount,
    unclassifiedRow,
  });
  const byKey = new Map(cards.map((c) => [c.key, c]));
  const ordered = mergeCardOrder(
    cards.map((c) => c.key),
    savedOrder,
  ).flatMap((k) => byKey.get(k) ?? []);

  return (
    // 목록 컨테이너를 SkeletonGroup으로 **교체**했다(새로 끼운 게 아니다) — 노드가 늘면
    // 스크롤 컨테이너와의 관계·치수가 흔들려 카드 높이 계측이 어긋난다.
    <SkeletonGroup testID="stats.skeleton" style={s.wrap}>
      {ordered.map((c) => (
        <SkeletonCard key={c.key} height={c.height} testID={`stats.skeleton.${c.key}`} />
      ))}
    </SkeletonGroup>
  );
}

const s = StyleSheet.create({
  // CardOrderEditor의 콘텐츠 여백·간격과 같은 값 — 로딩에서 실제 목록으로 넘어갈 때 카드가
  // 같은 자리에서 시작해야 한다.
  wrap: {
    flex: 1,
    overflow: 'hidden',
    paddingHorizontal: LIST_PAD_H,
    gap: T.space.lg,
  },
});
