// RankRowShell — 랭킹 행 껍데기의 **진입 시차 고정** 계약 테스트 (GROMO-1381).
//
// 잠그는 규칙 하나: 순위가 바뀌어(=index prop이 바뀌어) 같은 행이 자리를 옮겨도
// **진입 애니메이션은 다시 재생되지 않는다.**
// enterUp은 인덱스별 캐시라 참조가 갈리고, Reanimated CSS는 참조 동등성으로 재시작을
// 판단한다 — 그래서 껍데기가 마운트 시점 인덱스를 붙들지 않으면, 재정렬되는 행마다
// 가로 스왑과 진입이 겹쳐 "리스트가 다시 그려진 것"처럼 보인다(claude 리뷰).
//
// ⚠️ 애니메이션의 **중간 프레임·타이밍**을 단언하는 게 아니다(워클릿은 jest에서 목이라 실행되지
//    않는다). 여기서 보는 것은 "어떤 스타일 객체가 붙었는가"뿐이다.
// ⚠️ reanimated는 CSS 애니메이션 프로퍼티를 호스트 뷰의 style에서 걷어내 자체 관리로 넘긴다 —
//    그래서 단언은 props.jestInlineStyle로 한다.
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { View } from 'react-native';
import { RankRowShell } from './RankRowShell';

// 껍데기 자신에겐 testID가 없다(실제 리스트에서도 없다 — Maestro는 행 안쪽을 집는다).
// 자식에 testID를 두고 부모(=껍데기 루트 Animated.View)를 집는다.
function zIndexOf(testID: string): number | undefined {
  const shell = screen.getByTestId(testID).parent;
  const flat = StyleSheet.flatten(shell?.props.style) as { zIndex?: number } | undefined;
  return flat?.zIndex;
}

// 스타일이 배열(zIndex + 진입 프리셋)이 되면서 평탄화가 필요해졌다.
function delayOf(testID: string): string | undefined {
  const shell = screen.getByTestId(testID).parent;
  const flat = StyleSheet.flatten(shell?.props.jestInlineStyle) as
    | { animationDelay?: string }
    | undefined;
  return flat?.animationDelay;
}

describe('진입 시차 고정', () => {
  test('index가 바뀌어도 마운트 시점 시차를 유지한다(진입 재생 없음)', async () => {
    const { rerender } = await render(
      <RankRowShell index={0}>
        <View testID="row" />
      </RankRowShell>,
    );
    const mounted = delayOf('row');
    expect(mounted).toBe('0ms');

    // 순위가 밀려 같은 행이 3번째 자리로 이동 — 노드는 그대로 살아 있다.
    await rerender(
      <RankRowShell index={3}>
        <View testID="row" />
      </RankRowShell>,
    );

    expect(delayOf('row')).toBe(mounted);
  });

  test('새로 들어온 행은 자기 자리의 시차를 받는다', async () => {
    await render(
      <RankRowShell index={3}>
        <View testID="row" />
      </RankRowShell>,
    );

    // stagger 기본 간격 60ms × 3
    expect(delayOf('row')).toBe('180ms');
  });

  // ⚠️ 스왑 중에는 올라가는 행이 위에 그려져야 한다 — 기본 그리기 순서로는 밀려나는 행이
  //    주인공을 덮는다(codex 리뷰, 정본 시안도 상승 2 · 하강 1을 명시).
  test('자리가 올라간 행은 스왑 동안 위에 그려진다', async () => {
    const view = await render(
      <RankRowShell index={3}>
        <View testID="row" />
      </RankRowShell>,
    );
    expect(zIndexOf('row')).toBe(1);

    // 3번째 → 1번째로 올라간 커밋
    await view.rerender(
      <RankRowShell index={1}>
        <View testID="row" />
      </RankRowShell>,
    );
    expect(zIndexOf('row')).toBe(2);

    // 자리가 그대로인 다음 단계에서는 되돌아간다
    await view.rerender(
      <RankRowShell index={1}>
        <View testID="row" />
      </RankRowShell>,
    );
    expect(zIndexOf('row')).toBe(1);
  });
});
