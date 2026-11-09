import { t } from '@/i18n';
import { Badge, Pic, Txt } from '@/design-system/patterns';
import { Cta, IslandSheet, Preview, st } from '@/screens/island/IslandSheet';
import { hoursMinutes, isFull, islandWeeklyAverage, residentCount } from '@/services/model';
import { View } from 'react-native';
import { AvStack } from './navigation/screenParts';
import type { ScreenContext } from './navigation/useScreenState';

export function renderVisitScreens(context: ScreenContext) {
  const {
    route,
    state,
    detail,
    visited,
    notify,
    act,
    island,
    setVisited,
    go,
    setSheetToast,
    back,
    home,
    replace,
    sheetToast,
    layout,
    now,
  } = context;

  if (route === 'visit' || route === 'approval') {
    const i =
        state.islands.find((i) => i.id === (detail || visited || state.pendingIsland)) ||
        state.islands[1],
      pending = (state.pendingIslands ?? []).includes(i.id) || state.pendingIsland === i.id;
    const sail = () => {
      if (state.session) return notify(t('ui.social.finishBeforeTravel'));
      act('TRAVEL_FROM', { name: island.name });
      setVisited(i.id);
      go('travel', i.id);
    };
    // 승인 필요 섬은 신청만 하고 같은 시트에 토스트 한 줄(승인 대기 화면 없음). 방장이 확인하면 알림
    const apply = () => {
      if (state.session) return notify(t('ui.social.finishBeforeJoin'));
      if (i.kicked) return notify(t('onboarding.kickedCannotRejoin'));
      if (isFull(i)) return notify(t('onboarding.islandFull'));
      act('JOIN', { id: i.id });
      if (i.approval) setSheetToast(t('islandVisit.visitorJoin.requested'));
      else {
        act('TRAVEL_FROM', { name: island.name });
        setVisited(i.id);
        go(state.onboarded ? 'travel' : 'arrival', i.id);
      }
    };
    return (
      <IslandSheet
        bg="tower"
        sign="bld/observatory"
        title={t('islandVisit.title')}
        tall
        onBack={back}
        onClose={state.onboarded ? home : () => replace('sea')}
        toast={sheetToast}
        footer={
          state.onboarded ? (
            // 소속 섬은 이동하고, 미가입 섬은 읽기 전용 관전 경로로 이동한다.
            <Cta
              note={pending ? t('ui.social.joinRequested') : undefined}
              title={i.joined ? t('firstVoyage.start') : t('islandVisit.browse')}
              onPress={sail}
            />
          ) : (
            // 첫 섬 고르기: 아직 내 섬이 없어 구경할 수 없으므로 여기서 가입한다
            <Cta
              title={t('ui.social.travel')}
              onPress={sail}
              ghost={
                i.joined
                  ? t('islandVisit.joined')
                  : pending
                    ? t('ui.social.cancelJoin')
                    : i.approval
                      ? t('onboarding.joinRequest')
                      : t('islandVisit.visitorJoin.join')
              }
              onGhost={
                i.joined
                  ? () => notify(t('ui.social.alreadyJoined'))
                  : pending
                    ? () => act('CANCEL_JOIN', { id: i.id })
                    : apply
              }
            />
          )
        }
      >
        {/* 가로 패널: 그림과 정보를 나란히 */}
        <View style={layout.compact ? { flexDirection: 'row', gap: 14 } : { gap: 14 }}>
          <Preview h={220} w={layout.compact ? 220 : undefined}>
            <Pic id="island/whole" w="100%" h="100%" cover />
          </Preview>
          <View style={{ flex: layout.compact ? 1 : undefined, minWidth: 0, gap: 14 }}>
            <Txt style={st.h22}>{i.name}</Txt>
            <Txt style={st.body}>{i.intro}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AvStack list={i.members.slice(0, 3).map((m) => m.color)} />
              <Txt kind="meta" style={[st.meta, { flex: 1 }]}>
                {t('ui.social.residentsAverage', {
                  v0: residentCount(i),
                  v1: hoursMinutes(islandWeeklyAverage(state, i, now)),
                })}
              </Txt>
            </View>
            <Badge soft>
              {i.approval ? t('onboarding.approvalBadge') : t('onboarding.instantJoinBadge')}
            </Badge>
          </View>
        </View>
      </IslandSheet>
    );
  }
}
