import { Platform } from 'react-native';
import { Btn, Overlay, Pic, Txt } from '@/design-system/patterns';
import { getLocale, t } from '@/i18n';
import { josa } from '@/i18n/format';
import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import { InteriorRoute } from '@/screens/interiors/BuildingInteriors';
import { BlockedUsersScreen } from '@/screens/island/BlockedUsersScreen';
import { DeveloperNoticesScreen } from '@/screens/island/DeveloperNoticesScreen';
import { Hall } from '@/screens/island/Hall';
import { HOME_QUEST_LIST_DETAIL, pendingQuestRewards } from '@/screens/island/HomeQuestIndicator';
import { IslandChatSheet } from '@/screens/island/IslandChatSheet';
import { Library } from '@/screens/island/Library';
import { RaftDestinations } from '@/screens/island/RaftDestinations';
import { RedesignScreens } from '@/screens/island/Screens';
import { Telescope } from '@/screens/island/Telescope';
import { VisitorBoard } from '@/screens/island/VisitorBoard';
import { FinalIsland } from '@/screens/island/WorldMap';
import { useBoardHomeIndicator } from '@/screens/island/useBoardHomeIndicator';
import { useIslandChat } from '@/screens/island/useIslandChat';
import { MagazineReader } from '@/screens/magazine/MagazineReader';
import { PromotionEditor } from '@/screens/magazine/PromotionEditor';
import { useMagazineToday } from '@/screens/magazine/useMagazineToday';
import { usePromotionNewsToast } from '@/screens/magazine/usePromotionNewsToast';
import { SeaVoyageHost } from '@/screens/sea/SeaVoyageHost';
import { seaAssets } from '@/screens/sea/seaAssets';
import { Sailing } from '@/screens/world/WorldViews';
import { mockFlags } from '@/services/api/magazineMock';
import { getSession } from '@/services/api/session';
import { isMockMode } from '@/services/demoMode';
import {
  Building,
  Route,
  SERVER_VISIT_ROUTES,
  State,
  buildingNames,
  canVisit,
  displayIsland as currentIsland,
  serverHome,
} from '@/services/model';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { FocusFlow } from '../../focus/FocusFlow';
import { FocusVisit } from '../../focus/FocusVisit';
import { RewardModal } from '../../focus/RewardModal';
import { AppPermissionManager } from '../../permissions/AppPermissionManager';
import { MeasuredAppPicker } from '../../permissions/MeasuredAppPicker';
import { ScreenTimePermission } from '../../permissions/ScreenTimePermission';
import { VisitIsland } from '../VisitIsland';
import { everySecond } from './ScreenClock';
import { memberGate } from './routePolicies';

const buildingArt: Record<Building, string> = {
  hall: 'hall',
  board: 'notice-board',
  gram: 'gramophone',
  library: 'library',
  mail: 'mailbox',
  tower: 'observatory',
  shop: 'shop',
};

export function CurrentScreensContent({ e }: ScreenProps) {
  const state: State = e.state,
    i = currentIsland(state),
    r: Route = e.route;
  const [boardReadVersion, setBoardReadVersion] = useState(0);
  const boardBuilt = memberGate(state, !!e.islands).built;
  const boardStatus = useBoardHomeIndicator({
    active:
      !!e.islands &&
      !state.visitingIslandId &&
      !!boardBuilt?.includes('board') &&
      ['home', 'board', 'notice'].includes(r),
    ownerId: getSession()?.userId ?? null,
    islandId: state.serverIslands?.currentIslandId ?? i.id,
    markRead: ['board', 'notice'].includes(r),
    readVersion: boardReadVersion,
  });
  // 우리 섬 채팅방(GROMO-2499) — 우체통 밖으로 꺼냈다. 서버 모드의 내 섬에서만 읽고, 구경 중에는 부르지 않는다.
  // 홈 왼쪽 아래 최근 채팅 줄(GROMO-2501)도 같은 훅을 써서 홈 ↔ 채팅방을 오갈 때 다시 불러오지 않는다
  const islandChat = useIslandChat({
    islandId:
      e.islands && !state.visitingIslandId ? (state.serverIslands?.currentIslandId ?? null) : null,
    active: r === 'chat' || r === 'home',
  });
  const rewardIslandId = r === 'quest' && e.detail === HOME_QUEST_LIST_DETAIL ? i.id : undefined;
  const rewardModalOpen =
    !state.visitingIslandId && pendingQuestRewards(state.rewards, rewardIslandId).length > 0;
  const screenE = {
    ...e,
    boardStatus,
    onBoardCommentRead: () => setBoardReadVersion((version) => version + 1),
  };
  const memberRoutes: Route[] = [
    'home',
    'guide',
    'focusVisit',
    'focusTravel',
    'fishingArrival',
    'focusSetup',
    'focus',
    'rest',
    'focusResult',
    'returnTravel',
    'hall',
    'manage',
    'members',
    'ledger',
    'construction',
    'board',
    'notice',
    'noticeEdit',
    'quest',
    'questEdit',
    'tower',
    'explore',
    'library',
    'diary',
    'stats',
    'mail',
    'chat',
    'friendMail',
    'shop',
    'product',
    'orders',
    'sound',
    'promotionEditor',
  ];
  const { joined, built, host } = memberGate(state, !!e.islands);
  // 주민 소식 토스트(C3) — 내 섬 홈에 들어올 때, 섬장이 아닌 주민에게만(목업 QA 는 EXPO_PUBLIC_MAGAZINE_MOCK=member).
  // 서버 홈 스냅샷이 오기 전에는 host 가 undefined 라 섬장인지 모른다 — 주민으로 확인된(false) 뒤에만 읽는다
  usePromotionNewsToast({
    active:
      r === 'home' &&
      joined &&
      !state.visitingIslandId &&
      (host === false || (isMockMode() && mockFlags().has('member'))),
    islandId: e.islands ? (state.serverIslands?.currentIslandId ?? null) : i.id,
    notify: e.notify,
  });
  // 오늘 고양이 잡지(GROMO-2289) — 섬 홈(펠리컨 배달·우체통 빨간 점)과 우체통(잡지 보기 버튼)이 같이 본다. 구경 중에는 읽지 않는다.
  // 먼바다(GROMO-2314)도 표류 중 펠리컨·뗏목 옆 잡지 물건에 쓴다
  const magazine = useMagazineToday(
    (['home', 'mail'].includes(r) && !state.visitingIslandId) || r === 'sea',
  );
  const endServerVisit = () => {
    e.dispatch({ type: 'END_VISIT' });
    e.reset(state.serverIslands?.currentIslandId ? 'home' : 'sea');
  };
  const visitMap = () => e.replace('visitIsland', state.visitingIslandId ?? undefined);
  const closeFacility = e.islands && state.visitingIslandId ? visitMap : e.home;
  // 바다 항해 집중(GROMO-2310) — 섬 소속·구경 여부와 무관한 바다 화면이라 아래 섬 관문보다 먼저 연다.
  // 계정이 바뀌면 사용자 ID 를 key 로 화면(바다 방 연결 포함)을 새로 만든다.
  if (r === 'sea' || r === 'seaArrival')
    return everySecond({ ...e, magazineToday: magazine.today }, (timed) => (
      <SeaVoyageHost key={getSession()?.userId ?? ''} e={timed} />
    ));
  // 바다에서 펼친 오늘 호(GROMO-2314) — 배경은 먼바다, 칸에 망원경 동그라미. 소속 섬이 없어도 열린다
  if (r === 'seaMagazine')
    return (
      <MagazineReader
        key={e.detail}
        e={e}
        place="SEA"
        background={
          <Image
            testID="sea-magazine-background"
            source={seaAssets.background}
            resizeMode="cover"
            style={StyleSheet.absoluteFill}
          />
        }
      />
    );
  // 섬 없음 안내는 회색 단색 대신 바다 장면 위에 띄운다(GROMO-2412). 버튼이 갈 곳을 말하니 부연 문장은 두지 않는다
  if (!joined && !state.visitingIslandId && memberRoutes.includes(r))
    return (
      <Overlay
        close={() => e.reset('sea')}
        background={
          <Image
            testID="no-island-background"
            source={seaAssets.background}
            resizeMode="cover"
            style={noIslandScene.fill}
          />
        }
      >
        <Txt kind="h17">가입한 섬이 없어요</Txt>
        <Btn title="바다로 가기" onPress={() => e.reset('sea')} />
      </Overlay>
    );
  // 구경 중에는 구경하는 섬의 홈·회관 정보·게시판 열람과 돌아가는 배만 연다(허용 목록).
  // 나머지는 내 섬 화면이 섞이거나 섬 상태가 꼬이지 않게 모두 막는다
  if (
    state.visitingIslandId &&
    !(
      e.islands
        ? SERVER_VISIT_ROUTES
        : [
            'home',
            'manage',
            'members',
            'board',
            'notice',
            'quest',
            'travel',
            'visitIsland',
            'visitIslandFocus',
            'raft',
            'permission',
            'screenTimeApps',
          ]
    ).includes(r)
  )
    return (
      <Overlay
        close={closeFacility}
        background={
          <FinalIsland
            state={state}
            go={e.go}
            build={e.build}
            showActions={false}
            boardStatus={boardStatus}
          />
        }
      >
        <Txt kind="h17">주민만 이용할 수 있어요</Txt>
        <Btn title="확인" onPress={closeFacility} />
      </Overlay>
    );
  if (e.islands && state.visitingIslandId && !built)
    return (
      <Overlay close={endServerVisit}>
        <Txt>섬 모습을 불러오지 못했어요. 다시 방문해 주세요.</Txt>
        <Btn title="원래 섬으로" onPress={endServerVisit} />
      </Overlay>
    );
  const locked: Partial<Record<Route, Building>> = {
    library: 'library',
    diary: 'library',
    stats: 'library',
    hall: 'hall',
    manage: 'hall',
    members: 'hall',
    ledger: 'hall',
    construction: 'hall',
    board: 'board',
    quest: 'board',
    questEdit: 'board',
    notice: 'board',
    noticeEdit: 'board',
    tower: 'tower',
    explore: 'tower',
    mail: 'mail',
    friendMail: 'mail',
    shop: 'shop',
    product: 'shop',
    orders: 'shop',
    sound: 'gram',
  };
  const required = locked[r];
  if (required && e.islands && !state.visitingIslandId && !serverHome(state))
    return (
      <Overlay close={e.home}>
        <Txt>{e.homeError ? '시설 정보를 불러오지 못했어요' : '시설 정보를 확인하고 있어요.'}</Txt>
        {e.homeError && <Btn title="다시 시도" onPress={e.retryHome} />}
      </Overlay>
    );
  if (required && built && !built.includes(required))
    return (
      <Overlay
        close={closeFacility}
        background={
          <FinalIsland
            state={state}
            go={e.go}
            build={e.build}
            showActions={false}
            boardStatus={boardStatus}
          />
        }
      >
        <Pic id={`bld/${buildingArt[required]}`} w={100} />
        <Txt kind="h17">
          {t('home.lock.missing', {
            // 한국어는 건물명 받침에 맞춰 이/가(전망대가·축음기가). 영어 단어에는 조사를 붙이지 않는다
            building:
              getLocale() === 'ko'
                ? josa(buildingNames[required], '이', '가')
                : buildingNames[required],
          })}
        </Txt>
        <Txt kind="meta">
          {required === 'library' ? t('home.lock.libraryLocked') : t('home.lock.lockedGeneric')}
        </Txt>
        <Btn
          title={host && built.includes('hall') ? t('home.lock.viewNext') : t('common.ok')}
          onPress={() => (host && built.includes('hall') ? e.go('construction') : closeFacility())}
        />
      </Overlay>
    );
  if (e.islands && state.visitingIslandId && ['board', 'notice'].includes(r)) {
    const islandId = state.visitingIslandId;
    return (
      <VisitorBoard
        key={islandId}
        islandId={islandId}
        backOverride={e.backOverride}
        onClose={visitMap}
        e={e}
      />
    );
  }
  if (r === 'visit') return <Visit e={e} />;
  if (['arrival', 'travel'].includes(r)) return <Travel e={e} />;
  if (r === 'focusVisit') return everySecond(e, (timed) => <FocusVisit e={timed} />);
  if (r === 'visitIsland')
    return <VisitIsland e={screenE} onReturnFromVisit={e.islands ? endServerVisit : undefined} />;
  if (r === 'visitIslandFocus')
    return everySecond(e, (timed) => (
      <FocusVisit
        e={timed}
        islandId={e.detail || state.visitingIslandId}
        onBack={e.islands ? visitMap : e.back}
      />
    ));
  if (
    [
      'focusTravel',
      'fishingArrival',
      'focusSetup',
      'focus',
      'focusResult',
      'returnTravel',
      'rest',
    ].includes(r)
  )
    // 항해 연출·모닥불 휴식은 FocusFlow 가 시간을 쓰지 않는다(휴식 시간 글자는 RestGroup 이 스스로 센다)
    return everySecond(
      e,
      (timed) => <FocusFlow e={timed} />,
      ['focusTravel', 'returnTravel', 'rest'].includes(r) ? null : 1000,
    );
  if (['library', 'diary', 'stats'].includes(r)) return <Library e={e} />;
  // 회관은 공사 화면만 초 단위(남은 시간·완공 확인 재조회)다
  if (['hall', 'manage', 'members', 'ledger', 'construction'].includes(r))
    return everySecond(
      e,
      (timed) => (
        <Hall
          key={r}
          e={
            e.islands && state.visitingIslandId
              ? { ...timed, back: visitMap, home: visitMap }
              : timed
          }
        />
      ),
      r === 'construction' ? 1000 : null,
    );
  // 게시판·우체통은 건물 안 장면(BuildingInteriors)으로 그린다. 게시판은 진행 중 집중 달성률·공사 진행률·완공 확인이 초 단위다
  if (['board', 'notice', 'noticeEdit', 'quest', 'questEdit'].includes(r))
    return (
      <>
        {everySecond(screenE, (timed) => (
          <InteriorRoute e={timed} modalAboveBoard={rewardModalOpen} />
        ))}
        {/* 보상은 내 섬 퀘스트 몫이라 구경 중에는 띄우지 않는다 */}
        {!state.visitingIslandId && <RewardModal e={e} rewardIslandId={rewardIslandId} />}
      </>
    );
  if (['mail', 'friendMail'].includes(r))
    return <InteriorRoute e={{ ...e, magazineToday: magazine.today }} />;
  // 우리 섬 채팅방 — 우체통이 없어도 섬 홈 위 시트로 연다(GROMO-2499). 뒤 섬 홈은 스크린리더에서 숨긴다
  if (r === 'chat')
    return (
      <>
        <View
          style={StyleSheet.absoluteFill}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <FinalIsland
            state={state}
            go={e.go}
            build={e.build}
            showActions={false}
            boardStatus={boardStatus}
          />
        </View>
        <IslandChatSheet e={e} chat={islandChat} />
      </>
    );
  if (['tower', 'explore'].includes(r)) return <Tower e={e} />;
  if (r === 'raft') return <RaftDestinations e={e} />;
  if (r === 'telescope') return <Telescope e={e} />;
  if (r === 'promotionEditor') return <PromotionEditor e={e} />;
  // 섬에서 펼친 잡지 — 배경은 섬 홈(A4). 끝 쪽 「우리 섬도 실어 볼까요?」 안내는 내 섬 섬장만(쓰기 입구는 마을회관)
  if (r === 'magazine')
    return (
      <MagazineReader
        key={e.detail}
        e={e}
        host={host && !state.visitingIslandId}
        background={
          <FinalIsland
            state={state}
            go={e.go}
            build={e.build}
            showActions={false}
            boardStatus={boardStatus}
          />
        }
      />
    );
  if (['boat', 'mainIsland', 'currentIsland', 'friends', 'friendSearch'].includes(r))
    return <Social e={e} />;
  if (['shop', 'product', 'orders', 'sound'].includes(r)) return <ShopMusic e={e} />;
  if (r === 'permission')
    return e.detail === 'settings' ? (
      <AppPermissionManager e={e} />
    ) : (
      <ScreenTimePermission e={e} />
    );
  if (r === 'screenTimeApps')
    return Platform.OS === 'ios' ? <ScreenTimePermission e={e} /> : <MeasuredAppPicker e={e} />;
  if (r === 'developerNotices' || r === 'developerNotice') return <DeveloperNoticesScreen e={e} />;
  if (r === 'blockedUsers' && e.islands) return <BlockedUsersScreen e={e} />;
  return <RedesignScreens e={{ ...screenE, magazineToday: magazine.today, islandChat }} />;
}

// 섬 구경 · 전망대 · 상점 · 축음기 · 내 뗏목(친구·꾸미기)은 v2 시트 구현(Screens.tsx)이 그린다
function Visit({ e }: ScreenProps) {
  return <RedesignScreens e={e} />;
}

function Travel({ e }: ScreenProps) {
  const s: State = e.state;
  const first = e.route === 'arrival';
  const target = first
    ? currentIsland(s)
    : (s.islands.find((j) => j.id === (e.detail || e.visited)) ?? currentIsland(s));
  return (
    <Sailing
      state={s}
      from={first ? t('focusFlow.common.myLittleBoat') : (s.travelOrigin ?? currentIsland(s).name)}
      destination={target.name}
      duration={1900}
      onArrive={() => {
        if (first) {
          e.setGuideStep(0);
          e.replace('guide');
        } else if (target.joined) {
          e.dispatch({ type: 'SWITCH_ISLAND', id: target.id });
          e.home();
        } else if (canVisit(s, target.id)) {
          // 기존 방문자 권한(회관 정보·게시판 열람)을 유지한 채 읽기 전용 메인 섬 경로로 연다.
          e.dispatch({ type: 'VISIT', id: target.id });
          e.replace('visitIsland', target.id);
        } else e.replace('visit', target.id);
      }}
    />
  );
}

// 웹 Image 는 크기를 안 주면 원본 크기로 그린다 — 오버레이 배경 칸을 꽉 채운다
const noIslandScene = StyleSheet.create({ fill: { width: '100%', height: '100%' } });

function Tower({ e }: ScreenProps) {
  return <RedesignScreens e={e} />;
}

function Social({ e }: ScreenProps) {
  const r = e.route;
  if (r === 'boat' || r === 'mainIsland' || r === 'currentIsland')
    return (
      // 내 뗏목·메인 섬 변경·친구 관리는 v2 시트 구현(Screens.tsx)이 그린다
      <RedesignScreens e={e} />
    );
  if (r === 'friends' || r === 'friendSearch')
    return (
      // 친구 요청 수락·거절·취소, 친구 ··· 삭제, 닉네임 정확히 일치 검색
      <RedesignScreens e={e} />
    );
  return null;
}

function ShopMusic({ e }: ScreenProps) {
  return <RedesignScreens e={e} />;
}
