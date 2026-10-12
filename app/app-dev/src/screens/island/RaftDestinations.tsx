import React, { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { IslandSheet, SheetGroup, SheetRow } from '@/screens/island/IslandSheet';
import { Sailing } from '@/screens/world/WorldViews';
import { islandErrorMessage } from '@/services/islandErrors';
import { sessionGeneration } from '@/services/api/session';
import { useVisitorJoin } from '@/screens/island/useVisitorJoin';
import {
  canSwitchIsland,
  currentIsland,
  serverVisit,
  viewIsland,
  type State,
} from '@/services/model';

/** 뗏목 행선지 시트(GROMO-2261) — 소속 섬 이동·낚시섬·망원경·내 뗏목. 방문 중에는 소속 섬과 구경 끝내기만 보인다. */
export function RaftDestinations({ e }: { e: any }) {
  const s: State = e.state;
  const visiting = !!s.visitingIslandId;
  const [sailingTo, setSailingTo] = useState<string | null>(null);
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
    // 목업은 SWITCH_ISLAND 리듀서가 거절하는 조건이면 항해를 띄우지 않는다.
    if (!e.islands && !canSwitchIsland(s, island.id)) return e.notify(t('home.raft.moveBlocked'));
    const gen = sessionGeneration();
    const alive = () => mounted.current && sessionGeneration() === gen;
    pendingRef.current = true;
    setPending(true);
    try {
      if (e.islands) await e.islands.switchCurrent(island.id);
      else e.dispatch({ type: 'SWITCH_ISLAND', id: island.id });
      // 화면이 사라졌거나 세션 세대가 바뀌었으면 아무것도 하지 않는다 — ServerVisit 과 같은 세대 가드.
      // 전환은 서버에 반영돼 ISLAND_SYNC 가 상태를 맞추고, 로그인·딥링크 같은 다른 이동을 홈으로 덮지 않는다.
      if (alive()) setSailingTo(island.name);
    } catch (thrown) {
      const message = islandErrorMessage(thrown);
      if (message && alive()) e.notify(message);
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  };

  // 가입하지 않은 섬을 구경하다 떠나면 가입 안내를 방문당 1번 묻는다(GROMO-2259).
  // 물었는지는 리듀서 상태(visitLeaveAsked)에 둔다 — 새 방문·구경 끝에서만 지워지고, 사이의 다른 액션에 영향받지 않는다.
  // 확인창의 [가입] 은 회관·지도 하단의 가입 버튼과 같은 함수(useVisitorJoin)를 쓴다.
  // 방문 스냅샷이 아직 없거나 다른 섬의 것인 프레임에는 가입 여부를 알 수 없으므로 확인 없이 끝낸다(의도).
  const serverVisiting = !!e.islands && visiting;
  const visit = serverVisiting ? serverVisit(s) : null;
  const visitorJoin = useVisitorJoin(
    e,
    s,
    viewIsland(s, visit?.island.id ?? s.visitingIslandId),
    e.notify,
  );
  const confirmLeave = (action: () => void) => {
    // 이미 가입 신청을 낸 사람(join === 'cancel')은 「가입하지 않고 떠나는」 사람이 아니므로 묻지 않는다.
    // membershipStatus 가 아직 'none' 인 프레임에도 확인창의 「취소」가 하단 「신청 취소」와 헷갈리지 않게 한다.
    if (
      visit &&
      visit.island.membershipStatus === 'none' &&
      visitorJoin.join !== 'cancel' &&
      !s.visitLeaveAsked
    ) {
      e.dispatch({ type: 'VISIT_LEAVE_ASKED' });
      // 가입할 수 있는 섬이면 취소 자리에 가입 버튼을 둬 떠나는 순간 한 번에 가입하게 한다.
      // 즉시 가입이면 훅이 구경을 끝내고 홈으로 보내므로 떠나기 동작(action)은 돌리지 않는다.
      // 정원이 찼거나 막혔으면 기본 「취소」다.
      const canJoin = !visitorJoin.disabled;
      e.confirm(
        t('islandVisit.leaveWithoutJoinTitle'),
        t('islandVisit.leaveWithoutJoinBody'),
        action,
        {
          ok: t('islandVisit.leaveWithoutJoinLeave'),
          ...(canJoin && {
            cancel: visitorJoin.label,
            onCancel: () => void visitorJoin.serverJoin(),
          }),
        },
      );
      return;
    }
    action();
  };
  // 소속 섬 이동 없이 구경만 끝낸다 — CurrentScreens 의 endServerVisit 와 같다(소속 섬이 없으면 섬 선택으로).
  const endVisit = () => {
    e.dispatch({ type: 'END_VISIT' });
    e.reset(s.serverIslands?.currentIslandId ? 'home' : 'chooseIsland');
  };

  // 출발지 = 방문 중이면 방문 섬, 아니면 현재 섬 이름(이름을 못 얻으면 「우리 섬」).
  const from =
    (visiting
      ? (s.serverIslands?.visit?.island.name ?? viewIsland(s, s.visitingIslandId)?.name)
      : e.islands
        ? s.serverIslands?.memberships.find((m) => m.id === currentId)?.name
        : currentIsland(s).name) ?? t('home.raft.from');

  if (sailingTo !== null)
    return (
      <Sailing
        state={s}
        from={from}
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
      <SheetGroup>
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
            onPress={() => confirmLeave(() => void leaveTo(m))}
          />
        ))}
        {serverVisiting && (
          // 이동할 소속 섬이 없어도(온보딩 중 구경 등) 구경을 끝낼 길이 남도록 방문 중에는 항상 둔다.
          // TODO E1-4 먼바다로 행선지가 생기면 이 행을 대체한다
          <SheetRow
            title={t('home.raft.endVisit')}
            chevron
            disabled={pending}
            onPress={() => confirmLeave(endVisit)}
          />
        )}
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
      </SheetGroup>
    </IslandSheet>
  );
}
