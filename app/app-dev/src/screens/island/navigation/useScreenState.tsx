import { customizationTitle } from '@/i18n/customization';
import { CatOutfitLayers, outfitOf, type Outfit } from '@/components/CatOutfitLayers';
import { Btn, C, Pic, Strip, Txt, k } from '@/design-system/patterns';
import { useScreenInsets } from '@/design-system/primitives';
import { errorTextOr, errorText, getLocale, t } from '@/i18n';
import type { ScreenEnvironment } from '@/navigation/ScreenEnvironment';
import { Preview } from '@/screens/island/IslandSheet';
import { FinalIsland } from '@/screens/island/WorldMap';
import type { FriendsScreenState } from '@/screens/island/useFriendsScreen';
import { useIslandRankings } from '@/screens/island/useIslandRankings';
import { useShop } from '@/screens/island/useShop';
import { useTelescopePin } from '@/screens/island/useTelescopePin';
import { ApiError } from '@/services/api/client';
import { friendErrorKind } from '@/services/api/friends';
import { getSession, sessionGeneration } from '@/services/api/session';
import { useCustomizationCatalog } from '@/services/customizationCatalog';
import { islandErrorMessage } from '@/services/islandErrors';
import type { RequestStatusEntry } from '@/services/model';
import {
  Color,
  State,
  balance,
  displayIsland as currentIsland,
  isFull,
  mainIsland,
  products,
} from '@/services/model';
import { screenTime } from '@/services/screenTime';
import { clearStudyWidget } from '@/services/studyWidget';
import { useUnseenOutfits } from '@/services/unseenOutfits';
import { finishWithdrawalCleanup, type WithdrawalIntent } from '@/services/withdrawalIntent';
import { useAppLayout } from '@/utils/layout';
import { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, StyleSheet, View } from 'react-native';
import { H17, META } from './screenParts';

function Boat({ state, h = 260 }: any) {
  // 미리보기 폭이 뗏목보다 넓으면 k.preview 가 뗏목을 가운데로 미는데, 고양이·꾸미기 오버레이의
  // 절대 위치가 컨테이너 왼쪽 기준이라 고양이가 뗏목에서 벗어나 떠 보였다. 뗏목 폭(raftW) 상자로
  // 감싸 오버레이를 그 상자 기준으로 두면 미리보기 폭과 무관하게 늘 뗏목 위에 선다.
  const raftW = h * 0.86;
  return (
    <View style={[k.preview, { height: h }]}>
      <View style={{ width: raftW, height: h, justifyContent: 'center' }}>
        <Pic id="boat/raft" w={raftW} />
        <Pic
          id={'cat/' + state.color}
          w={h * 0.42}
          style={{ position: 'absolute', left: h * 0.36, top: h * 0.12 }}
        />
        {/* 카탈로그 그림으로 겹치는 머리·목·신발(GROMO-2311) — 고양이 그림(idle.png)과 같은 상자 */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: h * 0.36,
            top: h * 0.12,
            width: h * 0.42,
            height: h * 0.42,
          }}
        >
          <CatOutfitLayers
            outfit={outfitOf(state)}
            pose={{ color: state.color, still: 'idle', size: h * 0.42 }}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * 뗏목 합성 그림(440×317)을 미리보기 안쪽 상자(폭·높이)의 92%×86% 에 contain 으로 넣었을 때의 실제 그림 크기 — 넓은 폰에서는
 * 높이가 먼저 차서 그림 폭이 92% 보다 좁다. 꾸미기 오버레이도 이 상자에 맞춘다(GROMO-2382).
 */
export const raftArtSize = (width: number, height: number) => {
  const w = Math.min(width * 0.92, (height * 0.86 * 440) / 317);
  return { width: w, height: (w * 317) / 440 };
};

/** 검정 고양이 뗏목 합성 그림과 그 위 꾸미기를 실제 그림 상자 하나에 겹친다 — 부모(Preview) 안쪽을 재서 맞춘다. */
function BlackRaftCat({ id, outfit }: { id: string; outfit: Outfit }) {
  const [art, setArt] = useState<{ width: number; height: number } | null>(null);
  return (
    <View
      testID="raft-cat-frame"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
      onLayout={(e) => setArt(raftArtSize(e.nativeEvent.layout.width, e.nativeEvent.layout.height))}
    >
      {art && (
        <View testID="raft-cat-art" style={art}>
          <Pic id={id} w="100%" h="100%" />
          {/* 합성 그림 안 고양이(idle) 상자 = 왼쪽 25.0%·위 9.1%·폭 43.0% — 그림 실측(GROMO-2382) */}
          <View
            style={{
              position: 'absolute',
              left: '25.0%',
              top: '9.1%',
              width: '43.0%',
              aspectRatio: 1,
            }}
          >
            <CatOutfitLayers outfit={outfit} pose={{ color: 'black', still: 'idle' }} />
          </View>
        </View>
      )}
    </View>
  );
}
export function useScreenState(e: ScreenEnvironment) {
  const layout = useAppLayout();

  const accountBg: 'sea' | 'dock' = e.fromSea ? 'sea' : 'dock';

  const state: State = e.state,
    island = currentIsland(state),
    route: string = e.route,
    ins = useScreenInsets();

  const {
    dispatch,
    go,
    replace,
    reset,
    home,
    back,
    notify,
    confirm,
    build,
    text,
    setText,
    body,
    setBody,
    tab,
    setTab,
    detail,
    now,
    terms,
    setTerms,
    approval,
    setApproval,
    visited,
    setVisited,
    guideStep,
    setGuideStep,
    player,
    previewAudio,
    setPreviewAudio,
    walkTo,
  } = e;

  const [search, setSearch] = useState(''),
    // 새 섬 만들기 정원 선택값. 숫자로 두고 휠 라벨은 렌더 시점에 로케일대로 만든다
    [capacityPick, setCapacityPick] = useState(15),
    [profileName, setProfileName] = useState(state.name),
    [profileNameError, setProfileNameError] = useState(''),
    [profileColor, setProfileColor] = useState<Color>(state.color),
    [mainIslandPick, setMainIslandPick] = useState(state.mainIslandId ?? ''),
    // 홈 펠리컨 잡지 안내창이 떠 있는 동안 — 왼쪽 아래 채팅 줄이 비킨다(GROMO-2501)
    [magazinePrompt, setMagazinePrompt] = useState(false),
    [discoveryIndex] = useState(() => Math.floor(Math.random() * 10)),
    // 섬 찾기에서 ‹ ›·가입 신청으로 고른 섬 id
    [discoveryPick, setDiscoveryPick] = useState<string | null>(null),
    // ── 서버 온보딩(GROMO-2006). e.islands 가 있으면 실제 API 모드다 ──
    [serverBusy, setServerBusy] = useState(false),
    [serverError, setServerError] = useState(''),
    [soundDialog, setSoundDialog] = useState<{
      kind: 'confirm' | 'success' | 'error';
      productId: string;
      product: any;
    } | null>(null),
    // 생성·가입 뒤 서버 current 가 확인된 섬 이름. arrival 은 CurrentScreens 차단으로 열지 않는다
    [serverDone, setServerDone] = useState(''),
    [safetyTarget, setSafetyTarget] = useState<{
      id: string;
      name: string;
      onDelete?: () => void;
    } | null>(null),
    // 서버 탈퇴(또는 로컬 탈퇴)는 끝났는데 기기의 로컬 데이터 소유자 정리를 확정하지 못한 상태.
    // route 가 바뀌어도 유지한다 — 탈퇴 API 를 다시 부르지 않고 로컬 정리만 재시도해야 한다.
    [withdrawCleanupPending, setWithdrawCleanupPending] = useState(false);

  const profileSaveIntent = useRef<{ signature: string; key: string } | null>(null),
    profileErrorScope = useRef<object>({}),
    serverWriting = useRef(false),
    // 비동기 응답이 왔을 때 사용자가 요청한 화면에 남아 있는지 확인한다
    routeNowRef = useRef(route),
    // 진행 중인 탈퇴 의도 — 탈퇴 대상 userId 와 멱등 키. 요청 전에 기기에도 남겨(beginWithdrawal)
    // 앱이 종료돼도 부팅이 로컬 정리를 이어 간다. 세션이 먼저 정리돼도 정리 대상 계정을 잃지 않는다.
    withdrawIntent = useRef<WithdrawalIntent | null>(null);

  routeNowRef.current = route;

  const currentMainIslandId = mainIsland(state)?.id ?? '';

  useEffect(() => {
    setSearch('');
    setCapacityPick(15);
    setDiscoveryPick(null);
    setServerError('');
    setSoundDialog(null);
    setServerDone('');
    setSafetyTarget(null);
  }, [route]);

  // 서버 명령 실행기 — 진행 중 중복 탭은 한 의도를 두 번 만들지 않게 막고, 오류는 화면 문구로 바꾼다.
  // stale 세션의 늦은 응답(CLIENT_STALE_SESSION)은 문구 없이 버린다.
  const server = e.islands;

  const serverErrorText = (thrown: unknown) => {
    if (!(thrown instanceof ApiError) || getLocale() !== 'ko') return errorText(thrown);
    const code = thrown.code;
    if (
      [
        'SESSION_IN_PROGRESS',
        'OBSERVATORY_LOCKED',
        'FACILITY_LOCKED',
        'MEMBER_ONLY',
        'GROUP_NOT_FOUND',
        'GROUP_FULL',
        'GROUP_LIMIT_EXCEEDED',
      ].includes(code)
    )
      return islandErrorMessage(thrown, 'tower');
    return errorText(thrown);
  };

  const run = (fn: () => Promise<unknown>, fail: (m: string) => void = setServerError) => {
    if (serverWriting.current) return;
    serverWriting.current = true;
    setServerBusy(true);
    fail('');
    Promise.resolve()
      .then(fn)
      .catch((thrown) => {
        const m = serverErrorText(thrown);
        if (m) fail(m);
      })
      .finally(() => {
        serverWriting.current = false;
        setServerBusy(false);
      });
  };

  /**
   * 탈퇴 뒤 기기 정리. 로컬 데이터 소유자 삭제(또는 다음 부팅이 이어 갈 내구 삭제 표식)가 확정돼야만
   * 탈퇴 완료(로그인 화면)로 넘어간다. 확정하지 못하면 이전 사용자의 데이터가 다음 로그인에 남으므로
   * 화면에 머물러 재시도 버튼을 띄운다 — 서버 계정은 이미 삭제됐으니 탈퇴 API 는 다시 부르지 않는다.
   * 1.x(Android 같은 패키지)가 남긴 이 계정의 로컬 버킷·누끼 파일도 같은 규칙으로 먼저 지운다.
   * 세션은 아래 signOut 전까지 남아 있으므로 재시도에서도 같은 userId 를 읽는다.
   */
  const finishWithdrawal = async () => {
    try {
      await finishWithdrawalCleanup(withdrawIntent.current?.userId || getSession()?.userId || null);
    } catch {
      setWithdrawCleanupPending(true);
      notify(t('ui.social.cleanupFailed'));
      return;
    }
    setWithdrawCleanupPending(false);
    withdrawIntent.current = null;
    // 안드로이드 홈 위젯을 비운다 — 탈퇴한 계정의 공부시간이 런처에 남지 않게. signOut 도 비우지만
    // 그 준비가 실패하면(false) 거기까지 가지 않고, 서버 없는 모드는 signOut 을 부르지 않는다.
    // best-effort 라 기다리지 않는다(실패는 래퍼가 삼킨다).
    void clearStudyWidget();
    await screenTime.resetScreenTimeData().catch(() => {});
    // signOut 의 false(로그아웃 tombstone 기록 실패)는 의도적으로 무시한다. 서버 계정은 이미 삭제됐고
    // 로컬 데이터 소유자도 위에서 지웠으므로 화면은 탈퇴 완료로 넘긴다. 이 경우 토큰이 기기에 남지만
    // 삭제된 계정의 세션이라, 다음 요청·다음 부팅의 checkSession 이 401/USER_NOT_FOUND 를 받아
    // clearRejectedSession 으로 정리한다(auth.checkSession·client 401 처리).
    if (server) await e.signOut();
    act('DELETE_ACCOUNT');
    reset('login');
  };

  // 서버 스냅샷 단축 — 첫 로드 전엔 undefined
  const snap = state.serverIslands;

  // 전망대 주간 섬 랭킹(GROMO-2018) — 서버 모드이고 tower route 일 때만 조회한다
  const islandRankings = useIslandRankings({ active: route === 'tower' && !!server });

  // 전망대에서 섬을 망원경에 넣는 확인창·요청(GROMO-2269) — 랭킹 행이 쓴다. 섬 이름 검색(explore)은 자기 인스턴스를 쓴다.
  const telescopePin = useTelescopePin(e);

  // 상점·주문·인벤토리·꾸미기 서버 계약(GROMO-2017) — 상점 계열 route 일 때만 읽는다.
  // 가격·권한·버전은 서버 응답이 정본이고, 로컬 products/owned/orders 는 목업 경로에서만 쓴다.
  const shopApi = useShop({
    active: !!server && ['shop', 'product', 'orders', 'wardrobe', 'sound'].includes(route),
    islandId: snap?.currentIslandId ?? null,
    route,
    category: tab === 'island' ? 'island' : 'personal',
    orderScope: tab === 'shared' ? 'shared' : 'personal',
    productId: route === 'product' ? detail : null,
    dispatch,
  });

  // 서버 상품은 owned 가 응답에 실린다 — 목업 경로만 로컬 보유 목록을 본다.
  const owned = (p: any) =>
    server && p.owned !== undefined
      ? !!p.owned
      : (p.kind === 'clothes' ? state.owned : island.sharedOwned).includes(p.id);

  const catalog = useCustomizationCatalog();

  // 결과창에서 처음 받은 꾸미기 — 옷장 칸에 NEW!, 한 번 누르면 사라진다(GROMO-2382)
  const unseenOutfits = useUnseenOutfits();

  const productTitle = (id: string) =>
    customizationTitle(
      id,
      server ? (shopApi.titles[id] ?? id) : products.find((p) => p.id === id)?.title || id,
    );

  // 친구 관리·친구 찾기(GROMO-2015) — 서버 모드면 /screens/friends 조각과 명령 API 가 정본이다
  const friendsScreen = e.friendsScreen as FriendsScreenState;

  // 친구 명령의 공통 실패 처리 — 게이트는 회원 전환 시트로, 이미 처리·중복은 재조회로 닫는다
  const friendFail = (thrown: unknown) => {
    if (e.conversion?.offer(thrown)) return;
    const kind = friendErrorKind(thrown);
    if (kind === 'duplicate') notify(t('ui.social.duplicateFriend'));
    else if (kind === 'already-handled') notify(t('ui.social.handledRequest'));
    else if (kind === 'privacy') notify(t('ui.social.friendUnavailable'));
    else if (kind === 'network') notify(t('ui.social.checkNetwork'));
    else notify(errorTextOr(thrown, 'errors.GENERIC'));
    if (kind === 'duplicate' || kind === 'already-handled') friendsScreen.refresh();
  };

  // 성공(2xx) 확인 뒤에만 목록이 바뀐다 — optimistic 성공 없이 command 가 재조회를 건다
  const friendCmd = (fn: () => Promise<unknown>) => {
    friendsScreen.command(fn).catch(friendFail);
  };

  // 신청 목록에 단건 상태 조회 결과를 얹은 유효 목록 — requestStatus가 최신 상태다.
  // 단건 결과엔 표시 필드가 없으므로 목록에 없는 신청은 상태만 안다.
  const reqList = [
    ...(snap?.joinRequests ?? []),
    ...(snap?.requestStatus ?? []).filter(
      (r) => !(snap?.joinRequests ?? []).some((x) => x.id === r.id),
    ),
  ].map((r): RequestStatusEntry & { islandName?: string | null } => ({
    ...r,
    status: snap?.requestStatus?.find((x) => x.id === r.id)?.status ?? r.status,
  }));

  // approval 경로에서 기다릴 pending 신청 — detail이 있으면 그 섬의 pending만(다른 섬의
  // 신청이 이 화면을 가로채지 않는다), detail이 없을 때만 첫 pending
  const pendingReq = () =>
    detail
      ? reqList.find((r) => r.status === 'pending' && r.islandId === detail)
      : reqList.find((r) => r.status === 'pending');

  // 승인은 소속만 만든다. 입장 버튼을 눌렀을 때 별도 현재 섬 변경을 확정한다.
  const enterHome = (islandId = snap?.currentIslandId) =>
    islandId ? (
      <Btn
        id="enter-home"
        title={t('onboarding.enterHome')}
        style={{ marginTop: 6 }}
        disabled={serverBusy}
        onPress={() =>
          run(async () => {
            const gen = sessionGeneration();
            if (islandId !== snap?.currentIslandId) await server?.switchCurrent(islandId);
            if (routeNowRef.current !== route || gen !== sessionGeneration()) return;
            reset(
              state.tutorialEnrollment === 'awaiting-first-island' ||
                (state.tutorial && state.tutorial.step <= 3)
                ? 'guide'
                : 'home',
            );
          })
        }
      />
    ) : null;

  // 서버 소속 확인 카드 — 최초 소속은 몽돌 안내, 기존 소속은 홈으로 들어간다.
  const doneCard = (title: string, sub: string, islandId = snap?.currentIslandId) => (
    <View
      style={{
        gap: 4,
        borderWidth: 1.5,
        borderColor: C.brown,
        borderRadius: 14,
        backgroundColor: C.butter,
        paddingVertical: 12,
        paddingHorizontal: 14,
      }}
    >
      <Txt style={H17}>{title}</Txt>
      <Txt kind="meta" style={META}>
        {sub}
      </Txt>
      {enterHome(islandId)}
    </View>
  );

  // 섬 찾기·승인 대기 진입 시 첫 페이지와 pending 목록을 서버에서 가져온다(재실행 복구 포함).
  // 다른 route를 거쳐 같은 route로 돌아오면 다시 가져온다 — 나갔다 재진입이 dead-end가 되지 않게.
  const serverTried = useRef('');

  useEffect(() => {
    if (!server || (route !== 'joinIsland' && route !== 'approval')) {
      serverTried.current = '';
      return;
    }
    if (serverTried.current === route) return;
    serverTried.current = route;
    run(() => server.explore());
  }, [route, server]);

  // 승인 상태는 즉시·4초 주기·포그라운드 복귀 때 확인한다. 느린 요청은 겹치지 않는다.
  const pendingId = pendingReq()?.id;

  useEffect(() => {
    if (!server || route !== 'approval' || !pendingId) return;
    let live = true,
      polling = false;
    const poll = async () => {
      if (!live || polling || AppState.currentState === 'background' || serverWriting.current)
        return;
      polling = true;
      try {
        await server.status(pendingId);
        if (live) setServerError('');
      } catch (thrown) {
        if (live) setServerError(serverErrorText(thrown));
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 4000);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void poll();
    });
    return () => {
      live = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [server, route, pendingId]);

  useEffect(() => {
    if (!soundDialog) return;
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSoundDialog(null);
      return true;
    });
    return () => backSub.remove();
  }, [soundDialog]);

  useEffect(() => {
    profileErrorScope.current = {};
    if (route !== 'profile') return;
    setProfileName(state.name);
    setProfileColor(state.color);
    setProfileNameError('');
    return () => {
      profileErrorScope.current = {};
    };
  }, [route, state.name, state.color]);

  useEffect(() => {
    if (route === 'mainIsland') setMainIslandPick(currentMainIslandId);
  }, [route, currentMainIslandId]);

  // 무인도 항해로 새로 세운 섬 홈에 들어왔으면 강제 이름 짓기 모달을 띄운다(GROMO-2649). island.id 는 서버
  // 현재 섬(displayIsland) — 다른 섬을 보는 중이면 뜨지 않는다. 저장하면 전이 상태가 지워진다.
  const naming =
    route === 'home' &&
    !!server &&
    !!state.pendingIslandNaming &&
    state.pendingIslandNaming === island.id;

  // 운영진의 편지(GROMO-2615) — 펠리컨 잡지 안내나 강제 이름 짓기 모달(GROMO-2649)이 떠 있는 동안은 편지가
  // 조회·표시되지 않게 App 에 알린다. 홈을 떠나거나 안내가 끝나면(정리 함수) 반드시 false 로 돌려 편지가 영영 막히지 않게 한다
  const homeGuideOpen = route === 'home' && (!!magazinePrompt || naming);

  const setSceneGuideOpen = e.setSceneGuideOpen;

  useEffect(() => {
    if (!homeGuideOpen) return;
    setSceneGuideOpen?.(true);
    return () => setSceneGuideOpen?.(false);
  }, [homeGuideOpen, setSceneGuideOpen]);

  const act = (type: string, p: any = {}) => dispatch({ type, ...p });

  const host = !island.members.some((m) => m.role === 'host');

  // 이름으로 지금 방장인지(공지 작성자·공동 구매자 표시)
  const isHostName = (name: string) =>
    name === state.name ? host : island.members.some((m) => m.name === name && m.role === 'host');

  const backgroundHome = (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden={true}
      style={{ flex: 1 }}
    >
      <FinalIsland
        state={state}
        go={go}
        build={build}
        libraryState={e.buildingIndicators?.libraryState}
        showMailboxLetters={e.buildingIndicators?.showMailboxLetters}
        showActions={false}
        boardStatus={e.boardStatus}
      />
    </View>
  );

  const join = (i: any) => {
    if (i.kicked) {
      notify(t('onboarding.kickedCannotRejoin'));
      return;
    }
    if (!i.joined && isFull(i)) {
      notify(t('onboarding.islandFull'));
      return;
    }
    setVisited(i.id);
    act('JOIN', { id: i.id });
    // 승인 필요 섬은 섬 찾기 화면에 가입 신청 대기 상태로 남는다(이미 주민이면 바로 도착)
    if (i.approval && !i.joined) {
      if (route === 'joinIsland' || route === 'approval') setDiscoveryPick(i.id);
      else go('approval', i.id);
    } else go('arrival');
  };

  // 섬 구경 시트의 가입 신청 알림(시트 위 토스트 한 줄)
  const [sheetToast, setSheetToast] = useState(''),
    // 같은 문구가 다시 와도 토스트 시간을 새로 시작하도록 발생 횟수를 함께 둔다.
    [sheetToastSeq, setSheetToastSeq] = useState(0);

  useEffect(() => {
    if (!sheetToast) return;
    const timer = setTimeout(() => setSheetToast(''), 2400);
    return () => clearTimeout(timer);
  }, [sheetToast, sheetToastSeq]);

  useEffect(() => setSheetToast(''), [route]);

  // 비동기 결과가 도착했을 때 사용자가 아직 그 상품 화면에 있는지 확인하는 용도
  const productViewRef = useRef('');

  productViewRef.current = `${route}|${detail}`;

  // 나만 미리듣기가 곡 끝까지 재생되면 버튼을 다시 재생 모양으로
  useEffect(() => {
    if (!previewAudio) return;
    const sub = player.addListener?.('playbackStatusUpdate', (status: any) => {
      if (status?.didJustFinish) setPreviewAudio(false);
    });
    return () => sub?.remove();
  }, [previewAudio]);

  // 뗏목 위 고양이 그림. 합성 그림은 검정 고양이만 있어서 다른 털색은 뗏목 + 고양이를 겹쳐 그린다
  const raftCat = (h: number) =>
    state.color === 'black' ? (
      <Preview h={h}>
        <BlackRaftCat id="boat/raft/cat" outfit={outfitOf(state)} />
      </Preview>
    ) : (
      <Boat state={state} h={layout.compact ? 150 : h} />
    );

  // island(currentIsland(state))는 로컬 목업 섬(state.islandId, 기본값 소다 섬)을 가리켜
  // 서버 모드에서도 항상 「소다 섬」으로 보였다. 서버 모드는 snap.memberships 의 현재 섬 이름이 정본이다.
  const fishStripIslandName = server
    ? (snap?.memberships.find((m) => m.id === snap.currentIslandId)?.name ?? island.name)
    : island.name;

  const fishStrip = (
    <Strip
      label={fishStripIslandName + t('ui.social.fishSuffix')}
      value={
        server
          ? shopApi.wallets
            ? shopApi.wallets.villagePoints.toLocaleString() + t('ui.hall.fishUnit')
            : '…'
          : balance(island).toLocaleString() + t('ui.hall.fishUnit')
      }
    />
  );

  const friends = state.friends ?? [];
  return {
    route,
    e,
    terms,
    setTerms,
    act,
    state,
    home,
    go,
    layout,
    ins,
    back,
    serverBusy,
    server,
    run,
    routeNowRef,
    serverError,
    detail,
    reset,
    capacityPick,
    setCapacityPick,
    approval,
    setApproval,
    serverDone,
    text,
    body,
    setServerDone,
    enterHome,
    setText,
    setBody,
    snap,
    pendingReq,
    reqList,
    discoveryPick,
    setDiscoveryPick,
    doneCard,
    discoveryIndex,
    now,
    join,
    island,
    guideStep,
    backgroundHome,
    setGuideStep,
    naming,
    magazinePrompt,
    build,
    notify,
    dispatch,
    friendsScreen,
    setMagazinePrompt,
    shopApi,
    soundDialog,
    setSoundDialog,
    islandRankings,
    telescopePin,
    serverErrorText,
    setVisited,
    search,
    setSearch,
    visited,
    setSheetToast,
    replace,
    sheetToast,
    tab,
    owned,
    fishStrip,
    setTab,
    confirm,
    productViewRef,
    setSheetToastSeq,
    walkTo,
    raftCat,
    previewAudio,
    player,
    setPreviewAudio,
    productTitle,
    isHostName,
    friends,
    accountBg,
    mainIslandPick,
    setMainIslandPick,
    unseenOutfits,
    catalog,
    setSafetyTarget,
    friendCmd,
    safetyTarget,
    profileName,
    setProfileNameError,
    profileColor,
    profileSaveIntent,
    profileErrorScope,
    setProfileColor,
    setProfileName,
    profileNameError,
    withdrawCleanupPending,
    finishWithdrawal,
    withdrawIntent,
  };
}
export type ScreenContext = ReturnType<typeof useScreenState>;
