import React, { useEffect, useRef, useState } from 'react';
import { VideoCutscene } from '@/components/VideoCutscene';
import { t } from '@/i18n';
import { sessionGeneration } from '@/services/api/session';
import { islandErrorMessage } from '@/services/islandErrors';
import { canSwitchIsland, noIslandRoute, type State } from '@/services/model';

const ARRIVAL = require('@/assets/ota/cutscenes/arrival.mp4');

/** 연출이 끝나면 할 화면 전환. 서버 요청이 끝난 뒤에 정해진다. */
type Landing = () => void;

/**
 * 섬 사이 항해(GROMO-2261 뗏목 행선지 · GROMO-2266 망원경) — 서버 요청 → 4초 도착 영상 → 도착 처리.
 * 뗏목 행선지와 망원경이 같이 쓴다. 요청을 연출보다 먼저 끝내므로 실패는 연출 없이 바로 알리고,
 * 연출이 끝나면 화면 전환만 한다.
 *
 * - `sail(to, prepare)` 일반형 — `prepare` 가 서버 요청을 하고 «연출이 끝나면 할 일»을 돌려준다. 던지면 서버 문구로 알린다.
 * - `switchTo(island)` — 소속 섬으로 현재 섬을 옮기고(`switchCurrent`) 홈으로 간다. 뗏목 행선지의 「○○섬으로」·망원경의 [돌아가기].
 * - `sailing` — 연출 중이면 그릴 화면, 아니면 null. 호출부가 `if (sailing) return sailing` 으로 화면을 통째로 바꾼다.
 *
 * 화면이 사라졌거나 세션 세대가 바뀌었으면 응답이 와도 연출·알림·이동을 하지 않는다(ServerVisit 과 같은 가드) —
 * 서버에는 이미 반영돼 ISLAND_SYNC 가 상태를 맞추고, 로그인·딥링크 같은 다른 이동을 홈으로 덮지 않는다.
 */
export function useIslandSailing(e: any) {
  const s: State = e.state;
  const [voyage, setVoyage] = useState<{
    to: string;
    land: Landing;
    gen: ReturnType<typeof sessionGeneration>;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 이동 요청 중·항해 중 뒤로가기는 삼킨다 — 전환이 이미 방문 상태를 지워서 이전 방문 화면을
  // 복원하면 깨진 지도가 뜨고, 언마운트된 화면은 항해·홈 전환을 못 한다.
  // 정리는 «내 함수가 아직 걸려 있을 때만» 지운다 — 그 사이 다른 곳(말풍선 등)이 갈아 끼운 처리를 지우면
  // busy 가 그대로인데 삼킴이 사라진다.
  const busy = pending || voyage !== null;
  useEffect(() => {
    if (!busy || !e.backOverride) return;
    const swallow = () => true;
    e.backOverride.current = swallow;
    return () => {
      if (e.backOverride.current === swallow) e.backOverride.current = null;
    };
  }, [busy, e.backOverride]);

  const sail = async (to: string, prepare: () => Promise<Landing>) => {
    if (pendingRef.current) return;
    const gen = sessionGeneration();
    const alive = () => mounted.current && sessionGeneration() === gen;
    pendingRef.current = true;
    setPending(true);
    try {
      const land = await prepare();
      if (alive()) setVoyage({ to, land, gen });
    } catch (thrown) {
      const message = islandErrorMessage(thrown);
      if (message && alive()) e.notify(message);
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const switchTo = (island: { id: string; name: string }) => {
    // 목업은 SWITCH_ISLAND 리듀서가 거절하는 조건이면 항해를 띄우지 않는다.
    if (!e.islands && !canSwitchIsland(s, island.id)) return e.notify(t('home.raft.moveBlocked'));
    const visiting = !!s.visitingIslandId;
    return sail(island.name, async () => {
      if (e.islands) await e.islands.switchCurrent(island.id);
      else e.dispatch({ type: 'SWITCH_ISLAND', id: island.id });
      return () => {
        if (visiting) e.dispatch({ type: 'END_VISIT' });
        e.reset('home');
      };
    });
  };

  const sailing = voyage ? (
    <VideoCutscene
      source={ARRIVAL}
      accessibilityLabel={t('arrivalCutscene.label', { destination: voyage.to })}
      testID="arrival-cutscene"
      // 영상 4초 사이 로그아웃·계정 전환이 생기면 이전 세션의 도착 처리를 새 세션 위에서 하지 않고,
      // 영상 오버레이·뒤로가기 삼킴(busy)만 거둔다.
      onFinish={() => {
        if (sessionGeneration() === voyage.gen) voyage.land();
        else setVoyage(null);
      }}
    />
  ) : null;

  return { pending, busy, sail, switchTo, sailing };
}

/**
 * 구경(서버 방문 모드)만 끝낸다 — 소속 섬 이동 없이 방문 상태를 지우고 현재 섬 홈으로, 현재 섬이 없으면 섬 선택(섬을 잃었으면 먼바다)으로 간다
 * (CurrentScreens 의 endServerVisit 와 같다). 뗏목 행선지의 「구경 끝내기」(GROMO-2259)와 망원경의 «항해를 그만두고 빼기»
 * (GROMO-2273)가 같이 쓴다.
 */
export function endServerVisit(e: any) {
  e.dispatch({ type: 'END_VISIT' });
  e.reset(e.state.serverIslands?.currentIslandId ? 'home' : noIslandRoute(e.state));
}
