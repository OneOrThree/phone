import { useEffect, useReducer, useRef } from 'react';
import { useMotion } from '@/hooks/useMotion';
import { rankSwapFrames, type RankSwapFrame } from './rankSwap';

// 순위 재정렬을 **한 칸씩** 재생시키는 어댑터 (GROMO-1381 / 정본 low-level-design.md §6).
//
// 서버 갱신(useLeagueRanking)은 새 순위 배열을 한 번에 갈아끼운다. 그대로 렌더하면 8위→4위
// 갱신에서 네 번의 인접 스왑이 아니라 관련 행들이 동시에 서로를 가로질러 한 번에 이동한다 —
// 정본이 요구하는 상승 "과정"이 사라진다(codex 리뷰).
//
// 늦추는 것은 순서만이 아니라 **기록도 함께**다. 정본은 "자리가 바뀌기 직전에 내 기록과 막대가
// 먼저 자란다 — 바로 위 사람을 앞지르는 값이라야 상승이 납득된다"고 못 박는다. 순서만 늦추면
// 4위 자리에 1위 기록이 붙은 채 자리만 세 번 바뀌어, 표시된 순서와 표시된 숫자가 서로 모순되는
// 프레임이 2초 가까이 남는다(codex 리뷰). 단계값 계산은 rankSwapFrames가 쥔다.
//
// ⚠️ 이 훅은 **데이터를 붙들지 않는다.** 최신 배열을 받아 순서를 다시 세우고 단계 기록만
//    덮어쓴다 — 마지막 프레임의 덮어쓰기는 비어 있어 언제나 서버 최종값으로 끝난다.
//
// ⚠️ 재생 계획을 **렌더 중에** 세운다(useEffect가 아니다). effect로 미루면 새 배열이 도착한 렌더가
//    최종 순서·최종 기록 그대로 한 번 커밋되고, 그 커밋에서 레이아웃 애니메이션이 이미 '여러 칸
//    한 번에'로 발화한다 — 되돌리는 두 번째 커밋이 뒤따라도 이 훅이 막으려던 그 이동을 이미
//    보여 준 뒤다. 렌더 중에 정하면 커밋은 한 번뿐이고 그 커밋이 곧 첫 프레임이다.

interface Keyed {
  userId: string;
  totalFocusSeconds: number;
}

/** effect 의존성이 아니라 렌더 중 비교에 쓰는 순서 키. 구분자는 userId에 없는 문자면 된다. */
const KEY_SEP = '|';

/** 화면에 그릴 순서를 최신 데이터에 입힌다. 못 입히면 null(=연출 포기). */
function reorder<T extends Keyed>(items: T[], order: string[]): T[] | null {
  if (order.length !== items.length) return null;
  const byKey = new Map(items.map((item) => [item.userId, item]));
  if (byKey.size !== items.length) return null;
  const out: T[] = [];
  for (const key of order) {
    const item = byKey.get(key);
    // 진행 중이던 순서가 새 응답의 구성원과 어긋나면 연출을 포기하고 최신 배열로 간다
    if (item === undefined) return null;
    out.push(item);
  }
  return out;
}

/** 한 프레임을 최신 데이터에 입힌다 — 순서를 세우고 단계 기록만 덮어쓴다. */
function applyFrame<T extends Keyed>(items: T[], frame: RankSwapFrame | null): T[] {
  if (frame === null) return items;
  const ordered = reorder(items, frame.order);
  if (ordered === null) return items;
  if (frame.seconds.size === 0) return ordered;
  return ordered.map((item) => {
    const staged = frame.seconds.get(item.userId);
    if (staged === undefined || staged === item.totalFocusSeconds) return item;
    // 제네릭 T를 유지하려면 스프레드 대신 Object.assign — 교차 타입이라 T에 그대로 대입된다.
    return Object.assign({}, item, { totalFocusSeconds: staged });
  });
}

export function useStagedRanking<T extends Keyed>(items: T[]): T[] {
  const m = useMotion();
  const [, bumpFrame] = useReducer((n: number) => n + 1, 0);

  // null = 재생 중이 아님(최신 배열을 그대로 그린다).
  const frameRef = useRef<RankSwapFrame | null>(null);
  // 아직 재생하지 않은 프레임들(at은 시퀀스 시작 기준 절대 시각).
  const pendingRef = useRef<RankSwapFrame[]>([]);
  const lastTargetRef = useRef<string | null>(null);
  // **이전 렌더까지** 화면에 있던 순서·기록 — 다음 갱신이 여기서 출발한다(아래에서 갱신).
  const shownOrderRef = useRef<string[]>([]);
  const shownSecondsRef = useRef<Map<string, number>>(new Map());
  // 이번 렌더에서 계획이 새로 정해졌는가 — effect가 타이머를 다시 걸어야 한다는 신호.
  const rescheduleRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const targetOrder = items.map((item) => item.userId);
  const targetKey = targetOrder.join(KEY_SEP);
  // '동작 줄이기'면 중간 단계를 만들지 않는다 — 순서도 기록도 곧장 최종값이다.
  // 아직 **미확정**(ready=false)일 때도 마찬가지다 — useReduceMotion은 확정 전을 보수적으로
  // true로 읽으므로 그 값으로 시퀀스를 시작할 수는 없는데, 그렇다고 확정될 때까지 기다리면
  // 낡은 순위가 화면에 남는다. 데이터를 붙드는 쪽이 더 나쁘므로 즉시 반영을 택한다.
  // (첫 로드는 어차피 구성원이 통째로 바뀌어 계획이 만들어지지 않는다.)
  const staged = !m.reduce && m.ready;

  if (targetKey !== lastTargetRef.current) {
    lastTargetRef.current = targetKey;
    // 재생 도중 또 갱신이 오면 **큐를 쌓지 않고 갈아탄다.** 두 시퀀스가 겹치면 같은 행에
    // 서로 다른 목표가 걸려 순서가 엉킨다. 지금 화면에 그려져 있던 순서·기록에서 새 목표까지
    // 다시 계산한다 — 살아 있는 시퀀스는 늘 하나고 최신 목표가 이긴다.
    const frames = staged
      ? rankSwapFrames(
          shownOrderRef.current,
          targetOrder,
          new Map(items.map((item) => [item.userId, item.totalFocusSeconds])),
          shownSecondsRef.current,
        )
      : [];
    frameRef.current = frames.length > 0 ? frames[0] : null;
    pendingRef.current = frames.slice(1);
    rescheduleRef.current = true;
  } else if (!staged && (frameRef.current !== null || pendingRef.current.length > 0)) {
    // 재생 도중 '동작 줄이기'가 켜졌다 — 남은 단계를 버리고 최종 순서·최종 기록으로 점프한다.
    frameRef.current = null;
    pendingRef.current = [];
    rescheduleRef.current = true;
  }

  const rendered = applyFrame(items, frameRef.current);
  shownOrderRef.current = rendered.map((item) => item.userId);
  shownSecondsRef.current = new Map(rendered.map((item) => [item.userId, item.totalFocusSeconds]));

  useEffect(() => {
    if (!rescheduleRef.current) return;
    rescheduleRef.current = false;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    const pending = pendingRef.current;
    pending.forEach((frame, i) => {
      const isLast = i === pending.length - 1;
      timersRef.current.push(
        setTimeout(() => {
          // 마지막 프레임은 계획을 비운다 — 최신 배열을 그대로 통과시켜, 이후 갱신이 낡은
          // 순서·기록에 갇히지 않게 한다(마지막 프레임의 순서·기록은 최신 배열과 같다).
          frameRef.current = isLast ? null : frame;
          if (isLast) pendingRef.current = [];
          bumpFrame();
        }, frame.at),
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
