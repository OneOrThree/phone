import { syncFocusShield } from '@/services/focusShield';
import { outfitOf } from '@/components/CatOutfitLayers';
import {
  BUNDLED_AUDIO_TRACK_IDS,
  DEFAULT_FREE_AUDIO_TRACK_IDS,
  hasBundledAudio,
} from '@/constants/audio';
import { Btn, C } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { Text, TextInput } from '@/design-system/typography';
import { errorTextOr, t } from '@/i18n';
import { ownCatName } from '@/i18n/format';
import { FishingFocusHud } from '@/screens/focus/FishingFocusHud';
import {
  DEFAULT_CATCH_PLACEMENT,
  DEFAULT_SPOT,
  FiButton,
  FiModal,
  FishingActor,
  FishingIsland,
  FishingPeerActorView,
  FishingWalker,
  INK,
  LANDING,
  OUTLINE,
  a11yHidden,
  anchorCard,
  castSpot,
  fiCard,
  fiTitle,
  fishingGrid,
  fishingPeerCatchVisible,
  labelBox,
  seatProblem,
} from '@/screens/focus/FishingIsland';
import { FocusResultSummary } from '@/screens/focus/FocusResultSummary';
import { GoldenFishCutscene } from '@/screens/focus/GoldenFishCutscene';
import { RestGroup } from '@/screens/focus/RestGroup';
import { VerificationSpike, VerificationToggle } from '@/screens/focus/VerificationSpike';
import {
  type FishingPeer,
  fishingSpotsForActors,
  useFishingPeerActors,
} from '@/screens/focus/useFishingPeerActors';
import { catColor, useIslandPresence } from '@/screens/focus/useIslandPresence';
import { useBoardNotices } from '@/screens/interiors/useBoardNotices';
import {
  GuideBox,
  TutorialScene,
  TutorialSpotlight,
  useScreenReaderEnabled,
  useSpotlightTarget,
} from '@/screens/island/NpcGuide';
import { useShop } from '@/screens/island/useShop';
import { DepartureStory } from '@/screens/world/DepartureStory';
import { Sailing } from '@/screens/world/WorldViews';
import { ApiError } from '@/services/api/client';
import { getSession } from '@/services/api/session';
import {
  type GoldenFishEvent,
  isGoldenFishParticipant,
  memberArrivedText,
} from '@/services/islandRealtime';
import { lookOf } from '@/services/memberAppearance';
import {
  Route,
  State,
  canBuy,
  displayIsland as currentIsland,
  dayKey,
  products,
  sessionSeconds,
  trackNames,
} from '@/services/model';
import {
  clearVerificationResult,
  verificationResult,
} from '@/services/studyVerification/sessionResult';
import { findReachableTutorialSpot } from '@/services/tutorial';
import {
  isTutorialExperience,
  tutorialExperienceAction,
  tutorialExperienceScene,
} from '@/services/tutorialExperience';
import { afterForegroundMs } from '@/utils/afterForegroundMs';
import { useAppLayout } from '@/utils/layout';
import { Point, landPath, nearestLand, onLand } from '@/utils/world-grid';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmoteFab } from './EmoteFab';
import { FishingCatInfo, FishingCatInfoTarget } from './FishingCatInfo';
import { FocusVolume } from './FocusVolume';
import { RewardModal, ServerQuestRewardModal } from './RewardModal';

// 임시 검수 전용: 인증·서버를 쓰지 않는 데모에서 집중마다 황금 물고기를 확정 재생한다.
const GOLDEN_TEST =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('demo') &&
  new URLSearchParams(window.location.search).has('golden-test');

export function FocusFlow({ e: environment }: any) {
  const experience = isTutorialExperience(environment.state);
  // 화면 내부에서만 체험 세션을 투영한다. API·실시간·전역 집중 상태는 연결하지 않는다.
  const e = experience
    ? {
        ...environment,
        state: tutorialExperienceScene(environment.state),
        focus: undefined,
        islands: undefined,
        dispatch: (action: any) =>
          environment.dispatch({ ...action, type: tutorialExperienceAction(action.type) }),
        setGuideStep: (step: number, expected?: any) => {
          environment.setGuideStep(step, expected);
          if (step === 99) environment.home();
        },
      }
    : environment;
  const s: State = e.state,
    i = currentIsland(s),
    L = useAppLayout(),
    safe = useSafeAreaInsets(),
    r: Route = e.route,
    wide = L.width >= 600,
    reduce = s.settings.reduceMotion,
    tutorialStep: number = e.guideStep;
  // 낚시섬의 내 고양이에 입힐 장착 그림(GROMO-2382)
  const myOutfit = outfitOf(s);
  const screenReader = useScreenReaderEnabled();
  const advanceTutorial = (from: number, to: number) => {
    if (tutorialStep === from)
      e.setGuideStep(to, { step: from, revision: s.tutorialRevision ?? 0 });
  };
  const setupInputTarget = useSpotlightTarget(tutorialStep === 7),
    setupStartTarget = useSpotlightTarget(tutorialStep === 8),
    pauseTarget = useSpotlightTarget(tutorialStep === 14),
    endTarget = useSpotlightTarget(tutorialStep === 17 || tutorialStep === 18),
    resultTarget = useSpotlightTarget(tutorialStep === 21);
  const [fan, setFan] = useState(false),
    [emote, setEmote] = useState<string | null>(null),
    [dialog, setDialog] = useState<'music' | 'reward' | null>(null),
    [soundPurchase, setSoundPurchase] = useState<{
      kind: 'confirm' | 'success' | 'error';
      product: any;
    } | null>(null),
    // 누른 주민 정보창(GROMO-2474)
    [catInfo, setCatInfo] = useState<FishingCatInfoTarget | null>(null),
    [error, setError] = useState(''),
    [setupHeight, setSetupHeight] = useState(0),
    // 화면 높이 대신 실제 영역 높이(키보드가 뜨면 줄어듦)로 준비 카드 위치를 잡는다
    [boxHeight, setBoxHeight] = useState(0),
    [walker, setWalker] = useState({ p: LANDING, left: false, walking: false }),
    // 휴식 오가는 배 이동: 휴식 시간은 휴식하기를 누른 순간부터 흐르고, 집중은 낚시섬에 도착해야 다시 흐른다
    [voyage, setVoyage] = useState<'toRest' | 'toSpot' | null>(null),
    // 자리에서 뗏목까지 걸어가기(leave)·뗏목에서 자리로 걸어오기(comeback): 걷는 동안 버튼·모달 없음, 시간 안 흐름
    [leg, setLeg] = useState<'leave' | 'comeback' | null>(null),
    [goldenCutscene, setGoldenCutscene] = useState<GoldenFishEvent | null>(null),
    [goldenCatches, setGoldenCatches] = useState<
      Record<string, { count: number; eventId: string }>
    >({}),
    [goldenReeling, setGoldenReeling] = useState(false),
    [goldenFish, setGoldenFish] = useState(false),
    [tutorialReeling, setTutorialReeling] = useState(false),
    // 첫 물고기를 낚는 연출을 시작할 차례 — 황금 컷신·reel이 끝날 때까지 미룬다
    [tutorialCatchStart, setTutorialCatchStart] = useState<number | null>(null),
    // 첫 물고기 reel이 끝나 12단계로 갈 차례 — 황금 컷신·reel이 끝날 때까지 미룬다
    [tutorialCatchRevision, setTutorialCatchRevision] = useState<number | null>(null);
  const [verificationPreviewOpen, setVerificationPreviewOpen] = useState(false);
  const [verificationPlacementHint, setVerificationPlacementHint] = useState(false);
  const returningFromArrival = useRef(false);
  // 보상을 확인하는 동안에도 결과 화면에서 고른 다음 목적지를 유지한다.
  const resultDestination = useRef<'island' | 'focus'>('island');
  useEffect(() => {
    if (r !== 'fishingArrival') returningFromArrival.current = false;
  }, [r]);
  // 자리 고르기·집중 화면을 떠나면(준비·휴식·결과) 열린 정보창을 닫는다
  useEffect(() => setCatInfo(null), [r]);
  const tutorialRequest = useRef<string | null>(null);
  const tutorialRetryAt = useRef(0);
  const tutorialReelCancel = useRef<(() => void) | null>(null);
  const tutorialReelRevision = useRef<number | null>(null);
  const tutorialMounted = useRef(true);
  useEffect(() => {
    tutorialMounted.current = true;
    return () => {
      tutorialMounted.current = false;
      tutorialReelCancel.current?.();
    };
  }, []);
  const walkingToken = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    emoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    position = useRef(LANDING),
    // 걷기·항해 콜백은 끝났을 때의 최신 화면·세션을 보고 계속할지 정한다(그 사이 집중이 끝났으면 중단)
    latest = useRef({ r, s, now: e.now }),
    backRef = useRef<() => boolean>(() => false),
    goldenHandler = useRef<(event: GoldenFishEvent) => void>(() => {}),
    goldenPresenter = useRef<(event: GoldenFishEvent) => void>(() => {}),
    goldenCutsceneRef = useRef<GoldenFishEvent | null>(null),
    goldenQueueRef = useRef<GoldenFishEvent[]>([]),
    goldenQueueTimerRef = useRef<(() => void) | null>(null),
    goldenPendingReelRef = useRef<GoldenFishEvent | null>(null),
    goldenDeferredNavigationRef = useRef<(() => void) | null>(null),
    goldenPendingSessionRef = useRef<GoldenFishEvent[]>([]),
    goldenAnnouncementPendingRef = useRef(false),
    goldenSeenRef = useRef(new Set<string>()),
    goldenTestSession = useRef<string | null>(null),
    // 내가 직접 finish()를 부른 동안은 그 응답이 오기 전에 같은 종료를 알리는 내 focus.member.updated
    // completed 브로드캐스트가 먼저 도착해도 강퇴로 오인하지 않는다.
    finishInFlightRef = useRef(false),
    // finish() 응답 전에 도착해 무시한 내 종료 이벤트 — finish()가 실패하면 그 이벤트를 뒤늦게 처리한다.
    suppressedEndRef = useRef(false),
    // 내가 종료를 요청한 세션 id — 응답이 끝난 뒤 늦게 도착하는 같은 세션의 완료 이벤트를 강퇴로 오인하지 않는다.
    endedByMeSessionIdRef = useRef<string | null>(null);
  latest.current = { r, s, now: e.now };
  // 서버 세션: 결과 카드의 퀘스트 지표·보상 수령은 서버 회차가 정본이다(GROMO-2014).
  // 목업(review/demo·비로그인)은 e.islands 가 없어 로컬 경로 그대로다.
  const serverQuests = !!e.islands && !s.visitingIslandId;
  const boardQ = useBoardNotices({
    active: serverQuests && r === 'focusResult',
    scopeKey: `focusQuests:${s.serverIslands?.currentIslandId ?? i.id}`,
  });
  // GROMO-2010 — 서버 모드에서는 같은 섬 주민의 실시간 집중/휴식·응원이 정본이다.
  // 응원 채널은 내 진행 서버 세션이 이 섬에 있을 때만 구독·발신한다(없으면 서버가 거절한다).
  const liveIslandId = e.islands ? (s.serverIslands?.currentIslandId ?? null) : null;
  const musicRoute = ['fishingArrival', 'focusSetup', 'focus'].includes(r);
  // 집중섬 축음기는 세션 시작 전에도 구매·곡 변경이 가능하다. 일반 섬 축음기와 달리
  // 판매 목록·공동 인벤토리·지갑을 함께 읽되, 실제 기기 재생은 App 의 active 세션 gate 가 맡는다.
  const focusShop = useShop({
    active: !!e.islands && musicRoute && i.buildings.includes('gram'),
    islandId: liveIslandId,
    route: 'sound',
    category: 'personal',
    orderScope: 'personal',
    productId: null,
    dispatch: e.dispatch,
  });
  const emoteSessionId =
    liveIslandId && s.session?.version != null && s.session.islandId === liveIslandId
      ? s.session.id
      : null;
  const myId = getSession()?.userId;
  const actorUserId = myId ?? (GOLDEN_TEST ? 'demo-me' : undefined);
  const transitionHandler = useRef<(transition: any) => void>(() => {});
  const live = useIslandPresence({
    active: liveIslandId !== null,
    islandId: liveIslandId,
    emoteSessionId,
    events: true, // 내 소속 섬 화면 — 주민만 구독할 수 있다(GROMO-2311)
    onMemberArrived: (event) => e.notify(memberArrivedText(event)),
    onSendError: e.notify,
    // 방문자가 보낸 응원은 말풍선 대신 알림으로 — 이름은 서버가 주지 않는다
    onVisitorEmote: () => e.notify(t('focusFlow.visitorCheered')),
    onTransition: (transition) => transitionHandler.current(transition),
    onGoldenFish: (event) => goldenHandler.current(event),
  });
  const resultSessionId = r === 'focusResult' ? (s.lastResult?.id ?? null) : null;
  const goldenSessionId = s.session?.id ?? resultSessionId;
  const recordGoldenCatch = (event: GoldenFishEvent) => {
    setGoldenCatches((current) => {
      const next = { ...current };
      for (const member of event.members) {
        const key = `${member.userId}:${member.sessionId}`;
        next[key] = {
          count: (current[key]?.count ?? 0) + 1,
          eventId: event.eventId,
        };
      }
      return next;
    });
  };
  const startGoldenReelTimer = () => {
    setGoldenReeling(true);
    goldenQueueTimerRef.current = afterForegroundMs(() => {
      setGoldenReeling(false);
      goldenQueueTimerRef.current = null;
      const next = goldenQueueRef.current.shift() ?? null;
      goldenCutsceneRef.current = next;
      if (next) {
        setGoldenReeling(false);
        setGoldenFish(false);
        setGoldenCutscene(next);
      } else {
        const navigate = goldenDeferredNavigationRef.current;
        goldenDeferredNavigationRef.current = null;
        navigate?.();
      }
    }, 2000);
  };
  const announceGoldenCatch = () => {
    if (AppState.currentState === 'background' || AppState.currentState === 'inactive') {
      goldenAnnouncementPendingRef.current = true;
      return;
    }
    goldenAnnouncementPendingRef.current = false;
    AccessibilityInfo.announceForAccessibility(t('focusFlow.fish.goldenCaughtA11y'));
  };
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || !goldenAnnouncementPendingRef.current) return;
      goldenAnnouncementPendingRef.current = false;
      AccessibilityInfo.announceForAccessibility(t('focusFlow.fish.goldenCaughtA11y'));
    });
    return () => subscription.remove();
  }, []);
  goldenPresenter.current = (event) => {
    if (reduce) {
      setGoldenReeling(false);
      recordGoldenCatch(event);
      setGoldenFish(true);
      announceGoldenCatch();
      return;
    }
    setGoldenFish(false);
    setGoldenReeling(false);
    if (goldenCutsceneRef.current || goldenQueueTimerRef.current) {
      goldenQueueRef.current.push(event);
      return;
    }
    goldenCutsceneRef.current = event;
    setGoldenCutscene(event);
  };
  goldenHandler.current = (event) => {
    if (experience) return;
    const current = latest.current;
    const participantSessionId =
      current.s.session?.id ?? (current.r === 'focusResult' ? current.s.lastResult?.id : undefined);
    if (
      current.r === 'focusSetup' &&
      myId &&
      event.members.some((member) => member.userId === myId)
    ) {
      if (goldenSeenRef.current.has(event.eventId)) return;
      goldenSeenRef.current.add(event.eventId);
      goldenPendingSessionRef.current.push(event);
      return;
    }
    if (
      !participantSessionId ||
      !isGoldenFishParticipant(event, myId, participantSessionId) ||
      (current.r !== 'focus' && current.r !== 'rest' && current.r !== 'focusResult')
    )
      return;
    if (goldenSeenRef.current.has(event.eventId)) return;
    goldenSeenRef.current.add(event.eventId);
    if (goldenSeenRef.current.size > 200)
      goldenSeenRef.current.delete(goldenSeenRef.current.values().next().value!);
    if (current.r === 'rest') {
      goldenQueueRef.current.push(event);
      return;
    }
    goldenPresenter.current(event);
  };
  useEffect(() => {
    if (!goldenSessionId || (r !== 'focus' && r !== 'rest' && r !== 'focusResult')) return;
    const pending = goldenPendingSessionRef.current;
    goldenPendingSessionRef.current = [];
    for (const event of pending) {
      if (!isGoldenFishParticipant(event, myId, goldenSessionId)) continue;
      if (r === 'rest') goldenQueueRef.current.push(event);
      else goldenPresenter.current(event);
    }
  }, [goldenSessionId, r, myId]);
  const goldenFor = (userId: string | null | undefined, sessionId: string | null | undefined) =>
    userId && sessionId ? goldenCatches[`${userId}:${sessionId}`] : undefined;
  const activeFocusCount = live.focus.filter((member) => member.status === 'active').length;
  useEffect(() => {
    if (!liveIslandId || !s.session) return;
    e.onPresenceCounts?.(
      s.session.id,
      liveIslandId,
      live.status === 'ready'
        ? {
            focus: Math.max(activeFocusCount, s.session.status === 'active' ? 1 : 0),
            rest: Math.max(live.rest.length, s.session.status === 'paused' ? 1 : 0),
          }
        : null,
    );
  }, [
    liveIslandId,
    s.session?.id,
    s.session?.status,
    live.status,
    activeFocusCount,
    live.rest.length,
  ]);
  useEffect(
    () => () => {
      walkingToken.current++;
      if (timer.current) clearTimeout(timer.current);
      if (emoteTimer.current) clearTimeout(emoteTimer.current);
      goldenQueueTimerRef.current?.();
    },
    [],
  );
  // 안드로이드 뒤로가기는 App.back 보다 먼저 이 화면이 처리한다
  useEffect(() => {
    if (!e.backOverride) return;
    const own = () => backRef.current();
    e.backOverride.current = own;
    return () => {
      // 이미 다른 화면이 자기 처리를 걸었으면 건드리지 않는다
      if (e.backOverride.current === own) e.backOverride.current = null;
    };
  }, [e.backOverride]);
  // 휴식·결과로 전환하는 순간의 당첨은 유지한다. 집중 흐름을 완전히 떠날 때만 지운다.
  useEffect(() => {
    setFan(false);
    setDialog(null);
    const inFocusFlow = r === 'focusSetup' || r === 'focus' || r === 'rest' || r === 'focusResult';
    if (!inFocusFlow) {
      setEmote(null);
      goldenCutsceneRef.current = null;
      goldenQueueRef.current = [];
      goldenQueueTimerRef.current?.();
      goldenQueueTimerRef.current = null;
      goldenPendingReelRef.current = null;
      goldenDeferredNavigationRef.current = null;
      goldenPendingSessionRef.current = [];
      goldenAnnouncementPendingRef.current = false;
      setGoldenCutscene(null);
      setGoldenReeling(false);
      setGoldenFish(false);
      return;
    }
    if (r !== 'rest' && !goldenCutsceneRef.current && !goldenQueueTimerRef.current) {
      if (reduce) {
        const pending = goldenQueueRef.current.splice(0);
        for (const event of pending) recordGoldenCatch(event);
        if (pending.length > 0) {
          setGoldenFish(true);
          announceGoldenCatch();
        }
      } else {
        const pending = goldenQueueRef.current.shift();
        if (pending) goldenPresenter.current(pending);
      }
    }
  }, [r, reduce]);
  // 걸어가는 동안 끝난 컷신은 배우가 다시 보인 뒤에 더미·reel을 반영한다.
  useEffect(() => {
    if (leg || !goldenPendingReelRef.current) return;
    const event = goldenPendingReelRef.current;
    goldenPendingReelRef.current = null;
    recordGoldenCatch(event);
    setGoldenFish(true);
    startGoldenReelTimer();
  }, [leg]);
  useEffect(() => {
    if (r !== 'focus' || tutorialStep !== 11 || s.session?.status !== 'active') return;
    if (sessionSeconds(s.session, e.now) < 5) return;
    const sessionId = s.session.id;
    const revision = s.tutorialRevision ?? 0;
    const key = `${sessionId}:${revision}`;
    if (tutorialRequest.current === key || e.now < tutorialRetryAt.current) return;
    tutorialRequest.current = key;
    const stillHere = () =>
      tutorialMounted.current &&
      latest.current.r === 'focus' &&
      latest.current.s.session?.id === sessionId &&
      latest.current.s.tutorial?.step === 11 &&
      (latest.current.s.tutorialRevision ?? 0) === revision;
    const showCatch = () => {
      if (stillHere()) setTutorialCatchStart(revision);
    };
    if (experience) {
      const claim = environment.focus?.tutorialExperienceReward;
      const islandId = s.session.islandId;
      const confirmed = () => {
        if (!stillHere()) return;
        environment.dispatch({ type: 'TUTORIAL_EXPERIENCE_REWARD', sessionId });
        showCatch();
      };
      if (!environment.focus) {
        confirmed();
        return;
      }
      claim(islandId)
        .then((reward: { status: string }) => {
          if (!stillHere()) return;
          if (reward.status === 'granted') confirmed();
          else e.setGuideStep(14, { step: 11, revision });
        })
        .catch((error: any) => {
          if (!stillHere()) return;
          tutorialRequest.current = null;
          tutorialRetryAt.current = latest.current.now + 5000;
          e.notify(errorTextOr(error, 'focusFlow.fish.rewardCheckFailed'));
        });
      return;
    }
    if (!e.focus) {
      if (s.records.length > 0) {
        e.setGuideStep(14, { step: 11, revision });
        return;
      }
      e.dispatch({ type: 'TUTORIAL_FISH' });
      showCatch();
      return;
    }
    e.focus
      .tutorialReward(sessionId)
      .then((reward: { status: string }) => {
        if (!stillHere()) return;
        if (reward.status === 'granted') showCatch();
        else if (reward.status === 'unavailable') e.setGuideStep(14, { step: 11, revision });
        else {
          tutorialRequest.current = null;
          tutorialRetryAt.current = e.now + 1000;
        }
      })
      .catch((error: any) => {
        if (!stillHere()) return;
        tutorialRequest.current = null;
        tutorialRetryAt.current = latest.current.now + 5000;
        e.notify(errorTextOr(error, 'focusFlow.fish.rewardCheckFailed'));
      });
  }, [
    e.focus,
    e.dispatch,
    e.setGuideStep,
    e.now,
    r,
    s.session,
    s.records.length,
    s.tutorialRevision,
    tutorialStep,
    reduce,
  ]);
  useEffect(() => {
    if (tutorialStep !== 11) {
      tutorialReelCancel.current?.();
      tutorialReelRevision.current = null;
      setTutorialReeling(false);
      setTutorialCatchStart(null);
      setTutorialCatchRevision(null);
    }
  }, [tutorialStep]);
  // 황금 컷신·reel이 장면을 덮는 동안에는 첫 물고기를 낚는 연출을 시작하지 않고, reel 도중에 덮이면
  // 타이머를 취소했다가 황금 연출이 모두 끝난 뒤 처음부터 다시 보여 준다.
  useEffect(() => {
    const goldenBusy = !!goldenCutscene || goldenReeling;
    if (goldenBusy && tutorialReelRevision.current !== null) {
      const revision = tutorialReelRevision.current;
      tutorialReelCancel.current?.();
      tutorialReelRevision.current = null;
      setTutorialReeling(false);
      setTutorialCatchStart(revision);
      return;
    }
    if (tutorialCatchStart === null || goldenBusy) return;
    const revision = tutorialCatchStart;
    setTutorialCatchStart(null);
    if (tutorialStep !== 11 || (s.tutorialRevision ?? 0) !== revision) return;
    const finishReel = () => {
      tutorialReelRevision.current = null;
      setTutorialReeling(false);
      setTutorialCatchRevision(revision);
    };
    if (reduce) finishReel();
    else {
      tutorialReelRevision.current = revision;
      setTutorialReeling(true);
      tutorialReelCancel.current = afterForegroundMs(finishReel, 2000);
    }
  }, [tutorialCatchStart, goldenCutscene, goldenReeling, reduce, tutorialStep, s.tutorialRevision]);
  // 황금 컷신·reel이 장면을 덮는 동안에는 첫 물고기 대사로 넘어가지 않는다.
  useEffect(() => {
    if (tutorialCatchRevision === null || goldenCutscene || goldenReeling) return;
    setTutorialCatchRevision(null);
    if (tutorialStep === 11 && (s.tutorialRevision ?? 0) === tutorialCatchRevision)
      e.setGuideStep(12, { step: 11, revision: tutorialCatchRevision });
  }, [tutorialCatchRevision, goldenCutscene, goldenReeling, tutorialStep, s.tutorialRevision]);
  // 서버 세션(version 있음)이면 명령이 정본이다 — 성공 응답이 SESSION_SYNC/RESULT 로 state를
  // 갈아 끼운 뒤에만 화면을 옮긴다. 없으면(REVIEW·DEMO 목업) 로컬 reducer 경로를 그대로 쓴다.
  const serverSession = () => e.focus && s.session?.version != null;
  // 서버가 내 집중 세션을 끝냈을 때(강퇴 등) 로컬 세션을 정리하고 화면을 빠져나간다.
  // 완료 이벤트는 정상 종료와 사유가 같아 강퇴로 단정하지 않는 문구를 쓴다.
  const leaveAfterServerEnd = () => {
    e.dispatch({ type: 'SESSION_SYNC', session: null });
    e.notify(t('focusFlow.hud.endedByServer'));
    e.home();
  };
  const finish = () => {
    if (tutorialStep === 11) return;
    if (goldenCutsceneRef.current || goldenQueueTimerRef.current) {
      const requestedSessionId = s.session?.id;
      setDialog(null);
      goldenDeferredNavigationRef.current = () => {
        const current = latest.current;
        if (
          requestedSessionId &&
          current.s.session?.id === requestedSessionId &&
          (current.r === 'focus' || current.r === 'rest')
        )
          finish();
      };
      return;
    }
    if (serverSession()) {
      // 확인 버튼을 연달아 눌러도 종료 요청은 하나만 보낸다 — 진행 중 플래그를 공유하므로
      // 먼저 끝난 요청이 다른 요청의 플래그까지 내리지 않게 한다.
      if (finishInFlightRef.current) return;
      const session = s.session;
      endedByMeSessionIdRef.current = session?.id ?? null;
      finishInFlightRef.current = true;
      suppressedEndRef.current = false;
      e.focus
        .finish()
        .then(() => {
          advanceTutorial(tutorialStep === 17 ? 17 : 18, 19);
          e.reset('focusResult');
        })
        .catch(async (error: any) => {
          if (await e.recoverExpiredRestConflict?.(error, session)) return;
          // 종료를 누른 사이 서버가 먼저 세션을 끝냈다면(무시했던 완료 이벤트) 그쪽으로 정리한다.
          if (suppressedEndRef.current) {
            leaveAfterServerEnd();
            return;
          }
          // 응답만 유실돼 서버는 종료를 반영했을 수 있다 — 표식을 풀어 뒤늦게 오는 완료 이벤트가
          // 무시되지 않고 종료 처리되게 한다.
          endedByMeSessionIdRef.current = null;
          e.notify(errorTextOr(error, 'focus.finishFailed'));
        })
        .finally(() => {
          finishInFlightRef.current = false;
          suppressedEndRef.current = false;
        });
      return;
    }
    e.dispatch({ type: 'FINISH' });
    advanceTutorial(tutorialStep === 17 ? 17 : 18, 19);
    e.reset('focusResult');
  };
  // 내 자리: 진행 중 세션은 서버가 기억한 내 seat 가 정본 — 다른 기기에서 시작한 세션을 복구하면 focusSpot 은 지난
  // 세션 좌표다(SESSION_SYNC 는 focusSpot 을 바꾸지 않음). 내 항목은 아래 peerMembers 에서 거르므로 거르기 전에 꺼낸다.
  // 서버 seat 가 없으면(옛 앱으로 시작) 로컬 focusSpot, 없거나 유효하지 않으면 보상을 놓을 수 있는 기본 자리로 대신한다
  const liveSeat = s.session
    ? live.focus.find((m) => m.userId === myId && m.sessionId === s.session?.id)?.seat
    : null;
  // 결과 화면·다른 기기 종료(SESSION_SYNC 가 세션을 먼저 지움)에선 서버가 내 항목을 지우므로 이번 세션에서 마지막으로
  // 받은 seat 를 이어 쓴다. 세션 id 를 알면 일치할 때만, 모르면(세션·결과 id 없음) 그대로 — 새 세션은 자리 고르기·준비를
  // 거치며 비운다
  const lastServerSeat = useRef<{ sessionId: string; seat: Point } | null>(null);
  // 서버는 0~100 범위만 검사하므로 물 위 seat 는 쓰지 않고 로컬 focusSpot/DEFAULT_SPOT 으로 대체한다
  if (s.session && liveSeat && onLand(fishingGrid, liveSeat))
    lastServerSeat.current = { sessionId: s.session.id, seat: liveSeat };
  else if (r === 'focusSetup' || r === 'fishingArrival') lastServerSeat.current = null;
  const knownSessionId = s.session?.id ?? resultSessionId,
    serverSeat =
      (r === 'focus' || r === 'rest' || r === 'focusResult') &&
      lastServerSeat.current &&
      (knownSessionId == null || lastServerSeat.current.sessionId === knownSessionId)
        ? lastServerSeat.current.seat
        : null,
    localSpot = s.focusSpot && s.focusSpot.x <= 100 && s.focusSpot.y <= 100 ? s.focusSpot : null,
    // 격자가 바뀌기 전(티켓 2516)에 고른 자리는 물·나무·바위 칸일 수 있다 — 가장 가까운 걸을 수 있는 칸에 앉힌다
    minePoint =
      serverSeat ??
      (localSpot
        ? onLand(fishingGrid, localSpot)
          ? localSpot
          : nearestLand(fishingGrid, localSpot)
        : DEFAULT_SPOT),
    mine = castSpot(minePoint);
  if (minePoint.x === DEFAULT_SPOT.x && minePoint.y === DEFAULT_SPOT.y)
    mine.catchPlacement = DEFAULT_CATCH_PLACEMENT;
  // 주민 자리: 서버 모드는 live 스냅숏+이벤트가 정본 — 로딩·실패면 로컬 멤버로 지어내지 않는다.
  const peerMembers: FishingPeer[] = liveIslandId
    ? live.focus
        .filter((m) => m.userId !== myId)
        .map((m) => ({
          userId: m.userId,
          sessionId: m.sessionId,
          name: m.name ?? t('focusFlow.common.resident'),
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
    : i.members
        .filter((m) => m.focusing)
        .map((m: any) => ({
          userId: m.id,
          sessionId: m.sessionId ?? m.id,
          name: m.name ?? t('focusFlow.common.resident'),
          color: m.color,
          subject: m.subject ?? null,
          seconds: m.seconds ?? 0,
          status: 'active' as const,
        }));
  useEffect(() => {
    const sessionId = s.session?.id;
    if (
      experience ||
      !GOLDEN_TEST ||
      r !== 'focus' ||
      !sessionId ||
      goldenTestSession.current === sessionId
    )
      return;
    const timeout = setTimeout(() => {
      const current = latest.current;
      if (current.r !== 'focus' || current.s.session?.id !== sessionId) return;
      goldenTestSession.current = sessionId;
      const members = [
        { userId: 'demo-me', sessionId },
        ...i.members
          .filter((member) => member.focusing)
          .map((member: any) => ({
            userId: member.id,
            sessionId: member.sessionId ?? member.id,
          })),
      ];
      goldenPresenter.current({
        eventId: `golden-test-${sessionId}`,
        islandId: i.id,
        drawnAt: new Date().toISOString(),
        reward: members.length,
        sharePerMember: 1,
        members,
      });
    }, 900);
    return () => clearTimeout(timeout);
  }, [experience, r, s.session?.id, i.id, i.members]);
  const peerFlow = useFishingPeerActors({
    members: peerMembers,
    ready: liveIslandId ? live.status === 'ready' : true,
    reduce,
    realtime: liveIslandId !== null,
    snapshotVersion: live.snapshotVersion,
    snapshotTransitions: live.snapshotTransitions,
    // 내 자리는 이번 흐름에서 고른 뒤(준비·집중·휴식·결과)에만 비켜 준다 — 자리 고르기 중의 focusSpot 은
    // 지난 세션 좌표라 예약하면 그 자리에 앉은 주민의 seat 가 밀려난다
    mine:
      r === 'focusSetup' || r === 'focus' || r === 'rest' || r === 'focusResult'
        ? minePoint
        : undefined,
  });
  transitionHandler.current = (transition) => {
    // 내 낚시 세션이 진행 중이던 중(previous.status === 'active') 서버가 강퇴 등으로
    // 세션을 강제 종료하면(focus.member.updated completed) focus/rest 이벤트만으로는
    // 타이머가 계속 흐른다 — 여기서 내 몫만 감지해 화면을 빠져나간다.
    // finishInFlightRef 는 내가 직접 finish()를 부른 뒤 아직 응답 전인 같은 사건과 구분한다.
    if (
      transition.kind === 'focus' &&
      transition.userId === myId &&
      transition.current === null &&
      transition.previous?.status === 'active' &&
      s.session
    ) {
      if (finishInFlightRef.current) {
        suppressedEndRef.current = true;
      } else if (transition.previous.sessionId !== endedByMeSessionIdRef.current) {
        leaveAfterServerEnd();
        return;
      }
    }
    peerFlow.onTransition(transition);
  };
  const peers = peerFlow.actors.filter((actor) => actor.visible),
    peerSpots = peerFlow.actors.map((actor) => actor.spot),
    peerCatchSpots = peerFlow.actors.filter(fishingPeerCatchVisible).map((actor) => actor.spot),
    fishingPeerSpots = fishingSpotsForActors(peerFlow.actors),
    emoteByUser = new Map(live.emotes.map((em) => [em.userId, em.type]));
  // 걷기: 땅 격자 경로를 따라 지도 폭 11%/초로 걷고, 걷는 중 다시 누르면 지금 위치에서 새 목적지로.
  const walkTo = (to: Point, done: () => void) => {
    const from = position.current,
      cells = landPath(fishingGrid, from, to);
    if (!cells.length) return false;
    let rest = [...cells.slice(1, -1), to],
      p = from,
      left = walker.left;
    const token = ++walkingToken.current;
    const step = () => {
      if (token !== walkingToken.current) return;
      let budget = reduce ? Infinity : 0.44;
      while (rest.length && budget > 0) {
        const q = rest[0],
          dx = q.x - p.x,
          d = Math.hypot(dx, q.y - p.y);
        if (Math.abs(dx) > 0.15) left = dx < 0;
        if (d <= budget) {
          p = q;
          rest = rest.slice(1);
          budget -= d;
        } else {
          p = { x: p.x + (dx / d) * budget, y: p.y + ((q.y - p.y) / d) * budget };
          budget = 0;
        }
      }
      position.current = p;
      setWalker({ p, left, walking: rest.length > 0 });
      if (rest.length) timer.current = setTimeout(step, 40);
      else done();
    };
    step();
    return true;
  };
  // 자리에서 일어나 뗏목까지 걸어간 뒤 next(휴식 항해·귀환 항해)
  const leaveTo = (next: () => void) => {
    if (goldenCutsceneRef.current || goldenQueueTimerRef.current) {
      goldenDeferredNavigationRef.current = () => leaveTo(next);
      return;
    }
    position.current = mine;
    setLeg('leave');
    const arrive = () => {
      setLeg(null);
      if (goldenCutsceneRef.current || goldenQueueTimerRef.current) {
        goldenDeferredNavigationRef.current = next;
        return;
      }
      next();
    };
    if (!walkTo(LANDING, arrive)) arrive();
  };
  const pause = () => {
    // 첫 물고기 보상·reel을 기다리는 11단계에는 오버레이가 없다 — 이때 전환하면 12~14단계 안내가 누락된다.
    if (tutorialStep === 11) return;
    if (goldenCutsceneRef.current || goldenQueueTimerRef.current) {
      const requestedSessionId = s.session?.id;
      goldenDeferredNavigationRef.current = () => {
        if (
          requestedSessionId &&
          latest.current.r === 'focus' &&
          latest.current.s.session?.id === requestedSessionId
        )
          pause();
      };
      return;
    }
    // 휴식 시간은 누른 순간부터(뗏목까지 걷기·배 이동도 휴식).
    // 서버 세션은 pause 성공 뒤에만 휴식 연출을 시작한다(정책: 이동 연출은 성공 후).
    const go = () =>
      leaveTo(() => {
        setVoyage('toRest');
        const started = e.go('rest', '', () => setVoyage(null));
        if (started === false) setVoyage(null);
      });
    if (serverSession()) {
      e.focus
        .pause()
        .then(() => {
          // 15단계는 실제 rest 화면 도착 후 App의 복구 로직에서 연다.
          go();
        })
        .catch((error: any) => e.notify(errorTextOr(error, 'focusFlow.hud.pauseFailed')));
      return;
    }
    e.dispatch({ type: 'PAUSE' });
    go();
  };
  const result = s.lastResult,
    canRestartFocus =
      !!result &&
      !s.session &&
      !experience &&
      !(tutorialStep >= 5 && tutorialStep <= 21) &&
      !!(s.serverIslands ? s.serverIslands.currentIslandId : i.joined),
    leave = () => {
      const navigate = () => {
        clearVerificationResult(result?.id);
        // 자동 종료 결과는 닫을 때 acknowledge — 확인 전까지 서버가 계속 돌려주므로 실패해도 잃지 않는다
        if (result?.ackId) e.focus?.acknowledge(result.ackId).catch(() => {});
        if (resultDestination.current === 'focus' && canRestartFocus) {
          setDialog(null);
          setError('');
          // 복구한 서버 자리도 새 준비 화면에 이어 쓴다. 실제 새 세션은 시작 버튼에서 만든다.
          e.dispatch({ type: 'FOCUS_SPOT', spot: minePoint });
          e.reset('focusSetup');
          // reset이 입력을 비우므로 과목은 화면을 바꾼 뒤 채운다.
          e.setText(result?.subject ?? '');
          return;
        }
        s.resultFromRest
          ? e.home()
          : leaveTo(() => latest.current.r === 'focusResult' && e.go('returnTravel'));
      };
      if (goldenCutsceneRef.current || goldenQueueTimerRef.current) {
        goldenDeferredNavigationRef.current = navigate;
        return;
      }
      navigate();
    },
    // 결과 다음에 새로 받은 보상이 있으면 보상받기 모달, 없으면 선택한 목적지로.
    // 서버 경로는 회차 목록 로딩 중이거나 수령 가능한 퀘스트가 있으면 모달을 연다 —
    // 로딩이 끝났는데 받을 게 없으면 모달 스스로 닫힌다.
    done = (destination: 'island' | 'focus' = 'island') => {
      resultDestination.current = destination;
      return serverQuests
        ? boardQ.loading || boardQ.quests.some((q) => q.claimable)
          ? setDialog('reward')
          : leave()
        : s.rewards?.some((x) => !x.acknowledged)
          ? setDialog('reward')
          : leave();
    },
    claimed = (more: boolean) => {
      if (!more) leave();
    };
  const resume = () => {
    if (serverSession()) {
      const session = s.session;
      e.focus
        .resume()
        .then(() => {
          advanceTutorial(15, 16);
          setVoyage('toSpot');
        })
        .catch(async (error: any) => {
          if (await e.recoverExpiredRestConflict?.(error, session)) return;
          e.notify(errorTextOr(error, 'focus.resumeFailed'));
        });
      return;
    }
    advanceTutorial(15, 16);
    setVoyage('toSpot');
  };
  const returnFromArrival = () => {
    if (
      r !== 'fishingArrival' ||
      returningFromArrival.current ||
      (tutorialStep >= 5 && tutorialStep <= 21) ||
      goldenCutsceneRef.current ||
      goldenQueueTimerRef.current
    )
      return;
    // 자리로 걷던 중에도 귀환할 수 있다. 기존 걷기 콜백을 취소하고 뗏목으로 향한다.
    returningFromArrival.current = true;
    const sail = () => latest.current.r === 'fishingArrival' && e.go('returnTravel');
    if (!walkTo(LANDING, sail)) sail();
  };
  const activeFocus = r === 'focus' && s.session?.status === 'active' && !leg;
  const focusAudioProducts: any[] = e.islands
    ? focusShop.items
    : products.filter((product) => product.kind === 'audio');
  const focusOwnedTrackIds = (
    e.islands && focusShop.shared ? focusShop.shared.audio : i.sharedOwned
  ).filter(hasBundledAudio);
  const focusTrackIds = [
    ...focusOwnedTrackIds,
    ...focusAudioProducts
      .map((product) => product.id)
      .filter((id) => !focusOwnedTrackIds.includes(id)),
  ];
  const focusTrackLabel = (id: string) =>
    trackNames[id] ??
    focusShop.titles[id] ??
    focusAudioProducts.find((p) => p.id === id)?.title ??
    id;
  const changeFocusTrack = async (trackId: string) => {
    if (!e.playback) {
      e.dispatch({ type: 'TRACK_SELECT', value: trackId });
      return true;
    }
    try {
      // 곡 선택과 재생은 별개다. 집중 전에도 선택할 수 있지만 실제 재생은 active 집중에서만 한다.
      await e.playback.update({ trackId });
      return true;
    } catch (thrown) {
      e.notify(errorTextOr(thrown, 'focusFlow.music.changeFailed'));
      return false;
    }
  };
  const changeFocusPlaying = async (playing: boolean) => {
    if (!activeFocus) return;
    if (!e.playback) {
      e.dispatch({ type: 'PLAY', value: playing });
      return;
    }
    try {
      await e.playback.update({ playing });
    } catch (thrown) {
      e.notify(errorTextOr(thrown, 'focusFlow.music.changeFailed'));
    }
  };
  const buyFocusTrack = async () => {
    const product = soundPurchase?.product;
    if (!product) return;
    if (e.islands) {
      try {
        await focusShop.buy(product);
        setSoundPurchase({ kind: 'success', product });
      } catch (thrown) {
        if (e.conversion?.offer(thrown)) {
          setSoundPurchase(null);
          return;
        }
        if (thrown instanceof ApiError && thrown.code === 'INSUFFICIENT_FUNDS') {
          setSoundPurchase({ kind: 'error', product });
          return;
        }
        setSoundPurchase(null);
        e.notify(errorTextOr(thrown, 'focusFlow.music.purchaseFailed'));
      }
      return;
    }
    if (canBuy(s, product)) {
      setSoundPurchase({ kind: 'error', product });
      return;
    }
    e.dispatch({ type: 'BUY', id: product.id });
    setSoundPurchase({ kind: 'success', product });
  };
  const closeMusic = () => {
    setSoundPurchase(null);
    setDialog(null);
  };
  const musicHintStyle = {
    fontSize: semanticTokens.typography.label,
    lineHeight: semanticTokens.typography.label * 1.6,
    color: semanticTokens.color.textMuted,
  };
  const musicModal =
    dialog === 'music' && !goldenReeling ? (
      <FiModal>
        <Text
          style={[
            fiTitle(semanticTokens.typography.title),
            { marginBottom: semanticTokens.spacing.control },
          ]}
        >
          {t('focusFlow.music.title')}
        </Text>
        <Text
          style={[
            musicHintStyle,
            {
              marginBottom: wide
                ? semanticTokens.spacing.control
                : semanticTokens.spacing.component,
            },
          ]}
        >
          {t(activeFocus ? 'focusFlow.music.activeSubtitle' : 'focusFlow.music.inactiveSubtitle')}
        </Text>
        {soundPurchase ? (
          <View style={{ gap: semanticTokens.spacing.control }}>
            <Text style={[fiTitle(semanticTokens.typography.title), { textAlign: 'center' }]}>
              {soundPurchase.kind === 'confirm'
                ? t('focusFlow.music.purchaseConfirm', { title: soundPurchase.product.title })
                : soundPurchase.kind === 'success'
                  ? t('focusFlow.music.purchaseSuccess')
                  : t('focusFlow.music.insufficientFish')}
            </Text>
            {soundPurchase.kind === 'confirm' && (
              <Text style={[musicHintStyle, { textAlign: 'center' }]}>
                {t('focusFlow.music.sharedPurchaseHint')}
              </Text>
            )}
            {soundPurchase.kind === 'confirm' ? (
              <View style={{ flexDirection: 'row', gap: semanticTokens.spacing.control }}>
                <FiButton
                  title={t('common.cancel')}
                  style={{ flex: 1 }}
                  onPress={() => setSoundPurchase(null)}
                />
                <FiButton
                  primary
                  title={t('focusFlow.music.buyForFish', {
                    price: soundPurchase.product.price,
                  })}
                  style={{ flex: 1 }}
                  onPress={buyFocusTrack}
                />
              </View>
            ) : soundPurchase.kind === 'success' ? (
              <View style={{ flexDirection: 'row', gap: semanticTokens.spacing.control }}>
                <FiButton
                  title={t('common.later')}
                  style={{ flex: 1 }}
                  onPress={() => setSoundPurchase(null)}
                />
                <FiButton
                  primary
                  title={t('focusFlow.music.switchTrack')}
                  style={{ flex: 1 }}
                  onPress={async () => {
                    if (!(await changeFocusTrack(soundPurchase.product.id))) return;
                    setSoundPurchase(null);
                  }}
                />
              </View>
            ) : (
              <FiButton primary title={t('common.ok')} onPress={() => setSoundPurchase(null)} />
            )}
          </View>
        ) : (
          <>
            {activeFocus && (
              <View
                style={{
                  gap: semanticTokens.spacing.control,
                  marginBottom: semanticTokens.spacing.control,
                }}
              >
                <View style={{ flexDirection: 'row', gap: semanticTokens.spacing.control }}>
                  <FiButton
                    primary={i.playing}
                    title={t('focusFlow.music.play')}
                    style={{ flex: 1 }}
                    onPress={() => void changeFocusPlaying(true)}
                  />
                  <FiButton
                    primary={!i.playing}
                    title={t('focusFlow.music.stop')}
                    style={{ flex: 1 }}
                    onPress={() => void changeFocusPlaying(false)}
                  />
                </View>
                <View>
                  <Text style={musicHintStyle}>{t('focusFlow.music.deviceVolume')}</Text>
                  <FocusVolume
                    value={s.settings.volume ?? 0.55}
                    onChange={(value) => e.dispatch({ type: 'SETTING', key: 'volume', value })}
                  />
                </View>
              </View>
            )}
            {e.islands && focusShop.error ? (
              <View style={{ gap: semanticTokens.spacing.control }}>
                <Text style={musicHintStyle}>{t('focusFlow.music.loadFailed')}</Text>
                <FiButton title={t('common.retry')} onPress={focusShop.retry} />
              </View>
            ) : e.islands && focusShop.loading ? (
              <Text style={musicHintStyle}>{t('focusFlow.music.loading')}</Text>
            ) : (
              <View style={{ gap: semanticTokens.spacing.control }}>
                {focusTrackIds.map((id) => {
                  const owned = focusOwnedTrackIds.includes(id);
                  const product = focusAudioProducts.find((item) => item.id === id);
                  const bundled = BUNDLED_AUDIO_TRACK_IDS.includes(
                    id as (typeof BUNDLED_AUDIO_TRACK_IDS)[number],
                  );
                  if (
                    !owned &&
                    (!bundled || product?.available === false || product?.price == null)
                  )
                    return null;
                  const status = owned
                    ? DEFAULT_FREE_AUDIO_TRACK_IDS.includes(id)
                      ? t('focusFlow.music.free')
                      : t('focusFlow.music.owned')
                    : t('focusFlow.music.buyForFish', { price: product.price });
                  return (
                    <FiButton
                      key={id}
                      left
                      primary={owned && i.track === id}
                      title={`${focusTrackLabel(id)} · ${status}`}
                      onPress={() => {
                        if (owned) void changeFocusTrack(id);
                        else setSoundPurchase({ kind: 'confirm', product });
                      }}
                    />
                  );
                })}
              </View>
            )}
            <View
              style={{
                marginTop: wide ? semanticTokens.spacing.control : semanticTokens.spacing.component,
              }}
            >
              <FiButton primary title={t('focusFlow.music.backToSpot')} onPress={closeMusic} />
            </View>
          </>
        )}
      </FiModal>
    ) : null;
  // 뒤로가기: 자리 선택 중에는 귀환하고, 나머지 걷기·항해 중에는 막는다. 모달은 닫기만, 결과는 '확인'(보상·귀환 흐름)과 같게, 모닥불은 '집중 이어가기'와 같게
  backRef.current = () => {
    if (tutorialStep >= 5 && tutorialStep <= 21) return true;
    if (goldenCutsceneRef.current || goldenQueueTimerRef.current) return true;
    if (r === 'fishingArrival') {
      returnFromArrival();
      return true;
    }
    if (leg || voyage || walker.walking || r === 'focusTravel' || r === 'returnTravel') return true;
    if (dialog === 'reward') {
      // 서버 수령은 명시적 버튼으로만 — 뒤로가기는 모달을 닫고 나간다
      // (남은 보상은 게시판 상세에서 받을 수 있다).
      if (serverQuests) {
        leave();
        return true;
      }
      const open = (s.rewards ?? []).filter((x) => !x.acknowledged);
      if (open[0]) e.dispatch({ type: 'CLAIM', id: open[0].id });
      claimed(open.length > 1);
      return true;
    }
    if (soundPurchase) {
      setSoundPurchase(null);
      return true;
    }
    if (dialog) {
      closeMusic();
      return true;
    }
    if (r === 'focusResult') {
      done();
      return true;
    }
    if (r === 'rest' && s.session?.status === 'paused') {
      resume();
      return true;
    }
    if (r === 'focus' && s.session) {
      e.notify(t('focusFlow.common.holdEndHint'));
      return true;
    }
    return false;
  };
  if (r === 'focusTravel')
    return (
      <DepartureStory
        color={s.color}
        outfit={s.equipped}
        destination={t('focusFlow.common.fishingIsland')}
        onComplete={() => e.replace('fishingArrival')}
      />
    );
  if (r === 'returnTravel')
    return (
      <Sailing
        state={s}
        from={t('focusFlow.common.fishingIsland')}
        destination={t('focusFlow.common.ourIsland')}
        duration={1900}
        onArrive={e.home}
      />
    );
  if (r === 'rest' && voyage)
    return (
      <Sailing
        state={s}
        from={
          voyage === 'toRest'
            ? t('focusFlow.common.fishingIsland')
            : t('focusFlow.common.ourIsland')
        }
        destination={
          voyage === 'toRest'
            ? t('focusFlow.travel.restCampfire')
            : t('focusFlow.travel.fishingSpot')
        }
        duration={1900}
        onArrive={() => {
          setVoyage(null);
          if (voyage === 'toRest' || latest.current.r !== 'rest' || !latest.current.s.session)
            return;
          e.go('focus');
          position.current = LANDING;
          setLeg('comeback');
          const sit = () => {
            setLeg(null);
            // 서버 세션은 RESUME 을 로컬로 흉내 내지 않는다 — resume 명령 성공이 이미 status를 갱신했다
            const latestSession = latest.current.s.session;
            if (latestSession?.status === 'paused' && latestSession.version == null)
              e.dispatch({ type: 'RESUME' });
          };
          if (!walkTo(mine, sit)) sit();
        }}
      />
    );
  if (r === 'rest')
    return (
      <RestGroup
        state={s}
        live={liveIslandId ? live : null}
        home={e.home}
        resume={resume}
        tutorial={
          tutorialStep === 15
            ? {
                text: t('focusFlow.tutorial.step15'),
                onSkip: () => e.setGuideStep(99),
              }
            : undefined
        }
      />
    );
  // 정해진 자리 없음: 땅을 누르면 걸어가기만 하고, 하단 [집중 시작]을 누른 자리에서 집중할 수 있는지 본다.
  const spotError = (p: Point): string | null => {
    const problem = seatProblem(p, peerSpots, i.buildings.includes('gram'));
    return problem ? t(`focusFlow.spot.${problem}`) : null;
  };
  // 물·이어지지 않은 땅은 홈 섬처럼 조용히 무시한다. 걷는 중 다시 누르면 지금 위치에서 새 목적지로.
  const walkOnly = (p: Point) => {
    if (returningFromArrival.current || !onLand(fishingGrid, p)) return;
    walkTo(p, () => {});
  };
  // 자리 검사 → 자리 저장 → 준비 카드. 실패하면 이유만 알리고 제자리.
  const startAt = (p: Point) => {
    if (returningFromArrival.current || latest.current.r !== 'fishingArrival') return;
    const error = spotError(p);
    if (error) {
      e.notify(error);
      return;
    }
    e.dispatch({ type: 'FOCUS_SPOT', spot: p });
    advanceTutorial(5, 7);
    advanceTutorial(6, 7);
    e.go('focusSetup');
  };
  // [집중 시작]: 걷는 중이면 그 자리에 멈춰 선 채로 검사한다.
  const startHere = () => {
    // 뗏목으로 돌아가는 중이면 귀환 걷기를 끊지 않는다(끊으면 귀환 콜백이 사라져 화면에 갇힌다)
    if (returningFromArrival.current) return;
    if (walker.walking) {
      walkingToken.current++;
      setWalker((w) => ({ ...w, walking: false }));
    }
    startAt(position.current);
  };
  // 스크린리더: 걸어갈 수 있는 빈 땅을 골라 걸어간 뒤 바로 준비 카드까지 연다.
  const selectAccessibleSpot = () => {
    // 뗏목으로 돌아가는 중이면 귀환 걷기를 끊지 않는다(startHere 와 같은 이유)
    if (returningFromArrival.current) return;
    const spot = findReachableTutorialSpot(
      fishingGrid,
      walker.p,
      DEFAULT_SPOT,
      (p) => !spotError(p),
    );
    if (!spot) {
      e.notify(t('focusFlow.spot.noneFound'));
      return;
    }
    // 걸어갈 길이 없는 곳(뗏목 쪽 땅과 이어지지 않은 땅)
    if (!walkTo(spot, () => startAt(spot))) e.notify(t('focusFlow.spot.unreachable'));
  };
  // 뗏목: 자리 고르기에서는 뗏목까지 걸어가 본인만 우리 섬으로, 집중 중에는 집중 종료 확인.
  const raft = () => {
    if (tutorialStep >= 5 && tutorialStep <= 21) return;
    if (r === 'fishingArrival') {
      returnFromArrival();
    } else if (r === 'focus' && s.session && !leg) e.notify(t('focusFlow.common.holdEndHint'));
  };
  const start = () => {
    const subject = e.text.trim() || t('focusFlow.setup.defaultSubject');
    Keyboard.dismiss();
    if (!e.focus && !i.joined) {
      e.notify(t('focusFlow.setup.needsIsland'));
      e.replace('sea');
      return;
    }
    if (e.focus) {
      // 서버 세션 — islandId·멱등 키·복구는 명령이 챙긴다. 시작 성공 뒤에만 낚시 화면으로 간다.
      // 고른 자리(focusSpot)를 함께 보내 다른 주민 화면에도 같은 자리에 앉는다(GROMO-2478)
      setError('');
      e.focus
        .start({ subject, seat: s.focusSpot })
        .then(() => {
          advanceTutorial(8, 9);
          e.go('focus');
        })
        .catch((error: any) => setError(errorTextOr(error, 'focusFlow.setup.startFailed')));
      return;
    }
    e.dispatch({ type: 'START', subject });
    advanceTutorial(8, 9);
    e.go('focus');
  };
  const finishInput = () => {
    Keyboard.dismiss();
    e.setGuideStep(8);
  };
  const closeSetup = () => {
    Keyboard.dismiss();
    setError('');
    if (tutorialStep === 7 || tutorialStep === 8) e.setGuideStep(5);
    e.replace('fishingArrival');
  };
  const skipTutorial = () => e.setGuideStep(99);
  const finishResult = () => {
    if (tutorialStep === 21) e.setGuideStep(22);
    done();
  };
  // 결과창의 퀘스트는 집중을 마친 날 회차 기준(자정을 넘겨 봐도 그날 달성이 남는다)
  const resultAt = result?.at ?? e.now,
    resultDay = dayKey(resultAt),
    focusQuests = i.quests.filter((q) => q.type === 'focus'),
    achieved = focusQuests.filter((q) => q.rounds?.[resultDay]?.achieved.includes('me'));
  const achievedQuestTitles = serverQuests
    ? boardQ.quests.filter((q) => q.claimable || q.claimed).map((q) => q.title)
    : achieved.map((q) => q.title);
  const resultModal = (
    <FiModal
      hidden={dialog === 'reward'}
      footer={
        <View style={{ gap: semanticTokens.spacing.control }}>
          {canRestartFocus && (
            <FiButton
              primary
              id="result-restart"
              multiline
              title={t('focusFlow.result.restart')}
              onPress={() => done('focus')}
            />
          )}
          <View ref={resultTarget.ref} collapsable={false} onLayout={resultTarget.measure}>
            <FiButton
              primary={!canRestartFocus}
              id="result-done"
              multiline
              title={
                s.resultFromRest || tutorialStep === 21
                  ? t('focusFlow.common.backToIsland')
                  : t('focusFlow.result.backByBoat')
              }
              onPress={finishResult}
            />
          </View>
        </View>
      }
    >
      <FocusResultSummary
        subject={result?.subject ?? t('focusFlow.result.defaultSubject')}
        seconds={result?.seconds ?? 0}
        verifiedSeconds={verificationResult(result?.id, result?.seconds ?? 0)}
        fish={result?.fish ?? 0}
        questTitles={achievedQuestTitles}
        recordId={result?.id}
        // 집중 보상은 세션당 최대 1개다(2301 정산) — 첫 아이템만 보인다
        rewardId={result?.rewards?.[0]}
        rewardNew={!!result?.rewards && !!result.newRewards?.includes(result.rewards[0])}
      />
    </FiModal>
  );
  const rewardModal =
    dialog === 'reward' &&
    (serverQuests ? (
      <ServerQuestRewardModal e={e} board={boardQ} onDone={claimed} />
    ) : (
      <RewardModal e={e} onClaimed={claimed} />
    ));
  const tutorialNext = (text: string, next: number) => (
    <TutorialSpotlight text={text} backdrop="none">
      <Btn title={t('focusFlow.tutorial.next')} small onPress={() => e.setGuideStep(next)} />
    </TutorialSpotlight>
  );
  const tutorialOverlay = (() => {
    if (leg || voyage || goldenCutscene || goldenReeling) return null;
    // 5·6단계는 땅을 직접 눌러야 넘어간다 — 「다음」 없이 지도를 열어 두고 안내만 띄운다
    if (r === 'fishingArrival' && (tutorialStep === 5 || tutorialStep === 6)) {
      const width = Math.min(L.floatingWidth, 414);
      return (
        <GuideBox
          accessibilityViewIsModal
          text={t(tutorialStep === 5 ? 'focusFlow.tutorial.step5' : 'focusFlow.tutorial.step6')}
          style={{ zIndex: 100, left: (L.width - width) / 2, width, bottom: safe.bottom + 16 }}
          onSkip={skipTutorial}
        >
          {screenReader ? (
            <Btn title={t('focusFlow.spot.sitEmptyButton')} onPress={selectAccessibleSpot} />
          ) : (
            <FiButton
              title={t('focusFlow.spot.start')}
              id="focus-start"
              primary
              onPress={startHere}
            />
          )}
        </GuideBox>
      );
    }
    if (r === 'focusSetup' && tutorialStep === 7)
      return (
        <TutorialSpotlight
          target={setupInputTarget.rect}
          error={error}
          accessibleInput={
            <TextInput
              accessibilityLabel={t('focusFlow.common.todayTodo')}
              value={e.text}
              onChangeText={(value) => {
                e.setText(value);
                setError('');
              }}
              maxLength={40}
              onSubmitEditing={finishInput}
              returnKeyType="done"
              style={{ minHeight: componentTokens.input.minHeight, width: '100%', color: C.ink }}
            />
          }
          text={t('focusFlow.tutorial.step7')}
        >
          <Btn
            title={t(e.text.trim() ? 'focusFlow.tutorial.step7Done' : 'focusFlow.setup.skip')}
            small
            onPress={finishInput}
          />
        </TutorialSpotlight>
      );
    if (r === 'focusSetup' && tutorialStep === 8)
      return (
        <TutorialSpotlight
          target={setupStartTarget.rect}
          error={error}
          text={t('focusFlow.tutorial.step8')}
          action={{ title: t('focus.start'), onPress: start }}
        />
      );
    if (r === 'focus' && tutorialStep === 9) return tutorialNext(t('focusFlow.tutorial.step9'), 10);
    if (r === 'focus' && tutorialStep === 10)
      return tutorialNext(t('focusFlow.tutorial.step10', { name: s.name }), 11);
    if (r === 'focus' && tutorialStep === 12)
      return tutorialNext(t('focusFlow.tutorial.step12'), 14);
    if (r === 'focus' && tutorialStep === 14)
      return (
        <TutorialSpotlight
          target={pauseTarget.rect}
          action={{ title: t('focusFlow.common.pauseFocus'), onPress: pause }}
          text={t('focusFlow.tutorial.step14')}
        />
      );
    if (r === 'focus' && tutorialStep === 16)
      return tutorialNext(t('focusFlow.tutorial.step16'), 17);
    if (r === 'focus' && (tutorialStep === 17 || tutorialStep === 18))
      return (
        <TutorialSpotlight target={endTarget.rect} text={t('focusFlow.tutorial.step17')}>
          {(screenReader || !endTarget.rect) && (
            <FiButton
              title={t('focusFlow.common.endFocus')}
              holdToConfirm
              haptics={s.settings.haptics}
              onPress={finish}
            />
          )}
        </TutorialSpotlight>
      );
    if (r === 'focusResult' && tutorialStep === 19)
      return tutorialNext(
        t('focusFlow.tutorial.step19'),
        // 서버는 유효 집중 60초당 1마리라 0마리일 수 있다 — 없는 물고기를 확인하라고 안내하지 않는다.
        (result?.fish ?? 0) > 0 ? 20 : 21,
      );
    if (r === 'focusResult' && tutorialStep === 20)
      return tutorialNext(t('focusFlow.tutorial.step20'), 21);
    if (r === 'focusResult' && tutorialStep === 21)
      return (
        <TutorialSpotlight
          target={resultTarget.rect}
          action={{ title: t('focusFlow.common.backToIsland'), onPress: finishResult }}
          text={t('focusFlow.tutorial.step21')}
        />
      );
    return null;
  })();
  const goldenCutsceneOverlay = goldenCutscene ? (
    <GoldenFishCutscene
      key={goldenCutscene.eventId}
      muted={!s.settings.sound}
      volume={s.settings.volume ?? 0.55}
      onFinish={() => {
        const completed = goldenCutscene;
        goldenCutsceneRef.current = null;
        setGoldenCutscene(null);
        if (leg) {
          goldenPendingReelRef.current = completed;
          // 이동 완료 전에도 다음 컷신·화면 전환이 앞지르지 못하게 차단한다.
          goldenQueueTimerRef.current = () => {
            goldenPendingReelRef.current = null;
          };
          return;
        }
        recordGoldenCatch(completed);
        setGoldenFish(true);
        // 실제 포그라운드에서 reel을 2초 노출한 뒤 다음 영상 또는 지연된 이동을 진행한다.
        startGoldenReelTimer();
      }}
    />
  ) : null;
  if (r === 'focusResult' && s.resultFromRest)
    return (
      <TutorialScene style={{ flex: 1 }} overlay={tutorialOverlay} onSkip={skipTutorial}>
        <View
          style={{ flex: 1 }}
          importantForAccessibility={goldenCutscene ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={!!goldenCutscene}
        >
          <RestGroup
            state={s}
            live={liveIslandId ? live : null}
            home={e.home}
            resume={e.home}
            result
            goldenReeling={goldenReeling}
            goldenFishCount={goldenFor(actorUserId, goldenSessionId)?.count ?? 0}
          />
          {!goldenReeling && resultModal}
          {!goldenReeling && rewardModal}
        </View>
        {goldenCutsceneOverlay}
      </TutorialScene>
    );
  const seated = r !== 'fishingArrival' && !leg,
    spots = [...fishingPeerSpots, ...(seated ? [mine] : [])];
  const focusing = activeFocus,
    mySubject = r === 'focusSetup' ? null : (s.session?.subject ?? result?.subject ?? null);
  // 체험 완료 기록(focusGuideDone)은 기기에만 남아 재설치·새 기기에서는 사라진다. 진행 중인 튜토리얼이
  // 없으면 첫 집중 체험을 마친 계정으로 보고 안내한다 — 기록을 잃은 계정에는 다시 보여도 된다.
  const tutorialDone = s.focusGuideDone || !s.tutorial || s.tutorial.step >= 22;
  const verificationIntro =
    tutorialDone && !experience
      ? !e.routeTransitionShielded &&
        !e.letterOpen &&
        r === 'fishingArrival' &&
        !dialog &&
        !catInfo &&
        !leg &&
        !voyage &&
        !goldenCutscene
        ? 'automatic'
        : 'onPress'
      : undefined;

  // 집중 준비 모달은 누른 곳(내 고양이) 위에 붙인다. 위가 좁으면 아래 → 오른쪽 → 왼쪽.
  const setup = (toScreen: (p: Point) => Point, size: number) => {
    const { x, y } = toScreen(mine),
      dw = Math.min(330, L.width - 40),
      { top, left } = anchorCard(
        x,
        y,
        size * 0.077,
        dw,
        setupHeight,
        L.width,
        boxHeight || L.height,
        safe,
      );
    return (
      <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#493B3940' }]} />
        <View
          testID="focus-setup-card"
          // 카드 높이로 카드 위치를 정하므로(anchorCard), 위치가 바뀔 때 Android 픽셀 반올림으로 생기는
          // 1픽셀 미만 높이 흔들림까지 받으면 측정 → 재배치 → 재측정이 끝없이 돌아 앱이 꺼진다(GROMO-2750).
          onLayout={(ev) => {
            const height = ev.nativeEvent.layout.height;
            setSetupHeight((prev) => (Math.abs(height - prev) < 1 ? prev : height));
          }}
          style={[
            fiCard,
            {
              position: 'absolute',
              top,
              left,
              width: dw,
              paddingTop: 14,
              paddingHorizontal: 16,
              paddingBottom: 16,
              opacity: setupHeight ? 1 : 0,
            },
          ]}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 4,
            }}
          >
            <Text style={fiTitle(18)}>{t('focusFlow.setup.title')}</Text>
            <Pressable
              testID="close-focus-setup"
              accessibilityRole="button"
              accessibilityLabel={t('focusFlow.setup.close')}
              onPress={closeSetup}
              style={{
                minWidth: semanticTokens.size.tapMin,
                minHeight: semanticTokens.size.tapMin,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={fiTitle(semanticTokens.typography.title)}>×</Text>
            </Pressable>
          </View>
          <Text
            style={{
              fontSize: 12,
              lineHeight: 19.2,
              fontWeight: '800',
              color: INK,
              marginBottom: 4,
            }}
          >
            {t('focusFlow.common.todayTodo')}
          </Text>
          <View ref={setupInputTarget.ref} collapsable={false} onLayout={setupInputTarget.measure}>
            <TextInput
              testID="focus-subject"
              accessibilityLabel={t('focusFlow.common.todayTodo')}
              value={e.text}
              onChangeText={(tx: string) => {
                e.setText(tx);
                setError('');
              }}
              maxLength={40}
              placeholder={t('focusFlow.setup.placeholder')}
              placeholderTextColor="#9C8B80"
              returnKeyType="done"
              onSubmitEditing={tutorialStep === 7 ? finishInput : start}
              style={{
                minHeight: 40,
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderWidth: 2,
                borderColor: OUTLINE,
                borderRadius: 13,
                backgroundColor: C.paper,
                fontSize: 14,
                lineHeight: 22.4,
                color: INK,
              }}
            />
          </View>
          {error !== '' && (
            <Text style={{ fontSize: 11, lineHeight: 17, color: '#a65539', marginTop: 5 }}>
              {error}
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <View
              ref={setupStartTarget.ref}
              collapsable={false}
              onLayout={setupStartTarget.measure}
              style={{ flex: 1 }}
            >
              <FiButton
                primary
                title={t(e.text.trim() ? 'focus.start' : 'focusFlow.setup.skipAndStart')}
                id="start-focus"
                onPress={start}
              />
            </View>
          </View>
        </View>
      </View>
    );
  };
  const sendEmote = (id: string) => {
    setFan(false);
    if (liveIslandId) {
      // 서버 모드는 STOMP SEND 가 유일한 경로 — 브로드캐스트가 돌아올 때만 화면에 뜬다.
      if (!live.sendEmote(id)) e.notify(t('focusFlow.hud.emoteSendFailed'));
      return;
    }
    setEmote(id);
    if (emoteTimer.current) clearTimeout(emoteTimer.current);
    emoteTimer.current = setTimeout(() => setEmote(null), 3000);
  };
  const hudText = {
    color: INK,
    textShadowColor: '#FFFDFA',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  };
  return (
    <TutorialScene
      style={{ flex: 1 }}
      onLayout={(ev) => setBoxHeight(ev.nativeEvent.layout.height)}
      overlay={tutorialOverlay}
      isolateAccessibility={(tutorialStep === 5 || tutorialStep === 6) && !!tutorialOverlay}
      onSkip={skipTutorial}
    >
      <View testID="golden-background" style={{ flex: 1 }} {...a11yHidden(!!goldenCutscene)}>
        <FishingIsland
          focus={r !== 'fishingArrival' ? mine : L.landscape ? { x: 45, y: 58 } : { x: 38, y: 56 }}
          ratio={r === 'focusSetup' ? 0.72 : 0.5}
          spots={spots}
          onTap={r === 'fishingArrival' ? walkOnly : undefined}
          onSitAccessible={r === 'fishingArrival' ? selectAccessibleSpot : undefined}
          onRaft={raft}
          gram={i.buildings.includes('gram')}
          onGram={musicRoute ? () => setDialog('music') : undefined}
          seated={seated}
          focusHud={focusing}
          inert={!!dialog || r === 'focusResult' || !!goldenCutscene || !!catInfo}
          overlayBlocksMap={r === 'focusSetup'}
          overlay={
            r === 'focusSetup'
              ? setup
              : r === 'fishingArrival' && !(tutorialStep >= 5 && tutorialStep <= 21)
                ? (toScreen) => (
                    <>
                      <View
                        testID="focus-arrival-hint"
                        pointerEvents="none"
                        accessibilityLiveRegion="polite"
                        style={{
                          position: 'absolute',
                          top: Math.min(
                            toScreen({ x: 50, y: 100 }).y + semanticTokens.spacing.control,
                            (boxHeight || L.height) -
                              safe.bottom -
                              componentTokens.focusArrival.bottomReserve,
                          ),
                          left: safe.left + semanticTokens.spacing.page,
                          right: safe.right + semanticTokens.spacing.page,
                        }}
                      >
                        <Text
                          style={{
                            ...hudText,
                            textAlign: 'center',
                            fontSize: componentTokens.focusArrival.fontSize,
                            lineHeight: componentTokens.focusArrival.lineHeight,
                            fontWeight: componentTokens.focusArrival.fontWeight,
                          }}
                        >
                          {t('focusFlow.spot.pickPrompt')}
                        </Text>
                      </View>
                      {/* 하단 [집중 시작]: 지금 선 자리에서 집중할 수 있는지 검사해 준비 카드를 연다 */}
                      <View
                        testID="focus-start-bar"
                        pointerEvents="box-none"
                        style={{
                          position: 'absolute',
                          bottom: safe.bottom + semanticTokens.spacing.page,
                          left: safe.left + semanticTokens.spacing.page,
                          right: safe.right + semanticTokens.spacing.page,
                          alignItems: 'center',
                        }}
                      >
                        <FiButton
                          title={t('focusFlow.spot.start')}
                          id="focus-start"
                          primary
                          onPress={startHere}
                        />
                      </View>
                    </>
                  )
                : undefined
          }
          goldenFish={goldenFish}
        >
          {(size, sizeY, zoom) => {
            // 머리 위 과목·시간표가 겹치면 뒤(위쪽) 것을 숨긴다: 내 표시가 먼저, 그다음 앞(아래)쪽.
            // 1배 미만으로 줄이면 다른 주민은 이름만.
            const shown = new Set<string>(),
              kept: ReturnType<typeof labelBox>[] = [];
            [
              ...(seated && mySubject != null
                ? [{ id: 'me', spot: mine, subject: mySubject }]
                : []),
              ...(zoom < 1
                ? []
                : peers
                    .map((actor) => ({
                      id: actor.key,
                      spot: actor.spot,
                      subject: actor.subject ?? '',
                    }))
                    .sort((a, b) => b.spot.y - a.spot.y)),
            ].forEach((l) => {
              const b = labelBox(l.spot, l.subject, size, sizeY);
              if (
                kept.some(
                  (k) =>
                    !(
                      k.right <= b.left ||
                      b.right <= k.left ||
                      k.bottom <= b.top ||
                      b.bottom <= k.top
                    ),
                )
              )
                return;
              kept.push(b);
              shown.add(l.id);
            });
            return (
              <>
                {focusing && (
                  <FishingFocusHud
                    subject={s.session!.subject}
                    seconds={sessionSeconds(s.session, e.now)}
                    size={size}
                    sizeY={sizeY}
                    textStyle={hudText}
                  />
                )}
                {peers.map((actor) => {
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
                      emote={emoteByUser.get(actor.userId) ?? null}
                      reduce={reduce}
                      goldenFishCount={goldenFor(actor.userId, actor.sessionId)?.count ?? 0}
                      goldenCatchToken={goldenFor(actor.userId, actor.sessionId)?.eventId}
                      onEntered={peerFlow.entered}
                      onCast={peerFlow.cast}
                      onPausedExit={peerFlow.leftForPause}
                      onStretch={peerFlow.stretched}
                      onCompletedExit={peerFlow.leftForComplete}
                      onPress={
                        (r === 'focus' || r === 'fishingArrival') && !dialog
                          ? () => setCatInfo({ actor, outfit })
                          : undefined
                      }
                    />
                  );
                })}
                {seated ? (
                  <FishingActor
                    spot={mine}
                    size={size}
                    sizeY={sizeY}
                    color={s.color}
                    name={ownCatName(s.name)}
                    me
                    subject={shown.has('me') ? mySubject : null}
                    seconds={
                      r === 'focusResult'
                        ? (result?.seconds ?? 0)
                        : sessionSeconds(s.session, e.now)
                    }
                    emote={
                      focusing
                        ? liveIslandId
                          ? (emoteByUser.get(myId ?? '') ?? null)
                          : emote
                        : null
                    }
                    motion={
                      r === 'focusSetup'
                        ? 'tilt'
                        : r === 'focusResult'
                          ? 'stretch'
                          : tutorialReeling
                            ? 'reel'
                            : undefined
                    }
                    reduce={reduce}
                    goldenFishCount={goldenFor(actorUserId, goldenSessionId)?.count ?? 0}
                    tutorialFish={s.session?.tutorialFish === true}
                    caughtFish={
                      r === 'focusResult'
                        ? result?.fish
                        : experience
                          ? s.session?.tutorialFish
                            ? 1
                            : 0
                          : undefined
                    }
                    goldenCatchToken={goldenFor(actorUserId, goldenSessionId)?.eventId}
                    catchAvoidSpots={peerSpots}
                    catchVisibleSpots={peerCatchSpots}
                    catchGramVisible={i.buildings.includes('gram')}
                    outfit={myOutfit}
                  />
                ) : (
                  <FishingWalker
                    p={walker.p}
                    size={size}
                    sizeY={sizeY}
                    color={s.color}
                    walking={walker.walking}
                    left={walker.left}
                    reduce={reduce}
                    outfit={myOutfit}
                    name={ownCatName(s.name)}
                  />
                )}
              </>
            );
          }}
        </FishingIsland>
        {r === 'fishingArrival' && !(tutorialStep >= 5 && tutorialStep <= 21) && (
          <View
            pointerEvents="box-none"
            {...a11yHidden(!!catInfo)}
            style={{
              position: 'absolute',
              top: safe.top + semanticTokens.spacing.control,
              left: safe.left + semanticTokens.spacing.page,
              right: safe.right + semanticTokens.spacing.page,
              gap: semanticTokens.spacing.control,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <FiButton
              title={t('focusFlow.spot.backToMainIsland')}
              id="leave-fishing-arrival"
              onPress={returnFromArrival}
              style={{ flexShrink: 1 }}
              multiline
            />
            {Platform.OS !== 'web' && !experience && (
              <VerificationToggle
                onBlockingConfigured={async () => {
                  if (!(await syncFocusShield(s.session, s.color, true)))
                    throw new Error('shield setup failed');
                }}
                onAndroidSetup={() => e.go('permission', 'measured-apps')}
                onMeasurementReady={(minutes, days) => {
                  e.dispatch({ type: 'SCREEN_TIME_UNCONFIRMED', days });
                  e.dispatch({ type: 'SETTING', key: 'screenTimeMeasurementReady', value: true });
                  e.dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: true });
                  e.dispatch({ type: 'SCREEN_TIME', value: minutes });
                }}
                onBlockingPermissionChange={(approved) =>
                  e.dispatch({ type: 'SETTING', key: 'permission', value: approved })
                }
                onPreviewChange={setVerificationPreviewOpen}
                onPlacementHintChange={setVerificationPlacementHint}
                intro={verificationIntro}
                on={s.settings.studyVerification === true}
                cameraPosition={s.settings.studyVerificationCamera}
                onChange={(value, position) => {
                  e.dispatch({ type: 'SETTING', key: 'studyVerificationCamera', value: position });
                  e.dispatch({ type: 'SETTING', key: 'studyVerification', value });
                }}
              />
            )}
          </View>
        )}
        {Platform.OS !== 'web' &&
          !experience &&
          r === 'fishingArrival' &&
          !(tutorialStep >= 5 && tutorialStep <= 21) && (
            <View
              pointerEvents="box-none"
              {...a11yHidden(!!catInfo || !!dialog)}
              style={{
                position: 'absolute',
                top:
                  safe.top +
                  semanticTokens.spacing.control * 2 +
                  componentTokens.verificationSetup.buttonSize,
                left: safe.left + semanticTokens.spacing.page,
              }}
            >
              <VerificationSpike
                enabled={s.settings.studyVerification === true}
                previewVisible={verificationPreviewOpen}
                onCameraPositionChange={(position) =>
                  e.dispatch({ type: 'SETTING', key: 'studyVerificationCamera', value: position })
                }
                cameraPosition={s.settings.studyVerificationCamera}
                textStyle={hudText}
              />
            </View>
          )}
        {liveIslandId && live.status === 'error' && (
          <View
            {...a11yHidden(!!catInfo)}
            style={{
              position: 'absolute',
              zIndex: 5,
              ...(r === 'fishingArrival'
                ? { bottom: safe.bottom + semanticTokens.spacing.page }
                : { top: Math.max(56, safe.top + 8) }),
              left: Math.max(18, safe.left + 8),
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('focusFlow.hud.residentsReloadA11y')}
              onPress={live.retry}
              style={{
                minHeight: 44,
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: OUTLINE,
                borderRadius: 14,
                backgroundColor: '#FFFDFAD9',
                paddingHorizontal: 12,
              }}
            >
              <Text style={{ fontSize: 12, lineHeight: 19.2, fontWeight: '800', color: INK }}>
                {t('focusFlow.hud.residentsLoadFailed')}
              </Text>
            </Pressable>
          </View>
        )}
        {focusing && (
          <>
            {Platform.OS !== 'web' && !experience && !(tutorialStep >= 5 && tutorialStep <= 21) && (
              <View
                pointerEvents="box-none"
                {...a11yHidden(!!dialog || !!goldenCutscene || !!catInfo)}
                style={{
                  position: 'absolute',
                  zIndex: 5,
                  top: safe.top + semanticTokens.spacing.control,
                  left: Math.max(18, safe.left),
                }}
              >
                <VerificationSpike
                  key={s.session!.id}
                  sessionId={s.session!.id}
                  enabled={s.settings.studyVerification === true}
                  previewVisible={verificationPreviewOpen}
                  onCameraPositionChange={(position) =>
                    e.dispatch({ type: 'SETTING', key: 'studyVerificationCamera', value: position })
                  }
                  textStyle={hudText}
                  cameraPosition={s.settings.studyVerificationCamera}
                />
              </View>
            )}
            {Platform.OS !== 'web' && !experience && !(tutorialStep >= 5 && tutorialStep <= 21) && (
              <View
                testID="focus-camera-toggle"
                {...a11yHidden(!!dialog || !!goldenCutscene || !!catInfo)}
                style={{
                  position: 'absolute',
                  zIndex: 5,
                  top: safe.top + semanticTokens.spacing.control,
                  right: safe.right + semanticTokens.spacing.page,
                }}
              >
                <VerificationToggle
                  onBlockingConfigured={async () => {
                    if (!(await syncFocusShield(s.session, s.color, true)))
                      throw new Error('shield setup failed');
                  }}
                  onAndroidSetup={() => e.go('permission', 'measured-apps')}
                  onMeasurementReady={(minutes, days) => {
                    e.dispatch({ type: 'SCREEN_TIME_UNCONFIRMED', days });
                    e.dispatch({ type: 'SETTING', key: 'screenTimeMeasurementReady', value: true });
                    e.dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: true });
                    e.dispatch({ type: 'SCREEN_TIME', value: minutes });
                  }}
                  onBlockingPermissionChange={(approved) =>
                    e.dispatch({ type: 'SETTING', key: 'permission', value: approved })
                  }
                  onPreviewChange={setVerificationPreviewOpen}
                  onPlacementHintChange={setVerificationPlacementHint}
                  inSession
                  intro={verificationIntro}
                  on={s.settings.studyVerification === true}
                  cameraPosition={s.settings.studyVerificationCamera}
                  onChange={(value, position) => {
                    e.dispatch({
                      type: 'SETTING',
                      key: 'studyVerificationCamera',
                      value: position,
                    });
                    e.dispatch({ type: 'SETTING', key: 'studyVerification', value });
                  }}
                />
              </View>
            )}
            <View
              {...a11yHidden(!!dialog || !!goldenCutscene || !!catInfo)}
              style={{
                position: 'absolute',
                zIndex: 5,
                bottom: wide ? Math.max(18, safe.bottom) : Math.max(36, safe.bottom + 4),
                ...(wide
                  ? { right: Math.max(24, safe.right), width: 340 }
                  : { left: Math.max(18, safe.left), right: Math.max(18, safe.right) }),
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <EmoteFab fan={fan} setFan={setFan} emote={emote} onSend={sendEmote} />
              <View
                ref={pauseTarget.ref}
                collapsable={false}
                onLayout={pauseTarget.measure}
                style={{ flex: 1 }}
              >
                <FiButton
                  primary
                  title={t('focusFlow.common.pauseFocus')}
                  id="pause-focus"
                  onPress={pause}
                />
              </View>
              <View
                ref={endTarget.ref}
                collapsable={false}
                onLayout={endTarget.measure}
                style={{ flex: 1 }}
              >
                <FiButton
                  title={t('focusFlow.common.endFocus')}
                  id="end-focus"
                  key={s.session?.id}
                  holdToConfirm
                  haptics={s.settings.haptics}
                  onPress={finish}
                />
              </View>
            </View>
          </>
        )}
        {verificationPlacementHint &&
          s.settings.studyVerification &&
          !dialog &&
          !catInfo &&
          !goldenCutscene && (
            <View
              testID="verification-placement-hint"
              pointerEvents="none"
              accessibilityLiveRegion="polite"
              style={{
                position: 'absolute',
                zIndex: 6,
                bottom: safe.bottom + componentTokens.verificationIntro.placementHintBottom,
                left: safe.left + semanticTokens.spacing.page,
                right: safe.right + semanticTokens.spacing.page,
                backgroundColor: semanticTokens.color.text,
                borderRadius: semanticTokens.radius.control,
                padding: semanticTokens.spacing.component,
              }}
            >
              <Text
                style={{
                  color: semanticTokens.color.surface,
                  textAlign: 'center',
                  fontSize: semanticTokens.typography.body,
                }}
              >
                {t('verification.setup.placementHint')}
              </Text>
            </View>
          )}
        {musicModal}
        {r === 'focusResult' && !leg && !goldenReeling && resultModal}
        {!leg && !goldenReeling && rewardModal}
        {catInfo && <FishingCatInfo target={catInfo} onClose={() => setCatInfo(null)} />}
      </View>
      {goldenCutsceneOverlay}
    </TutorialScene>
  );
}
