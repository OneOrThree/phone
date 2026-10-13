/**
 * 오늘 호 머리와 받음 상태(GROMO-2289 · 구현계획 5-6) — 섬 홈(펠리컨 배달·우체통 빨간 점)·우체통(잡지 보기 버튼)·잡지가 함께 쓴다.
 *
 * - 앱 상태 저장소에 넣지 않고 모듈 캐시 하나를 둔다. 받음 기록을 보내면(`sendReceipt`) 캐시를 고치고 구독자에게 알린다
 *   (망원경 `onTelescopeChanged` 와 같은 방식) — 잡지를 펼치면 우체통 빨간 점이 바로 꺼진다.
 * - 화면이 보일 때(`active`)와 앱이 다시 앞으로 나올 때 `GET /me/magazine/today` 를 다시 읽는다. 실패하면 보던 값을 그대로 둔다
 *   (서버에 잡지가 아직 없거나 꺼져 있으면 아무것도 띄우지 않는다).
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { sessionGeneration } from '@/services/api/session';
import type { MagazineReceipt, MagazineToday, ReceiptUpdate } from '@/services/api/magazine';
import { magazineApi } from './usePromotionEditor';

let cache: MagazineToday | null = null;
let cacheSession = -1;
const listeners = new Set<() => void>();

/** 잡지 받음 상태가 바뀌면 불릴 구독자를 등록하고 해제 함수를 돌려준다. */
export function onMagazineChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: MagazineToday | null) {
  cache = next;
  cacheSession = sessionGeneration();
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // 구독자 하나의 실패가 다른 구독자를 막지 않는다
    }
  });
}

/** 지금 들고 있는 오늘 호 — 다른 세션(로그아웃·계정 전환)에서 읽은 값은 버린다. */
export const cachedMagazineToday = () => (cacheSession === sessionGeneration() ? cache : null);

/**
 * 받음·나중에·읽음을 보내고 성공하면 캐시(오늘 호면)를 고쳐 홈·우체통·꽂이에 알린다. 보내는 사이 세션이 바뀌었으면(로그아웃·계정 전환)
 * 호 id 가 같아도 다른 사람의 기록이라 캐시에 넣지 않는다.
 */
export async function sendReceipt(
  issueId: string,
  update: ReceiptUpdate,
): Promise<MagazineReceipt> {
  const session = sessionGeneration();
  const receipt = await magazineApi().putMagazineReceipt(issueId, update);
  if (session !== sessionGeneration()) return receipt;
  const today = cachedMagazineToday();
  publish(today?.issue?.issueId === issueId ? { ...today, receipt } : today);
  return receipt;
}

/** 이번 세션에 펠리컨으로 알린 호 — 받음 기록이 실패해도 홈에 다시 들어올 때마다 또 띄우지 않는다(앱을 다시 켜면 다시 알린다). */
let delivered: { session: number; issues: Set<string> } = { session: -1, issues: new Set() };
export function wasDelivered(issueId: string): boolean {
  return delivered.session === sessionGeneration() && delivered.issues.has(issueId);
}
export function markDelivered(issueId: string) {
  if (delivered.session !== sessionGeneration())
    delivered = { session: sessionGeneration(), issues: new Set() };
  delivered.issues.add(issueId);
}

/** 테스트에서 모듈 캐시를 비운다. */
export function resetMagazineToday() {
  cache = null;
  cacheSession = -1;
  delivered = { session: -1, issues: new Set() };
}

export function useMagazineToday(active: boolean): {
  today: MagazineToday | null;
  reload: () => void;
} {
  const [, rerender] = useState(0);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => onMagazineChanged(() => rerender((n) => n + 1)), []);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const session = sessionGeneration();
    magazineApi()
      .getMagazineToday()
      .then((next) => {
        if (alive && session === sessionGeneration()) publish(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [active, nonce]);
  useEffect(() => {
    if (!active) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') reload();
    });
    return () => sub.remove();
  }, [active, reload]);

  return { today: cachedMagazineToday(), reload };
}

/** 안 읽은 오늘 호가 있나 — 우체통 빨간 점·잡지 보기 버튼 점. */
export const magazineUnread = (today: MagazineToday | null) =>
  !!today?.issue?.current && !today.receipt?.openedAt;
