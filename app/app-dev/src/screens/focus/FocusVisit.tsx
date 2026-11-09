import { NavBtn } from '@/design-system/patterns';
import { Text } from '@/design-system/typography';
import { t } from '@/i18n';
import {
  FishingIsland,
  FishingPeerActorView,
  INK,
  OUTLINE,
  a11yHidden,
  labelBox,
} from '@/screens/focus/FishingIsland';
import {
  type FishingPeer,
  fishingSpotsForActors,
  useFishingPeerActors,
} from '@/screens/focus/useFishingPeerActors';
import { catColor, useIslandPresence } from '@/screens/focus/useIslandPresence';
import { getSession } from '@/services/api/session';
import { memberArrivedText } from '@/services/islandRealtime';
import { lookOf } from '@/services/memberAppearance';
import { State, viewIsland } from '@/services/model';
import { useAppLayout } from '@/utils/layout';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FishingCatInfo, FishingCatInfoTarget } from './FishingCatInfo';

/** 방문 낚시 구경이 주민 스냅숏(외양 포함)을 다시 읽는 간격. */
const VISIT_RESYNC_MS = 30_000;

export function FocusVisit({ e, islandId, onBack }: any) {
  const s: State = e.state,
    i = viewIsland(s, islandId ?? s.serverIslands?.currentIslandId ?? s.islandId),
    L = useAppLayout(),
    safe = useSafeAreaInsets(),
    reduce = s.settings.reduceMotion,
    close = onBack ?? e.home,
    visiting = !!islandId;
  // GROMO-2010 — 서버 모드에서는 대상 섬의 실시간 집중 멤버가 정본이다.
  // 방문 관전은 serverIslands.visit 의 섬, 내 낚시섬 관전은 현재 섬. 목업·로컬 방문은 기존 로컬 경로.
  const liveIslandId = e.islands
    ? islandId
      ? (s.serverIslands?.visit?.island.id ?? null)
      : (s.serverIslands?.currentIslandId ?? null)
    : null;
  const transitionHandler = useRef<(transition: any) => void>(() => {});
  // 방문자는 응원을 보내지도 받지도 않는다(2026-10-16 결정) — visitor 를 넘기지 않아 emotes 채널을 열지 않는다.
  // 서버의 방문자 경로(GROMO-2258)는 남아 있지만 앱이 노출하지 않는다.
  const live = useIslandPresence({
    active: liveIslandId !== null,
    islandId: liveIslandId,
    // 방문(islandId 있음)은 주민이 아니라 구독하면 ERROR 로 소켓이 닫힌다 — 내 소속 섬 보기에서만 켠다
    events: !islandId,
    onMemberArrived: (event) => e.notify(memberArrivedText(event)),
    onSendError: e.notify,
    onTransition: (transition) => transitionHandler.current(transition),
  });
  // 다른 섬 방문은 소속원이 아니라 events 토픽(member.appearance.updated)을 구독할 수 없다(서버: 소속 주민만, 아니면 ERROR+연결 종료).
  // 그래서 방문 화면은 focus-members 를 주기적으로 다시 읽어 갈아입은 외양을 반영한다.
  const resyncLive = live.resync;
  useEffect(() => {
    if (!visiting || liveIslandId === null) return;
    const id = setInterval(resyncLive, VISIT_RESYNC_MS);
    return () => clearInterval(id);
  }, [visiting, liveIslandId, resyncLive]);
  const myId = getSession()?.userId;
  const peerMembers: FishingPeer[] = liveIslandId
    ? live.focus
        .filter((m) => m.userId !== myId)
        .map((m) => ({
          userId: m.userId,
          sessionId: m.sessionId,
          name: m.name ?? t('onboarding.residentFallbackName'),
          color: catColor(m.catColor),
          subject: m.subject,
          seconds:
            m.activeSeconds +
            (m.status === 'active'
              ? Math.max(0, Math.floor((e.now + live.clockOffset - m.anchorMs) / 1000))
              : 0),
          status: m.status,
          seat: m.seat,
        }))
    : (i.members ?? [])
        .filter((member) => member.focusing)
        .map((member: any) => ({
          userId: member.id,
          sessionId: member.sessionId ?? member.id,
          name: member.name ?? t('onboarding.residentFallbackName'),
          color: member.color,
          subject: member.subject ?? null,
          seconds: member.seconds ?? 0,
          status: 'active' as const,
        }));
  const peerFlow = useFishingPeerActors({
    members: peerMembers,
    ready: liveIslandId ? live.status === 'ready' : true,
    reduce,
    realtime: liveIslandId !== null,
    snapshotVersion: live.snapshotVersion,
    snapshotTransitions: live.snapshotTransitions,
  });
  transitionHandler.current = peerFlow.onTransition;
  const peers = peerFlow.actors.filter((actor) => actor.visible);
  const spots = fishingSpotsForActors(peerFlow.actors);
  // 누른 주민 정보창(GROMO-2474) — 누른 순간의 모습을 쥔다(그 사이 자리를 떠나도 창은 그대로)
  const [catInfo, setCatInfo] = useState<FishingCatInfoTarget | null>(null);
  return (
    <View style={{ flex: 1 }}>
      <FishingIsland
        focus={{ x: 50, y: 50 }}
        spots={spots}
        onRaft={close}
        raftLabel={visiting ? t('focusFlow.common.raftLabelVisiting') : undefined}
        gram={i.buildings.includes('gram')}
        inert={!!catInfo}
      >
        {(size, sizeY, zoom) => {
          const shown = new Set<string>(),
            kept: ReturnType<typeof labelBox>[] = [];
          if (zoom >= 1)
            peers
              .map((actor) => ({
                id: actor.key,
                spot: actor.spot,
                subject: actor.subject ?? '',
              }))
              .sort((a, b) => b.spot.y - a.spot.y)
              .forEach((label) => {
                const box = labelBox(label.spot, label.subject, size, sizeY);
                if (
                  kept.some(
                    (other) =>
                      !(
                        other.right <= box.left ||
                        box.right <= other.left ||
                        other.bottom <= box.top ||
                        box.bottom <= other.top
                      ),
                  )
                )
                  return;
                kept.push(box);
                shown.add(label.id);
              });
          return peers.map((actor) => {
            const outfit = lookOf(
              live.looks,
              actor.userId,
              live.focus.find((m) => m.userId === actor.userId),
            );
            return (
              <FishingPeerActorView
                key={actor.key}
                actor={{ ...actor, subject: shown.has(actor.key) ? actor.subject : null }}
                outfit={outfit}
                size={size}
                sizeY={sizeY}
                reduce={reduce}
                onEntered={peerFlow.entered}
                onCast={peerFlow.cast}
                onPausedExit={peerFlow.leftForPause}
                onStretch={peerFlow.stretched}
                onCompletedExit={peerFlow.leftForComplete}
                onPress={() => setCatInfo({ actor, outfit })}
              />
            );
          });
        }}
      </FishingIsland>
      <View
        {...a11yHidden(!!catInfo)}
        style={{
          position: 'absolute',
          zIndex: 30,
          top: L.landscape ? Math.max(14, safe.top + 8) : Math.max(64, safe.top + 12),
          left: Math.max(18, safe.left + 8),
        }}
      >
        {/* 건물 안과 같은 ‹ 동그라미(DESIGN §7.14). 내 낚시섬은 홈(e.home), 구경은 그 섬 지도(visitMap)로 — 둘 다 섬으로 돌아간다 */}
        <NavBtn
          testID="close-focus-visit"
          label={t('focusFlow.common.backToIsland')}
          onPress={close}
        />
      </View>
      {liveIslandId && live.status === 'loading' ? (
        <View
          pointerEvents="none"
          {...a11yHidden(!!catInfo)}
          style={[
            StyleSheet.absoluteFill,
            { zIndex: 5, alignItems: 'center', justifyContent: 'center' },
          ]}
        >
          <ActivityIndicator color={INK} />
        </View>
      ) : liveIslandId && live.status === 'error' ? (
        <View
          {...a11yHidden(!!catInfo)}
          style={[
            StyleSheet.absoluteFill,
            { zIndex: 5, alignItems: 'center', justifyContent: 'center' },
          ]}
        >
          <View
            style={{
              marginHorizontal: 24,
              borderWidth: 2,
              borderColor: OUTLINE,
              borderRadius: 18,
              backgroundColor: '#FFFDFAD9',
              paddingVertical: 12,
              paddingHorizontal: 18,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 14, lineHeight: 22.4, fontWeight: '800', color: INK }}>
              {live.error?.code === 'MEMBER_ONLY'
                ? t('ui.shop.residentsUnavailable')
                : t('ui.shop.residentsFailed')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.retry')}
              onPress={live.retry}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 13, lineHeight: 20.8, fontWeight: '800', color: INK }}>
                {t('common.retry')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : !peers.length ? (
        <View
          pointerEvents="none"
          {...a11yHidden(!!catInfo)}
          style={[
            StyleSheet.absoluteFill,
            { zIndex: 5, alignItems: 'center', justifyContent: 'center' },
          ]}
        >
          <View
            style={{
              marginHorizontal: 24,
              borderWidth: 2,
              borderColor: OUTLINE,
              borderRadius: 18,
              backgroundColor: '#FFFDFAD9',
              paddingVertical: 12,
              paddingHorizontal: 18,
            }}
          >
            <Text style={{ fontSize: 14, lineHeight: 22.4, fontWeight: '800', color: INK }}>
              {t('ui.shop.noFishingResidents')}
            </Text>
          </View>
        </View>
      ) : null}
      {catInfo && <FishingCatInfo target={catInfo} onClose={() => setCatInfo(null)} />}
    </View>
  );
}
