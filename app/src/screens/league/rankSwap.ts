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

// ── 재정렬 재생 계획(순서 + 기록)을 만드는 순수 빌더 ────────────────────────────
//
// 아래 `rankSwap` 워클릿은 "한 번의 자리 이동"을 그리는 궤적일 뿐이다. 서버 갱신이 8위→4위처럼
// 여러 칸을 한꺼번에 바꿔 넣으면 그 궤적은 네 번의 인접 스왑이 아니라 한 번의 긴 이동이 된다 —
// 정본 §6 "맨 아래에서 맨 위까지 한 칸씩 4단계"가 통째로 사라진다(codex 리뷰).
//
// ⚠️ **순서만 늦추면 절반짜리다.** 정본은 자리 이동의 원인까지 규정한다 —
//      "자리가 바뀌기 직전에 내 기록과 막대가 먼저 자란다. **바로 위 사람을 앞지르는 값이라야
//       상승이 납득된다.**"
//    시안도 한 칸마다 내 기록을 갱신한다(`CLIMB = [1612, 1738, 1855, 1932]` — 각 값이 그 순간
//    바로 위 사람을 막 넘어선다). 순서만 단계화하고 기록을 처음부터 최종값으로 두면 4위 자리에
//    1위 기록이 표시된 채 세 번 자리만 바뀌어, **표시된 순서와 표시된 숫자가 서로 모순되는**
//    프레임이 2초 가까이 남는다(codex 리뷰). 그래서 기록도 함께 단계화한다.
//
//    중간 기록은 지어낸 숫자가 아니다. 누적 집중 시간은 **단조 증가**라, 직전에 화면에 있던 값과
//    새 서버 값 사이의 모든 값은 그 사용자가 실제로 거쳐 온 값이다 — 이미 이 저장소가 쓰는
//    count-up(AnimatedNumber) 연출과 같은 지위다.
//    ⚠️ 마지막 단계의 값은 예외 없이 **서버 최종값**이다. 중간값이 화면에 남으면 진짜 버그다.

// ── 단계 기록은 **프레임 전체**를 보고 배정한다 (GROMO-1475) ───────────────────
//
// 지키는 불변식은 둘이다.
//   ① **프레임 정합** — 각 프레임의 표시 기록은 그 프레임의 순서를 따라 **비증가**한다.
//      예외는 하나뿐이고 그건 버그가 아니라 연출이다: **리드 프레임**에서 상승 행이
//      *바로 다음 프레임에 앞지를 상대*보다 큰 값을 먼저 보여 준다 — 정본 §6이 요구하는
//      자리 이동의 '원인'이 그 역전이다. 90ms 뒤 자리가 따라오며 곧바로 해소된다.
//   ② **기록 불감소** — 각 행의 값은 `[직전 표시값, 서버 최종값]` 구간 안이다.
//
// 예전 배정은 **상승 행 하나**만 제약했다(방금 앞지른 상대보다 크고, 아직 안 넘은 다음 상대보다
// 작게). 그래서 한 응답에서 여러 사용자의 기록이 함께 오르면 상승에 참여하지 않는 행이 곧장
// 서버 최종값으로 튀어, "아래 행이 위 행보다 큰 기록"이 300ms 남았다(codex 리뷰, PR #561).
//
// 지금은 프레임 하나를 통째로 배정한다 — **위에서부터 천장을 눌러 내린다**:
//     v(1) = f(1),  v(i) = min(f(i), v(i-1))
// 정의상 그 프레임 순서를 따라 비증가고(①), 각 행이 가질 수 있는 **최댓값**이다. 그래서 이
// 배정이 ②(v ≥ 직전 표시값)를 못 지키면 **어떤 배정도 못 지킨다** — 판정이 곧 가능성 판정이다.
//
// ⚠️ **두 불변식이 동시에 성립할 수 없는 입력이 있다.** 아래 행의 출발값이 위 행의 최종값보다
//    크면(위 행의 천장이 아래 행의 바닥보다 낮으면) ①을 지키려면 기록을 깎아야 하고, ②를
//    지키려면 순서가 깨진 프레임을 보여야 한다. 그때는 **단계화를 통째로 생략하고 최신 배열로
//    즉시 간다**(결정 로그 N01). 점수 감소 갱신에 이미 쓰던 그 처방이다 — 기록을 거짓말하지도,
//    깨진 프레임을 보이지도 않는다.
//
// 판정은 **두 순서만** 본다(O(n), 중간 스냅샷 불필요). 인접 스왑 정렬은 역전을 만들지 않고
// 풀기만 하므로, 한 쌍의 상하 관계는 재생 내내 최대 한 번 `from` 관계 → `to` 관계로만 바뀐다.
// 즉 어떤 중간 프레임에서 q가 r 위에 있다면 그건 `from`에서든 `to`에서든 이미 그랬다는 뜻이다.
// 따라서
//   · `to`에서 최종값이 비증가하고 (마지막 프레임은 서버 값 그대로라 우리가 고칠 수 없다)
//   · `from`의 각 자리에서 **접두 최소 최종값 ≥ 그 행의 출발값** 이면
// 모든 중간 프레임이 자동으로 성립한다.
//
// 프레임 사이 단조성도 같은 이유로 공짜다. r 위로 새로 끼어드는 행 q는 r을 앞지른 행뿐인데,
// 그건 `to`에서 q가 r 위라는 뜻이라 f(q) ≥ f(r) ≥ (그때까지의 천장)이다 — 천장이 내려갈 일이
// 없다. 마지막 프레임의 천장은 `to`의 접두 최소 = 각자의 최종값이라 언제나 서버 값으로 끝난다.

/** 스왑 간격(ms) — 시안 `SWAP_GAP`. 완급 없이 같은 호흡으로 연달아. */
export const SWAP_GAP_MS = 300;
/** 기록이 오르고 자리가 바뀌기까지(ms) — 시안 `SWAP_LEAD`. */
export const SWAP_LEAD_MS = 90;
/**
 * 한 번의 재정렬에서 재생할 **자리 이동 횟수 상한**.
 *
 * 정본에는 상한이 없다 — 시안이 4칸짜리 상승만 보여주기 때문이다. 하지만 실제 데이터는
 * 20위→1위(19단계)도 나온다. 그동안 목록이 계속 움직이면 사용자는 탭할 대상을 잃고,
 * 애초에 이 연출이 노리는 "한 칸 올랐다"는 읽힘도 19번 반복되면 남지 않는다.
 * 그래서 시차 총합 상한(`M.staggerMaxSteps`)과 **같은 개념·같은 값**을 쓴다 — 초과분은 버리는
 * 게 아니라 **첫 한 단계로 묶어** 한 번에 이동시킨다(staggerDelay가 초과 항목을 마지막 칸에
 * 묶는 것과 같은 클램프 규율). 과정의 마지막 몇 칸은 그대로 한 칸씩 재생돼 도착이 보인다.
 * 최대 소요 = (6 - 1) × (90 + 300) + 90 = 2040ms.
 */
export const SWAP_MAX_STEPS = M.staggerMaxSteps;

/** 재생 계획의 한 프레임 — 이 시각에 이 순서·이 기록으로 그린다. */
export interface RankSwapFrame {
  /** 시퀀스 시작으로부터의 시각(ms). `[0]`은 항상 0이라 새 데이터가 온 렌더에서 곧바로 그린다. */
  at: number;
  /** 이 프레임에서 그릴 순서 */
  order: string[];
  /** 서버 최종 기록을 덮어쓸 값(초). **비어 있으면 전부 서버 최종값**이다. */
  seconds: Map<string, number>;
}

/**
 * `from`을 `to` 순서로 만드는 **인접 스왑**을 순서대로 훑는다(삽입 정렬 = 최소 전치 횟수).
 * 스냅샷을 만들지 않고 콜백에 넘기므로, 호출부가 **필요한 구간만** 복사할 수 있다.
 * 반환값은 총 스왑 횟수. 같은 입력이면 두 번 돌려도 같은 순서를 준다(결정적).
 */
function walkAdjacentSwaps(
  from: readonly string[],
  targetIndex: ReadonlyMap<string, number>,
  onSwap: (index: number, work: readonly string[]) => void,
): number {
  const work = [...from];
  let n = 0;
  for (let i = 1; i < work.length; i += 1) {
    let j = i;
    while (j > 0 && targetIndex.get(work[j - 1])! > targetIndex.get(work[j])!) {
      const above = work[j - 1];
      work[j - 1] = work[j];
      work[j] = above;
      j -= 1;
      onSwap(n, work);
      n += 1;
    }
  }
  return n;
}

/**
 * `from` 순서·기록에서 `to` 순서·기록으로 가는 **재생 계획**을 만든다.
 *
 * 프레임은 한 칸 이동마다 두 장씩 나온다 — 시안의 호흡 그대로다:
 *   기록 갱신(`at = k × (LEAD + GAP)`) → `LEAD` 뒤 자리 이동 → `GAP` 뒤 다음 기록 갱신
 *
 * 빈 배열을 돌려주면 "재생할 것이 없다" = 최신 배열을 그대로 그리면 된다는 뜻이다. 인접 스왑
 * 연출은 **행 노드의 동일성**을 전제하는데(정본 §6), 아래는 그 전제가 깨진 상황이라 중간 순서를
 * 그려도 의미가 없다: 순서가 이미 같다 · 길이가 다르다 · 구성원이 다르다 · 키에 중복이 있다.
 * 여기에 더해 **두 불변식이 동시에 성립하지 않는 입력**도 빈 배열이다(위 GROMO-1475 주석) —
 * 점수가 줄어든 갱신 · 최종값이 최종 순서와 어긋나는 응답 · 아래 행의 출발값이 위 행의 최종값을
 * 넘는 배치.
 *
 * @param finalSeconds 새 응답의 기록(초) — 도착점
 * @param startSeconds **직전에 화면에 있던** 기록(초) — 출발점. 없는 키는 최종값에서 출발한다.
 */
export function rankSwapFrames(
  from: readonly string[],
  to: readonly string[],
  finalSeconds: ReadonlyMap<string, number>,
  startSeconds: ReadonlyMap<string, number>,
  maxSteps: number = SWAP_MAX_STEPS,
): RankSwapFrame[] {
  if (from.length !== to.length || maxSteps < 1) return [];
  const targetIndex = new Map<string, number>();
  to.forEach((key, i) => targetIndex.set(key, i));
  // 구성원이 같은지(그리고 키가 유일한지) — Map 크기로 중복까지 한 번에 걸러진다
  if (targetIndex.size !== to.length) return [];
  if (from.some((key) => !targetIndex.has(key))) return [];

  const finalOf = (key: string): number => finalSeconds.get(key) ?? 0;
  /** 직전에 화면에 있던 값 = 그 행의 **바닥**. 없는 키는 이미 최종값을 보이고 있었다고 본다. */
  const startOf = (key: string): number => startSeconds.get(key) ?? finalOf(key);

  // ⚠️ **점수가 하나라도 줄었으면 단계화를 통째로 건너뛴다.** 주 경계(월요일 KST)나 재집계면
  //    같은 구성원이 새 주 점수로 재정렬되는데, 이전 주 누적을 하한으로 붙들면 새 순서와 옛
  //    기록이 최대 2초간 함께 표시되다 마지막에 급락한다(codex 리뷰). "올라가는 과정"이라는
  //    이 연출의 전제 자체가 성립하지 않는 갱신이다. (= 불변식 ②가 아예 불가능한 입력)
  if (from.some((key) => finalOf(key) < startOf(key))) return [];
  // 도착점 자체가 정합해야 한다 — 마지막 프레임은 서버 최종값 그대로라 우리가 고칠 수 없다.
  // (서버는 totalFocusSeconds 내림차순으로 순위를 주므로 평시엔 늘 참이다.)
  for (let i = 1; i < to.length; i += 1) {
    if (finalOf(to[i - 1]) < finalOf(to[i])) return [];
  }
  // 출발점에서도 두 불변식이 함께 성립하는가 — 위 행들의 천장(접두 최소 최종값)이 이 행의
  // 바닥보다 낮으면 모순이다. 이 둘만 통과하면 중간 프레임 전부가 성립한다(위 주석의 근거).
  let admissible = Number.POSITIVE_INFINITY;
  for (const key of from) {
    admissible = Math.min(admissible, finalOf(key));
    if (admissible < startOf(key)) return [];
  }

  // 인접 스왑만으로 from을 to로 정렬한다(삽입 정렬 = 최소 전치 횟수 = 역전 수).
  //
  // ⚠️ 순서 스냅샷은 여기서 만들지 않는다. 상위 100명이 크게 뒤집히는 갱신(주 경계 등)이면
  //    역전이 최대 4,950번인데, 재생하는 건 마지막 6단계뿐이라 나머지 스냅샷은 만들자마자
  //    버려진다 — 100항목 배열 4,950개(약 49만 참조)를 **렌더 중 동기적으로** 만드는 셈이다
  //    (codex 리뷰). 그래서 1차는 세기만 하고, 필요한 구간만 2차에서 만든다.
  const total = walkAdjacentSwaps(from, targetIndex, () => {});
  if (total === 0) return [];

  // 상한 초과분은 **첫 한 단계로 묶는다**(위 SWAP_MAX_STEPS 주석). 묶음의 기록은 따로 계산할
  // 게 없다 — 값은 **묶음이 끝난 그 프레임의 순서**로 배정되므로, 건너뛴 상대까지 전부 앞지른
  // 값이 저절로 나온다.
  const bundledUpTo = total > maxSteps ? total - maxSteps : 0;

  // 실제로 재생되는 구간(묶음 경계 이후)의 순서만 만든다 — 최대 maxSteps개다.
  const orders = new Map<number, string[]>();
  walkAdjacentSwaps(from, targetIndex, (i, work) => {
    if (i >= bundledUpTo) orders.set(i, [...work]);
  });

  const frames: RankSwapFrame[] = [];
  let prevOrder: string[] = [...from];
  let step = 0;
  for (let i = bundledUpTo; i < total; i += 1) {
    const order = orders.get(i)!;
    // 값은 **자리 이동이 끝난 뒤의 순서**로 배정한다. 그 값을 먼저 보여 주고(prevOrder 유지),
    // LEAD 뒤에 자리가 따라온다 — 리드 프레임의 역전이 곧 이 이동의 '원인'이다(정본 §6).
    const seconds = overridesOf(ceilingSeconds(order, finalOf), finalSeconds);
    const at = step * (SWAP_LEAD_MS + SWAP_GAP_MS);
    frames.push({ at, order: prevOrder, seconds });
    frames.push({ at: at + SWAP_LEAD_MS, order, seconds: new Map(seconds) });
    prevOrder = order;
    step += 1;
  }
  // ⚠️ 재생 구간은 최소 한 단계라 여기서 프레임이 비지는 않는다. 그래도 무가드로 마지막
  //    프레임을 건드리면 `TypeError: Cannot set properties of undefined`로 화면이 통째로
  //    날아간다 — 상한·묶음 규칙이 바뀌어도 안전하도록 막아 둔다(GROMO-1475).
  if (frames.length === 0) return [];
  // 마지막 프레임은 예외 없이 서버 최종값이다 — 중간값이 화면에 남지 않는다는 보장.
  // (`to`에서 최종값이 비증가라는 위 검사 덕에 이 대입은 천장 배정과 같은 값이다.)
  frames[frames.length - 1].seconds = new Map();
  return frames;
}

/**
 * 한 프레임의 표시 기록 — **위에서부터 천장을 눌러 내린다**: `v(i) = min(f(i), v(i-1))`.
 * 정의상 이 순서를 따라 비증가고(불변식 ①), 각 행이 가질 수 있는 최댓값이다.
 * 바닥(직전 표시값)은 여기서 다시 보지 않는다 — 위쪽 판정이 이미 `천장 ≥ 바닥`을 확인했다.
 */
function ceilingSeconds(
  order: readonly string[],
  finalOf: (key: string) => number,
): Map<string, number> {
  const out = new Map<string, number>();
  let ceiling = Number.POSITIVE_INFINITY;
  for (const key of order) {
    ceiling = Math.min(ceiling, finalOf(key));
    out.set(key, ceiling);
  }
  return out;
}

/** 최종값과 다른 항목만 남긴다 — 덮어쓸 게 없으면 빈 Map이 되어 호출부가 최신 값을 그대로 쓴다. */
function overridesOf(
  shown: ReadonlyMap<string, number>,
  finalSeconds: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  shown.forEach((value, key) => {
    if (value !== (finalSeconds.get(key) ?? 0)) out.set(key, value);
  });
  return out;
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
