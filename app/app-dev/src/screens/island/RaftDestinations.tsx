import React, { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { Group } from '@/design-system/patterns';
import { IslandSheet, SheetRow } from '@/screens/island/IslandSheet';
import { Sailing } from '@/screens/world/WorldViews';
import { islandErrorMessage } from '@/services/islandErrors';
import { currentIsland, type State } from '@/services/model';

/** 뗏목 행선지 시트(GROMO-2261) — 소속 섬 이동·낚시섬·망원경·내 뗏목. 방문 중에는 소속 섬만 보인다. */
export function RaftDestinations({ e }: { e: any }) {
  const s: State = e.state;
  const visiting = !!s.visitingIslandId;
  const [sailingTo, setSailingTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  // 이동 요청 중·항해 중 뒤로가기는 삼킨다 — 전환이 이미 방문 상태를 지워서 이전 방문 화면을
  // 복원하면 깨진 지도가 뜨고, 언마운트된 화면은 항해·홈 전환을 못 한다.
  const busy = pending || sailingTo !== null;
  useEffect(() => {
    if (!busy || !e.backOverride) return;
    e.backOverride.current = () => true;
    return () => {
      e.backOverride.current = null;
    };
  }, [busy, e.backOverride]);
  // 서버 방문 중 e.home() 은 방문 상태를 둔 채 home 으로 가 막히므로 방문 섬 지도로 돌아간다.
  const close = () => {
    if (busy) return;
    if (e.islands && visiting) e.replace('visitIsland', s.visitingIslandId);
    else e.home();
  };

  const currentId = e.islands ? s.serverIslands?.currentIslandId : currentIsland(s).id;
  const members: { id: string; name: string; arrivedBefore?: boolean }[] = e.islands
    ? (s.serverIslands?.memberships ?? [])
    : s.islands.filter((j) => j.joined);
  // 아직 도착한 적 없는 섬은 뺀다. 필드가 없는 구서버 응답은 도착한 것으로 본다.
  const destinations = members.filter(
    (m) => m.arrivedBefore !== false && (visiting || m.id !== currentId),
  );

  // 떠나기 동작은 이 함수 하나 — 가입 안내 확인창(GROMO-2259)이 이 함수를 감싼다.
  const leaveTo = async (island: { id: string; name: string }) => {
    if (pendingRef.current) return;
    // 목업은 SWITCH_ISLAND 리듀서가 거절하는 조건(진행 중 세션·전망대 미완공)이면 항해를 띄우지 않는다.
    if (
      !e.islands &&
      (s.session ||
        (s.onboarded && island.id !== currentId && !currentIsland(s).buildings.includes('tower')))
    )
      return e.notify(t('home.raft.moveBlocked'));
    pendingRef.current = true;
    setPending(true);
    try {
      if (e.islands) await e.islands.switchCurrent(island.id);
      else e.dispatch({ type: 'SWITCH_ISLAND', id: island.id });
      setSailingTo(island.name);
    } catch (thrown) {
      const message = islandErrorMessage(thrown);
      if (message) e.notify(message);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  if (sailingTo !== null)
    return (
      <Sailing
        state={s}
        from={t('home.raft.from')}
        destination={sailingTo}
        duration={1900}
        onArrive={() => {
          if (visiting) e.dispatch({ type: 'END_VISIT' });
          e.reset('home');
        }}
      />
    );

  return (
    <IslandSheet
      bg="dock"
      sign="boat/raft"
      title={t('home.raft.title')}
      onBack={close}
      onClose={close}
    >
      <Group>
        {!visiting && (
          <SheetRow
            title={t('home.raft.fishingIsland')}
            chevron
            disabled={pending}
            onPress={() => e.go('focusTravel')}
          />
        )}
        {destinations.map((m) => (
          <SheetRow
            key={m.id}
            title={t('home.raft.toIsland', { name: m.name })}
            chevron
            disabled={pending}
            onPress={() => {
              void leaveTo(m);
            }}
          />
        ))}
        {!visiting && (
          // TODO E1-4 먼바다 화면이 생기면 이 행은 바다 담당이 치운다 (임시 망원경 입구, N5)
          <SheetRow
            title={t('home.raft.telescope')}
            chevron
            disabled={pending}
            onPress={() => e.go('telescope')}
          />
        )}
        {!visiting && (
          <SheetRow
            title={t('home.raft.myRaft')}
            chevron
            disabled={pending}
            onPress={() => e.go('boat')}
          />
        )}
      </Group>
    </IslandSheet>
  );
}
