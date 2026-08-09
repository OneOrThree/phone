import {
  withSequence,
  withSpring,
  withTiming,
  type LayoutAnimationFunction,
} from 'react-native-reanimated';
import { M } from '@/constants/motion';

// 리그 순위 재정렬 트랜지션 (GROMO-1381).
// 타이밍 정본은 시안 docs/prd/motion/ui.html 의 `swapWithAbove` — 문서 산문과 어긋나면 시안이 맞다.
//
// 왜 `LinearTransition`(세로 이동만)이 아닌가 —
//   두 행이 세로로만 스쳐 지나가면 서로 겹쳐서 "리스트가 통째로 다시 그려진 것"처럼 보인다.
//   시안은 올라가는 행을 왼쪽(-9), 밀려나는 행을 오른쪽(+9)으로 부풀렸다 제자리로 돌려
//   **서로 옆으로 비껴가게** 만든다. 그 궤적이 "한 칸 올랐다"는 사실을 읽히게 하는 핵심이라
//   레이아웃 트랜지션을 직접 쓴다. 세로 축은 그대로 `M.spring.snappy` — 즉
//   `springify(LinearTransition)`과 같은 호흡에 가로 궤적만 얹은 형태다.
//
// ⚠️ 이 함수는 UI 스레드에서 도는 워클릿이다. JS 클로저(useMotion 등)를 안에서 부르지 않는다.
//    '동작 줄이기'는 호출부가 `m.css(rankSwap)`으로 prop 자체를 떨어뜨려 처리한다.
// ⚠️ 시안의 `scale 1.03`(올라가는 행이 살짝 뜸)은 옮기지 않았다 — 레이아웃 트랜지션이 transform을
//    통째로 잡으면 행 내부의 다른 transform과 소유권이 겹친다. 비껴가기만으로 과정은 읽힌다.

/** 서로 비껴가는 가로 진폭(pt) — 시안 swapWithAbove 의 ±9 */
const LATERAL = 9;
/** 나갔다 돌아오는 한쪽 구간. 왕복 합이 base(350)라 스왑 간격 300ms 호흡과 겹쳐 흐른다. */
const ARC_MS = M.dur.base / 2;

export const rankSwap: LayoutAnimationFunction = (values) => {
  'worklet';
  // 위로 올라가는 행이면 왼쪽(-), 밀려나는 행이면 오른쪽(+)으로 비껴간다.
  const dy = values.targetOriginY - values.currentOriginY;
  const amp = dy < 0 ? -LATERAL : LATERAL;
  return {
    initialValues: {
      originX: values.currentOriginX,
      originY: values.currentOriginY,
      width: values.currentWidth,
      height: values.currentHeight,
    },
    animations: {
      // 세로 이동이 없는 변화(폭·높이만 바뀜)에서는 가로로 흔들지 않는다 — 이유 없는 흔들림이 된다.
      originX:
        dy === 0
          ? withTiming(values.targetOriginX, {
              duration: M.dur.base,
              easing: M.curve.standard.fn,
            })
          : withSequence(
              withTiming(values.targetOriginX + amp, {
                duration: ARC_MS,
                easing: M.curve.standard.fn,
              }),
              withTiming(values.targetOriginX, {
                duration: ARC_MS,
                easing: M.curve.standard.fn,
              }),
            ),
      originY: withSpring(values.targetOriginY, M.spring.snappy),
      width: withTiming(values.targetWidth, { duration: M.dur.base, easing: M.curve.standard.fn }),
      height: withTiming(values.targetHeight, {
        duration: M.dur.base,
        easing: M.curve.standard.fn,
      }),
    },
  };
};
