import { Btn, Overlay, Txt } from '@/design-system/patterns';
import { semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import { FriendActionContext } from '@/screens/island/CatInfoPopup';
import { BuildingCompletionGuide, BuildingGuide, GuideBox } from '@/screens/island/NpcGuide';
import { useAccountGuides } from '@/screens/island/useAccountGuides';
import { useConstructionAnnouncements } from '@/screens/island/useConstructionAnnouncements';
import { useFriendsScreen, type FriendsScreenState } from '@/screens/island/useFriendsScreen';
import { getSession, sessionGeneration } from '@/services/api/session';
import { Building, Color, Route, dayKey } from '@/services/model';
import { captureProductEvent } from '@/services/posthog';
import { useEffect, useRef, useState } from 'react';
import { Modal, View } from 'react-native';
import { CurrentScreensContent } from './navigation/CurrentScreenRouter';
import { memberGate } from './navigation/routePolicies';

export function CurrentScreens({ e }: ScreenProps) {
  const friendsRouteActive = e.route === 'friends' || e.route === 'friendSearch';
  // 바다 표류 HUD(GROMO-2404)도 홈처럼 요청 배지를 보여 같은 freshness 경계에 둔다
  const friendsSafetyRouteActive =
    friendsRouteActive || e.route === 'boat' || e.route === 'home' || e.route === 'sea';
  const serverIslands = e.islands;
  const dispatch = e.dispatch;
  const friendsScreen = useFriendsScreen({
    // 공용 소비자(뗏목 배지·우체통)가 첫 진입부터 서버 친구를 쓰도록 화면 route와 무관하게 적재한다.
    active: !!serverIslands,
    // 친구 화면과 요청 배지를 노출하는 뗏목 진입은, 공용 소비자가 계속 활성이어도
    // 차단 목록을 다시 검증하는 freshness boundary다.
    routeActive: friendsSafetyRouteActive,
    routeKey: friendsSafetyRouteActive ? e.route : null,
    searchActive: friendsRouteActive,
    date: dayKey(e.now),
  });
  useEffect(() => {
    if (!serverIslands) return;
    const friends = friendsSnapshotForSync(friendsScreen.data);
    // 차단 목록 재검증 중 data=null은 공개 보류이지 관계 삭제가 아니다. 빈 snapshot을
    // reducer에 넣으면 기존 친구의 로컬 편지 기록까지 영구 삭제되므로 보존한다.
    if (friends) dispatch({ type: 'FRIENDS_SYNC', friends });
  }, [dispatch, friendsScreen.data, serverIslands]);

  const owner =
    serverIslands && e.accountDataReady !== false ? (getSession()?.userId ?? null) : null;
  const guides = useAccountGuides(owner, e.state, dispatch);
  useEffect(() => {
    if (guides.data?.focusDone && e.route === 'guide') e.reset('home');
  }, [guides.data?.focusDone, e.route, e.reset]);
  const { joined, built } = memberGate(e.state, !!serverIslands);
  const islandId = e.state.serverIslands?.currentIslandId ?? null;
  const announcements = useConstructionAnnouncements(
    owner,
    islandId,
    built?.join(',') ?? '',
    !!owner &&
      joined &&
      !e.state.visitingIslandId &&
      !e.state.session &&
      e.route === 'home' &&
      (!e.state.tutorial || e.state.tutorial.step >= 22),
  );
  const completion =
    guides.data &&
    announcements.find((b) => !guides.data!.completions.includes(`${islandId}:${b}`));
  // construction_completed 는 완공 안내를 "확인(ack)"하는 순간에만 발행한다(아래 onDone).
  // 안내가 뜨는 시점이 아니라 영속 저장(guides.done)되는 ack 시점에 쏴야, 확인 전 강제 종료 후
  // 재실행해도 같은 완공이 중복 발행되지 않는다. Set 은 같은 세션 안 재시도의 이중 발행만 막는다.
  const announcedCompletions = useRef<Set<string>>(new Set());
  const routeBuildings: Partial<Record<Route, Building>> = {
    hall: 'hall',
    board: 'board',
    sound: 'gram',
    library: 'library',
    mail: 'mail',
    tower: 'tower',
    shop: 'shop',
  };
  // 건물 내부는 안내가 끝날 때까지 마운트하지 않는다. 고양이의 도착 요청만 보관한다.
  const generation = sessionGeneration();
  const [entry, setEntry] = useState<{
    owner: string;
    generation: number;
    islandId: string | null;
    building: Building;
    route: Route;
    args: any[];
  } | null>(null);
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const eligible =
    !!owner && joined && !e.state.visitingIslandId && !e.state.session && e.route === 'home';
  const pending =
    eligible &&
    entry?.owner === owner &&
    entry.generation === generation &&
    entry.islandId === islandId &&
    built?.includes(entry.building)
      ? entry
      : null;
  useEffect(() => {
    if (entry && !pending) {
      entryRef.current = null;
      setEntry(null);
    }
  }, [entry, pending]);
  useEffect(() => {
    if (!pending || !guides.data?.buildings.includes(pending.building)) return;
    // 저장 성공 후에만 진입한다. 섬·계정이 바뀐 요청은 위에서 폐기한다.
    if (entryRef.current !== pending || sessionGeneration() !== pending.generation) return;
    entryRef.current = null;
    setEntry(null);
    e.go(pending.route, ...pending.args);
  }, [pending, guides.data, e.go]);
  const go = (route: Route, ...args: any[]) => {
    const building = routeBuildings[route];
    if (eligible && building && built?.includes(building)) {
      if (entryRef.current) return false;
      if (!guides.data || !guides.data.buildings.includes(building)) {
        const next = { owner: owner!, generation, islandId, building, route, args };
        entryRef.current = next;
        setEntry(next);
        return false;
      }
    }
    return e.go(route, ...args);
  };
  const cancelEntry = () => {
    entryRef.current = null;
    setEntry(null);
  };
  if (
    owner &&
    !guides.data &&
    (e.route === 'guide' || (e.route === 'home' && e.state.tutorial && e.state.tutorial.step < 22))
  )
    return (
      <Overlay close={e.home}>
        <Txt>{guides.error || '안내 이력을 확인하고 있어요.'}</Txt>
        {!!guides.error && <Btn title="다시 시도" onPress={guides.retry} />}
      </Overlay>
    );
  if (owner && guides.data?.focusDone && e.route === 'guide') return null;
  return (
    <>
      {/* 다른 고양이 정보창(GROMO-2474)의 친구 행동 — 친구 관리와 같은 서버 상태, 목업은 로컬 친구 목록 */}
      <FriendActionContext.Provider
        value={{
          friendsScreen: serverIslands ? friendsScreen : null,
          conversion: e.conversion,
          friends: e.state.friends,
          dispatch,
        }}
      >
        <CurrentScreensContent e={{ ...e, go, friendsScreen }} />
      </FriendActionContext.Provider>
      {pending && !guides.data && (
        <Modal
          transparent
          animationType="none"
          testID="building-entry-pending"
          onRequestClose={cancelEntry}
        >
          <View style={{ flex: 1, justifyContent: 'center', padding: semanticTokens.spacing.page }}>
            <GuideBox
              text={guides.error || '안내 이력을 확인하고 있어요.'}
              style={{ position: 'relative' }}
            >
              {!!guides.error && <Btn title="다시 시도" onPress={guides.retry} />}
              <Btn title={t('common.close')} kind="sec" onPress={cancelEntry} />
            </GuideBox>
          </View>
        </Modal>
      )}
      {completion && (
        <BuildingCompletionGuide
          key={`${owner}:${islandId}:${completion}`}
          building={completion}
          blocked={e.routeTransitionShielded}
          saving={guides.saving}
          error={guides.error}
          onDone={() => {
            const completionKey = `${islandId}:${completion}`; // 영속 저장 키(계정별 guides)
            // 확인(ack)으로 완공 이력을 영속 저장하는 순간 1회 — 재시작 후에도 중복 없음.
            // 세션 내 중복 방지 키엔 owner 를 포함한다 — 같은 기기에서 계정이 바뀌어도(CurrentScreens 유지)
            // 다른 계정의 정상 완공 확인을 억제하지 않게.
            const dedupKey = `${owner}:${completionKey}`;
            if (!announcedCompletions.current.has(dedupKey)) {
              announcedCompletions.current.add(dedupKey);
              captureProductEvent('construction_completed', { building_id: completion });
            }
            void guides.done({ completions: [completionKey] });
          }}
        />
      )}
      {pending &&
        guides.data &&
        !completion &&
        !guides.data.buildings.includes(pending.building) && (
          <BuildingGuide
            key={`${owner}:${islandId}:${pending.building}`}
            building={pending.building}
            blocked={e.routeTransitionShielded}
            saving={guides.saving}
            error={guides.error}
            onDone={() => void guides.done({ buildings: [pending.building] })}
          />
        )}
    </>
  );
}

export function friendsSnapshotForSync(data: FriendsScreenState['data']) {
  if (!data) return null;
  const toFriend = (
    userId: string,
    nickname: string | null,
    islandName: string | null | undefined,
    status: 'friend' | 'received' | 'sent',
  ) => ({
    id: userId,
    name: nickname ?? '탈퇴한 사용자',
    color: 'white' as Color,
    island: islandName ?? '',
    status,
    messages: [],
  });
  return [
    ...data.friends.map((friend) =>
      toFriend(friend.userId, friend.nickname, friend.mainIslandName, 'friend'),
    ),
    ...data.friendRequests.map((request) =>
      toFriend(request.userId, request.nickname, null, 'received'),
    ),
    ...data.sentFriendRequests.map((request) =>
      toFriend(request.userId, request.nickname, null, 'sent'),
    ),
  ];
}
