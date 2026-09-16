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
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { View } from 'react-native';
import { M } from '@/constants/motion';
import { SWAP_GAP_MS } from '../rankSwap';
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
  //    ⚠️ **트랜지션 길이만큼 유지**해야 한다. 다음 기록 프레임은 300ms 뒤인데 가로 궤적은
  //       M.dur.base(350ms)라, 인덱스 변화 한 렌더만 참으로 두면 마지막 50ms가 뒤집힌다.
  test('자리가 올라간 행은 궤적이 끝날 때까지 위에 그려진다', async () => {
    jest.useFakeTimers();
    try {
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

      // 다음 단계 프레임(300ms)에서도 아직 궤적이 도는 중 — 유지된다
      await act(async () => {
        jest.advanceTimersByTime(SWAP_GAP_MS);
      });
      await view.rerender(
        <RankRowShell index={1}>
          <View testID="row" />
        </RankRowShell>,
      );
      expect(zIndexOf('row')).toBe(2);

      // 궤적이 끝나면 되돌아간다
      await act(async () => {
        jest.advanceTimersByTime(M.dur.base);
      });
      expect(zIndexOf('row')).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // 궤적 타이머가 도는 중에 같은 행이 **다시 내려가면**(핀 필터·리그 전환·새 재정렬 계획)
  // 정리 함수가 그 타이머를 취소해 setRising(false)가 영영 오지 않는다 — 그 행이 zIndex 2를
  // 영구히 들고 앉아 진짜 상승 행을 덮는다(codex 리뷰).
  test('궤적 중에 다시 내려가면 상승 표시를 그 자리에서 내린다', async () => {
    jest.useFakeTimers();
    try {
      const view = await render(
        <RankRowShell index={3}>
          <View testID="row" />
        </RankRowShell>,
      );
      await view.rerender(
        <RankRowShell index={1}>
          <View testID="row" />
        </RankRowShell>,
      );
      expect(zIndexOf('row')).toBe(2);

      // 궤적이 끝나기 전에 다시 하강 — 타이머는 취소되지만 표시는 즉시 내려가야 한다
      await view.rerender(
        <RankRowShell index={4}>
          <View testID="row" />
        </RankRowShell>,
      );
      expect(zIndexOf('row')).toBe(1);

      // 시간이 흘러도 되살아나지 않는다
      await act(async () => {
        jest.advanceTimersByTime(M.dur.base * 2);
      });
      expect(zIndexOf('row')).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
