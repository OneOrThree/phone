import { useEffect, useReducer, useRef } from 'react';
import { useMotion } from '@/hooks/useMotion';
import { rankSwapQueue, SWAP_GAP_MS, SWAP_LEAD_MS } from './rankSwap';

// 순위 재정렬을 **한 칸씩** 재생시키는 어댑터 (GROMO-1381 / 정본 low-level-design.md §6).
//
// 서버 갱신(useLeagueRanking)은 새 순위 배열을 한 번에 갈아끼운다. 그대로 렌더하면 8위→4위
// 갱신에서 네 번의 인접 스왑이 아니라 관련 행들이 동시에 서로를 가로질러 한 번에 이동한다 —
// 정본이 요구하는 상승 "과정"이 사라진다(codex 리뷰). 그래서 최종 배열을 바로 그리지 않고
// 중간 순서를 큐로 적용한다.
//
// ⚠️ 이 훅이 들고 있는 것은 **순서(키 배열)뿐**이고 데이터는 아니다. 그려지는 값(기록·막대)은
//    언제나 인자로 받은 최신 배열에서 온다 — 정본의 "자리가 바뀌기 직전에 내 기록과 막대가
//    먼저 자란다"가 이렇게 성립한다(값 먼저, 자리 나중). 낡은 데이터를 붙들지도 않는다.
//
// ⚠️ 큐 계산을 **렌더 중에** 한다(useEffect가 아니다). effect로 미루면 새 배열이 도착한 렌더가
//    최종 순서 그대로 한 번 커밋되고, 그 커밋에서 레이아웃 애니메이션이 이미 '여러 칸 한 번에'
//    로 발화한다 — 되돌리는 두 번째 커밋이 뒤따라도 이 훅이 막으려던 그 이동을 이미 보여 준
//    뒤다. 렌더 중에 정하면 커밋은 한 번뿐이고 그 커밋이 곧 리드 프레임이다.

interface Keyed {
  userId: string;
}

/** effect 의존성이 아니라 렌더 중 비교에 쓰는 순서 키. 구분자는 userId에 없는 문자면 된다. */
const KEY_SEP = '|';

/** 화면에 그릴 순서(order)를 최신 데이터(items)에 입힌다. 못 입히면 최신 배열 그대로. */
function applyOrder<T extends Keyed>(items: T[], order: string[] | null): T[] {
  if (order === null || order.length !== items.length) return items;
  const byKey = new Map(items.map((item) => [item.userId, item]));
  if (byKey.size !== items.length) return items;
  const reordered: T[] = [];
  for (const key of order) {
    const item = byKey.get(key);
    // 진행 중이던 순서가 새 응답의 구성원과 어긋나면 연출을 포기하고 최신 배열로 간다
    if (item === undefined) return items;
    reordered.push(item);
  }
  return reordered;
}

export function useStagedRanking<T extends Keyed>(items: T[]): T[] {
  const m = useMotion();
  const [, bumpFrame] = useReducer((n: number) => n + 1, 0);

  // null = 재생 중이 아님(최신 배열을 그대로 그린다).
  const orderRef = useRef<string[] | null>(null);
  // 아직 재생하지 않은 자리 이동 단계들.
  const pendingRef = useRef<string[][]>([]);
  const lastTargetRef = useRef<string | null>(null);
  // **이전 렌더까지** 화면에 있던 순서 — 다음 갱신이 여기서 출발한다(아래에서 갱신).
  const displayedRef = useRef<string[]>([]);
  // 이번 렌더에서 큐가 새로 정해졌는가 — effect가 타이머를 다시 걸어야 한다는 신호.
  const rescheduleRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const targetOrder = items.map((item) => item.userId);
  const targetKey = targetOrder.join(KEY_SEP);
  // '동작 줄이기'면 중간 단계를 만들지 않는다.
  // 아직 **미확정**(ready=false)일 때도 마찬가지다 — useReduceMotion은 확정 전을 보수적으로
  // true로 읽으므로 그 값으로 시퀀스를 시작할 수는 없는데, 그렇다고 확정될 때까지 기다리면
  // 낡은 순위가 화면에 남는다. 데이터를 붙드는 쪽이 더 나쁘므로 즉시 반영을 택한다.
  // (첫 로드는 어차피 구성원이 통째로 바뀌어 큐가 만들어지지 않는다.)
  const staged = !m.reduce && m.ready;

  if (targetKey !== lastTargetRef.current) {
    lastTargetRef.current = targetKey;
    // 재생 도중 또 갱신이 오면 **큐를 쌓지 않고 갈아탄다.** 두 시퀀스가 겹치면 같은 행에
    // 서로 다른 목표가 걸려 순서가 엉킨다. 지금 화면에 그려져 있던 순서에서 새 목표까지
    // 다시 계산한다 — 살아 있는 시퀀스는 늘 하나고 최신 목표가 이긴다.
    const queue = staged ? rankSwapQueue(displayedRef.current, targetOrder) : [targetOrder];
    orderRef.current = queue.length > 1 ? queue[0] : null;
    pendingRef.current = queue.slice(1);
    rescheduleRef.current = true;
  } else if (!staged && (orderRef.current !== null || pendingRef.current.length > 0)) {
    // 재생 도중 '동작 줄이기'가 켜졌다 — 남은 단계를 버리고 최종 배열로 점프한다.
    orderRef.current = null;
    pendingRef.current = [];
    rescheduleRef.current = true;
  }

  const rendered = applyOrder(items, orderRef.current);
  displayedRef.current = rendered.map((item) => item.userId);

  useEffect(() => {
    if (!rescheduleRef.current) return;
    rescheduleRef.current = false;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    const queue = pendingRef.current;
    // 리드 프레임(자리 그대로, 값만 갱신) 뒤 LEAD, 그다음부터 GAP 간격으로 한 칸씩.
    queue.forEach((step, i) => {
      const isLast = i === queue.length - 1;
      timersRef.current.push(
        setTimeout(
          () => {
            // 마지막 단계는 order를 비운다 — 최신 배열을 그대로 통과시켜, 이후 갱신이 낡은
            // 순서에 갇히지 않게 한다(큐의 마지막 원소와 최신 배열의 순서는 같다).
            orderRef.current = isLast ? null : step;
            if (isLast) pendingRef.current = [];
            bumpFrame();
          },
          SWAP_LEAD_MS + i * SWAP_GAP_MS,
        ),
      );
    });
    // ⚠️ 정리 함수를 두지 않는다. 의존성 배열이 없어 매 렌더 정리가 돌면 방금 건 타이머가
    //    다음 렌더에서 바로 걷힌다(단계가 하나도 재생되지 않는다). 언마운트 정리는 아래 별도.
  });

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, []);

  return rendered;
}
