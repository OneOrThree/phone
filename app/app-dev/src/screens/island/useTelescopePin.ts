/**
 * 전망대에서 섬을 망원경에 넣는 흐름 (GROMO-2269) — 랭킹 행과 이름 검색 결과 행이 같이 쓴다.
 *
 * 섬을 누르면 확인창(`e.confirm`)부터 띄운다 — 훑다가 잘못 눌러 넣으면 다른 섬이 빠지기 때문이다(정본 «잡지에서 섬으로»).
 * 확인하면 `POST /me/telescope/pins { source: 'observatory' }` 를 한 번 부르고 토스트로 알린다.
 * 직접 넣은 섬이 가득 차 밀려난 섬이 있으면(`evicted`) 같은 토스트에 한 줄을 더한다. 실패는 기존 섬 오류 문구 경로로 알리고,
 * 세션이 바뀐 늦은 응답은 `request()` 가 CLIENT_STALE_SESSION(무음)으로 끊는다.
 *
 * 요청은 한 번에 하나다. 요청 중에는 `busy` 가 켜져 행을 막고, 그 사이의 누름은 확인창도 띄우지 않는다.
 */
import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { t } from '@/i18n';
import { islandTitle } from '@/i18n/format';
import { ApiError } from '@/services/api/client';
import { pinToTelescope } from '@/services/api/telescope';
import { islandErrorMessage } from '@/services/islandErrors';

export interface TelescopePin {
  /** 넣는 요청 중 — 행을 막아 중복 요청이 나가지 않게 한다. */
  busy: boolean;
  /** 확인창을 띄우고, 확인하면 망원경에 넣는다. */
  ask: (island: { id: string; name: string }) => void;
}

/**
 * 실패 문구. 강퇴 섬의 403 은 일반 권한 오류와 코드로 구분되지 않아(`FORBIDDEN`) 일반 문구로 말한다.
 * 내 소속 섬의 409(`STATE_CONFLICT`)는 "다시 시도" 안내가 틀려서 따로 말한다. 나머지는 기존 섬 오류 문구다.
 * 바다 잡지의 망원경 동그라미(GROMO-2314)도 같은 문구를 쓴다.
 */
export function pinErrorText(thrown: unknown): string {
  if (thrown instanceof ApiError) {
    if (thrown.code === 'FORBIDDEN') return t('observatory.pinForbidden');
    if (thrown.code === 'STATE_CONFLICT') return t('observatory.pinAlreadyMember');
  }
  return islandErrorMessage(thrown);
}

export function useTelescopePin(e: any): TelescopePin {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const pin = async (island: { id: string; name: string }) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await pinToTelescope(island.id, 'observatory');
      const lines = [t('observatory.pinned')];
      if (result?.evicted?.name)
        lines.push(t('observatory.pinnedEvicted', { name: islandTitle(result.evicted.name) }));
      // 화면을 떠난 뒤에 끝나도 알린다 — 서버에는 이미 들어갔다.
      e.notify(lines.join('\n'));
    } catch (thrown) {
      const message = pinErrorText(thrown);
      if (message) e.notify(message);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const ask = (island: { id: string; name: string }) => {
    if (busyRef.current) return;
    // 검색 칸의 키보드가 확인창 버튼을 가리지 않게 먼저 내린다.
    Keyboard.dismiss();
    e.confirm(
      island.name,
      t('observatory.pinBody'),
      () => {
        // 핸들러는 Promise 를 돌려주지 않는다 — 확인창 닫기가 요청을 기다리지 않게.
        pin(island);
      },
      { ok: t('observatory.pin') },
    );
  };

  return { busy, ask };
}
