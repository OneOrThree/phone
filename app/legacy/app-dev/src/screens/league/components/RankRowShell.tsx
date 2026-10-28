import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { M, enterUp } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { rankSwap } from '../rankSwap';

// 랭킹 행 껍데기 (GROMO-1381) — 진입 시차(enterUp)와 재정렬 궤적(rankSwap)만 담당한다.
// 루트가 곧 리스트가 원래 쓰던 행 컨테이너다 — 노드를 새로 끼우지 않으므로 testID 셀렉터(E2E)
// 계약이 그대로다. 행 내용(RankRow)은 children으로 받는다.
//
// ⚠️ **진입 시차 인덱스는 마운트 시점 값으로 고정한다.**
//    `enterUp`은 인덱스별로 캐싱된 스타일 객체를 돌려주고, Reanimated CSS의 `animationName`은
//    **참조 동등성**으로 재시작 여부를 판단한다. 행 노드는 `key={userId}`라 순위가 바뀌어도
//    살아남는데(그게 rankSwap의 전제다) 그 노드가 받는 배열 인덱스는 바로 그 순간 달라진다.
//    인덱스를 그대로 넘기면 `enterUp(2)`→`enterUp(5)`로 참조가 갈리면서 **재정렬되는 행마다
//    진입 애니메이션이 다시 재생**된다 — 가로 스왑과 겹쳐 "리스트가 통째로 다시 그려진 것"처럼
//    보이는, 이 연출이 피하려던 바로 그 인상이 된다(claude 리뷰).
//
//    고정 범위는 **노드 수명**이다. 진입은 '행이 트리에 들어올 때' 재생돼야 하는 연출이라,
//    리그 전환·핀 모드 토글로 목록이 갈릴 때도 새로 들어온 행만 재생되고 살아남은 행은 자리만
//    옮기는 것이 맞다(살아남은 행은 '진입'한 적이 없다). 목록이 통째로 갈리면 대부분의 행은
//    어차피 새 노드라 정상적으로 시차 진입한다.
//
// ⚠️ 얼리는 것은 `enterUp`의 **인자**이지 reduce 게이트가 아니다 — `m.css()`는 매 렌더 통과시켜야
//    재생 도중 '동작 줄이기'가 켜졌을 때 스타일이 떨어진다.

interface Props {
  /** 목록에서의 현재 자리. 진입 시차에는 **마운트 시점 값만** 쓴다(위 주석). */
  index: number;
  onLayout?: (event: LayoutChangeEvent) => void;
  children: ReactNode;
}

export function RankRowShell({ index, onLayout, children }: Props) {
  const m = useMotion();
  const enterIndex = useRef(index).current;
  // ⚠️ 스왑 중에는 **올라가는 행이 위에 그려져야 한다.** 목표 배열에서 상승 행이 먼저·하강 행이
  //    나중 형제라 기본 그리기 순서로는 밀려나는 행이 위를 덮는다 — 두 카드가 교차하는 동안
  //    이 연출의 주인공이 가려진다(codex 리뷰). 정본 시안(ui.html)도 상승 2 · 하강 1을 명시한다.
  //    layout 트랜지션은 originX/Y·크기만 다루므로 zIndex는 스타일로 준다.
  //    ⚠️ 직전 렌더의 자리와 비교한다. 이 값은 자리가 바뀐 **그 커밋**에서만 참이고, 다음
  //       단계(390ms 뒤) 렌더에서 자연히 1로 돌아간다 — 트랜지션이 도는 동안만 유지된다.
  //    ⚠️ **트랜지션이 끝날 때까지 유지한다.** 다음 기록 프레임은 스왑 300ms 뒤에 오는데
  //       rankSwap의 가로 궤적은 M.dur.base(350ms)라, 인덱스 변화 한 렌더만 참으로 두면 마지막
  //       50ms 동안 상승 행이 다시 아래로 깔린다(codex 리뷰). 타이머로 궤적 길이만큼 붙든다.
  const prevIndexRef = useRef(index);
  const [rising, setRising] = useState(false);
  useEffect(() => {
    const moved = index < prevIndexRef.current;
    prevIndexRef.current = index;
    if (!moved) {
      // ⚠️ 상승 표시를 **여기서 반드시 내린다.** 궤적 타이머가 아직 도는 중에 핀 필터·리그
      //    전환·새 재정렬 계획으로 같은 행이 다시 내려가면, 정리 함수가 그 타이머를 취소해
      //    버려서 `setRising(false)`가 영영 오지 않는다. 그 행은 zIndex 2를 영구히 들고
      //    앉아 진짜 상승 행을 덮는다(codex 리뷰).
      setRising(false);
      return undefined;
    }
    setRising(true);
    const t = setTimeout(() => setRising(false), M.dur.base);
    return () => clearTimeout(t);
  }, [index]);
  return (
    <Animated.View
      layout={m.css(rankSwap)}
      style={[rising ? z.rising : z.falling, m.enter(enterUp(enterIndex))]}
      onLayout={onLayout}
    >
      {children}
    </Animated.View>
  );
}

// 스왑 중 그리기 순서 — 정본 시안(ui.html)의 상승 2 · 하강 1.
const z = StyleSheet.create({
  rising: { zIndex: 2 },
  falling: { zIndex: 1 },
});
