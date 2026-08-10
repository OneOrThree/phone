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

// ── 재정렬을 **한 칸씩** 재생하기 위한 순수 큐 빌더 ──────────────────────────────
//
// 아래 `rankSwap` 워클릿은 "한 번의 자리 이동"을 그리는 궤적일 뿐이다. 서버 갱신이 8위→4위처럼 여러 칸을
// 한꺼번에 바꿔 넣으면, 그 궤적은 네 번의 인접 스왑이 아니라 한 번의 긴 이동이 된다 —
// 정본(§6 "맨 아래에서 맨 위까지 한 칸씩 4단계", 시안 SWAP_GAP 300ms)이 말하는 상승 과정이
// 통째로 사라진다(codex 리뷰). 그래서 **어떤 중간 순서를 거쳐 갈지**를 여기서 미리 만든다.
//
// 다루는 것은 데이터가 아니라 **키 순서**뿐이다. 화면에 그릴 값(기록·막대)은 언제나 최신
// 응답에서 가져와야 정본의 "자리가 바뀌기 직전에 내 기록과 막대가 먼저 자란다"가 성립한다 —
// 값은 즉시 갱신되고 자리만 뒤따라 온다.

/** 스왑 간격(ms) — 시안 `SWAP_GAP`. 완급 없이 같은 호흡으로 연달아. */
export const SWAP_GAP_MS = 300;
/** 기록이 오르고 자리가 바뀌기까지(ms) — 시안 `SWAP_LEAD`. */
export const SWAP_LEAD_MS = 90;
/**
 * 한 번의 재정렬에서 재생할 **자리 이동 횟수 상한**.
 *
 * 정본에는 상한이 없다 — 시안이 4칸짜리 상승만 보여주기 때문이다. 하지만 실제 데이터는
 * 20위→1위(19단계 = 5.7초)도 나온다. 그동안 목록이 계속 움직이면 사용자는 탭할 대상을 잃고,
 * 애초에 이 연출이 노리는 "한 칸 올랐다"는 읽힘도 19번 반복되면 남지 않는다.
 * 그래서 시차 총합 상한(`M.staggerMaxSteps`)과 **같은 개념·같은 값**을 쓴다 — 초과분은 버리는
 * 게 아니라 **첫 한 단계로 묶어** 한 번에 이동시킨다(staggerDelay가 초과 항목을 마지막 칸에
 * 묶는 것과 같은 클램프 규율). 과정의 마지막 몇 칸은 그대로 한 칸씩 재생돼 도착이 보인다.
 * 최대 소요 = LEAD 90 + 6 × 300 = 1890ms.
 */
export const SWAP_MAX_STEPS = M.staggerMaxSteps;

/**
 * `from` 순서에서 `to` 순서로 가는 **렌더 큐**를 만든다.
 *
 * - `[0]`은 리드 프레임 — 순서는 `from` 그대로다(값만 갱신되고 자리는 아직 안 움직인다).
 * - `[1..]`은 자리 이동 단계. 마지막 원소는 항상 `to`와 같은 순서다.
 * - 큐 길이가 1이면 재생할 것이 없다는 뜻 = 곧장 최종 배열로 가면 된다.
 *
 * 다음 경우에는 단계를 만들지 않고 `[to]`만 돌려준다. 인접 스왑 연출은 **행 노드의 동일성**을
 * 전제하는데(정본 §6), 아래는 그 전제가 깨진 상황이라 중간 순서를 그려도 의미가 없다:
 *   · 순서가 이미 같다  · 길이가 다르다  · 구성원이 다르다(진입/이탈)  · 키에 중복이 있다
 */
export function rankSwapQueue(
  from: readonly string[],
  to: readonly string[],
  maxSteps: number = SWAP_MAX_STEPS,
): string[][] {
  const final = [...to];
  if (from.length !== to.length || maxSteps < 1) return [final];
  const targetIndex = new Map<string, number>();
  to.forEach((key, i) => targetIndex.set(key, i));
  // 구성원이 같은지(그리고 키가 유일한지) — Map 크기로 중복까지 한 번에 걸러진다
  if (targetIndex.size !== to.length) return [final];
  if (from.some((key) => !targetIndex.has(key))) return [final];

  // 인접 스왑만으로 from을 to로 정렬한다(삽입 정렬 = 최소 전치 횟수 = 역전 수).
  // 매 스왑 직후의 순서를 스냅샷으로 남기면 그게 곧 "한 칸씩" 재생할 중간 배열이다.
  const work = [...from];
  const snapshots: string[][] = [];
  for (let i = 1; i < work.length; i += 1) {
    let j = i;
    while (j > 0 && targetIndex.get(work[j - 1])! > targetIndex.get(work[j])!) {
      const above = work[j - 1];
      work[j - 1] = work[j];
      work[j] = above;
      j -= 1;
      snapshots.push([...work]);
    }
  }
  if (snapshots.length === 0) return [final];

  // 상한 초과분은 **첫 한 단계로 묶는다**(위 SWAP_MAX_STEPS 주석). 묶음도 레이아웃
  // 트랜지션을 타므로 순간이동이 아니라 여러 칸을 한 번에 미끄러지는 이동이 된다.
  const tailCount = snapshots.length > maxSteps ? maxSteps - 1 : snapshots.length;
  const start = snapshots.length - tailCount;
  const queue: string[][] = [[...from]];
  if (start > 0) queue.push(snapshots[start - 1]);
  for (let i = start; i < snapshots.length; i += 1) queue.push(snapshots[i]);
  return queue;
}

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
              reduceMotion: M.never,
            })
          : withSequence(
              withTiming(values.targetOriginX + amp, {
                duration: ARC_MS,
                easing: M.curve.standard.fn,
                reduceMotion: M.never,
              }),
              withTiming(values.targetOriginX, {
                duration: ARC_MS,
                easing: M.curve.standard.fn,
                reduceMotion: M.never,
              }),
            ),
      originY: withSpring(values.targetOriginY, M.spring.snappy),
      width: withTiming(values.targetWidth, {
        duration: M.dur.base,
        easing: M.curve.standard.fn,
        reduceMotion: M.never,
      }),
      height: withTiming(values.targetHeight, {
        duration: M.dur.base,
        easing: M.curve.standard.fn,
        reduceMotion: M.never,
      }),
    },
  };
};
