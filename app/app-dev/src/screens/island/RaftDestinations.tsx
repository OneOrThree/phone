import React, { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import { Btn, Overlay, Txt } from '@/design-system/patterns';
import { semanticTokens } from '@/design-system/tokens';
import { RaftDestinationScene } from './RaftDestinationScene';
import { getLocale, t } from '@/i18n';
import { SheetGroup, SheetRow } from '@/screens/island/IslandSheet';
import { useIslandSailing } from '@/screens/island/useIslandSailing';
import { useVisitorJoin } from '@/screens/island/useVisitorJoin';
import { SeaDeparture } from '@/screens/sea/SeaDeparture';
import { currentIsland, serverVisit, viewIsland, type State } from '@/services/model';

/** 뗏목 이동 화면 — 바다와 집중섬, 가 본 소속 섬으로 이어진다. */
export function RaftDestinations({ e }: { e: any }) {
  const s: State = e.state;
  const visiting = !!s.visitingIslandId;
  const [membersOpen, setMembersOpen] = useState(false);
  const [departing, setDeparting] = useState(false);
  const remember = (destination: string) => e.dispatch({ type: 'RAFT_DESTINATION', destination });
  // 소속 섬 이동(요청 → 짧은 항해 연출 → 홈)은 망원경 [돌아가기]와 같은 훅이다. 요청·항해 중 뒤로가기도 거기서 삼킨다.
  const sail = useIslandSailing(e);
  const currentId = e.islands ? s.serverIslands?.currentIslandId : currentIsland(s).id;
  const members: { id: string; name: string; arrivedBefore?: boolean }[] = e.islands
    ? (s.serverIslands?.memberships ?? [])
    : s.islands.filter((j) => j.joined);
  // 아직 도착한 적 없는 섬은 뺀다. 필드가 없는 구서버 응답은 도착한 것으로 본다.
  // 별도 뒤로 버튼 대신 소속 섬 선택에서 지금 섬으로도 돌아갈 수 있다.
  const destinations = members.filter(
    (m) => m.arrivedBefore !== false || (!visiting && m.id === currentId),
  );

  // 가입하지 않은 섬을 구경하다 떠나면 가입 안내를 방문당 1번 묻는다(GROMO-2259).
  // 물었는지는 리듀서 상태(visitLeaveAsked)에 둔다 — 새 방문·구경 끝에서만 지워지고, 사이의 다른 액션에 영향받지 않는다.
  // 확인창의 [가입] 은 회관·지도 하단의 가입 버튼과 같은 함수(useVisitorJoin)를 쓴다.
  // 떠나기 동작(소속 섬 이동 sail.switchTo·구경 끝내기)은 이 확인창이 감싼다.
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

  useEffect(() => {
    if (!membersOpen || sail.busy || !e.backOverride || e.backOverride.current) return;
    const close = () => {
      setMembersOpen(false);
      return true;
    };
    e.backOverride.current = close;
    return () => {
      if (e.backOverride.current === close) e.backOverride.current = null;
    };
  }, [membersOpen, sail.busy, e.backOverride]);

  useEffect(() => {
    if (!departing || !e.backOverride) return;
    const swallow = () => true;
    e.backOverride.current = swallow;
    return () => {
      if (e.backOverride.current === swallow) e.backOverride.current = null;
    };
  }, [departing, e.backOverride]);

  if (sail.sailing) return sail.sailing;
  if (departing)
    return (
      <SeaDeparture
        onComplete={() => {
          if (visiting) e.dispatch({ type: 'END_VISIT' });
          e.reset('sea');
        }}
      />
    );

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        pointerEvents={membersOpen ? 'none' : 'auto'}
        accessibilityElementsHidden={membersOpen}
        importantForAccessibility={membersOpen ? 'no-hide-descendants' : 'auto'}
        aria-hidden={membersOpen}
      >
        <RaftDestinationScene
          visiting={visiting}
          selected={s.lastRaftDestination}
          busy={sail.busy}
          onMembers={() => setMembersOpen(true)}
          onFocus={() => {
            remember('focus');
            e.go('focusTravel');
          }}
          onSea={() =>
            confirmLeave(() => {
              remember('sea');
              setDeparting(true);
            })
          }
        />
      </View>
      {membersOpen && (
        <Modal
          transparent
          visible
          animationType={s.settings.reduceMotion ? 'none' : 'fade'}
          supportedOrientations={[
            'portrait',
            'portrait-upside-down',
            'landscape-left',
            'landscape-right',
          ]}
          onRequestClose={() => {
            if (!sail.busy) setMembersOpen(false);
          }}
        >
          <Overlay
            sheet
            close={() => {
              if (!sail.busy) setMembersOpen(false);
            }}
          >
            <View
              accessibilityViewIsModal
              role="dialog"
              aria-modal
              accessibilityLabel={t('home.raft.islandsTitle')}
            >
              <Txt kind="h22" style={{ marginBottom: semanticTokens.spacing.component }}>
                {t('home.raft.islandsTitle')}
              </Txt>
              <SheetGroup>
                {destinations.map((m) => (
                  <SheetRow
                    key={m.id}
                    title={t('home.raft.toIsland', {
                      name: getLocale() === 'ko' ? m.name.replace(/섬\s*$/, '') : m.name,
                    })}
                    sub={t('home.raft.visitedMember')}
                    selected={s.lastRaftDestination === m.id}
                    chevron
                    disabled={sail.busy}
                    onPress={() => {
                      // 가입 확인창·오류 토스트는 앱 루트에 뜬다. 네이티브 선택창을 먼저 닫아 가리지 않는다.
                      setMembersOpen(false);
                      confirmLeave(() => {
                        remember(m.id);
                        if (!visiting && m.id === currentId) e.reset('home');
                        else void sail.switchTo(m);
                      });
                    }}
                  />
                ))}
              </SheetGroup>
              {!destinations.length && <Txt kind="meta">{t('home.raft.noIslands')}</Txt>}
              <Btn
                kind="ghost"
                title={t('common.close')}
                disabled={sail.busy}
                onPress={() => setMembersOpen(false)}
              />
            </View>
          </Overlay>
        </Modal>
      )}
    </View>
  );
}
