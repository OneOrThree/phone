import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  StyleSheet,
  useWindowDimensions,
  AppState,
  BackHandler,
  Platform,
  Vibration,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type TextStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { captureRef } from 'react-native-view-shot';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import { AnimatedCharacter } from '@/components/character/AnimatedCharacter';
import { CharacterImage } from '@/components/character/CharacterImage';
import { PressableScale } from '@/components/PressableScale';
import { M, fadeIn, pop, transition } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { T, withAlpha } from '@/constants/theme';
import { t } from '@/i18n';
import { type SessionMachineConfig, type SessionState } from './engine/machine';
import { createFocusSessionEngine } from './engine/FocusSessionEngine';
import ScreenTimeModule, { type FocusActivityState } from '@/services/ScreenTimeModule';
import { useFocus } from '@/store/FocusContext';
import { useCoins } from '@/store/CoinContext';
import { useSubjects } from '@/store/SubjectContext';
import { useUser } from '@/store/UserContext';
import { useCharacter } from '@/store/CharacterContext';
import { STORAGE_KEYS } from '@/types/storage';
import type { V2RootStackParamList } from '@/navigation/types';
import type { FocusTimerMode } from './types';
import { hms } from './format';
import { focusReadoutLayout, PLAIN_TIMER_MIN_FONT_SCALE } from './readoutLayout';
import { cancelLeaveNotifications } from './leaveNotifications';
import { kstLocalSameDay, todayStr, todayStrKst } from '@/utils/localDate';
import { blockTodaySeconds, blockKstTodaySeconds } from './blockToday';
import { myLiveTotalSeconds } from '@/utils/liveFocus';
import { useFocusFriends } from '@/screens/league/useFocusFriends';
import { useOccupationName } from '@/services/occupationCatalog';
import { useSessionLeagueMembers } from './useSessionLeagueMembers';
import { useSessionGroups } from './useSessionGroups';
import { LiveFocusGrid } from './components/LiveFocusGrid';
import { FocusMenuDrawer } from './components/FocusMenuDrawer';
import { FocusLandscape } from './FocusLandscape';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
import {
  logFocusSessionStarted,
  logFocusMenuOpened,
  logFocusViewChanged,
  logFocusOrientationChanged,
  subjectKeyOf,
  type FocusViewName,
} from '@/services/analyticsEvents';
import {
  consumeCardInteraction,
  FOCUS_ATTRIBUTION_TTL_MS,
  invalidateCardInteraction,
  normalizeFocusEntrySource,
} from '@/services/cardInteraction';

// 06/07/08 집중 세션(세로) + 09 친구 그리드(좌우 페이저) + 10/11 메뉴 드로어.
// 타이머는 실제로 tick하고, 정지 시 집중시간·코인·세션 POST를 반영한다(구 FocusMode 로직 이식).
// 다크 화면 색은 T.night 팔레트 사용.
//
// 세션 실드(GROMO-553) — 세션 동안 허용앱 외 모든 앱을 차단(ManagedSettings).
// 실드가 켜진 세션은 앱 밖에 있어도 딴짓이 차단되므로 자리 비운 시간을 '집중으로 인정':
//   복귀 시 away 초만큼 타이머를 전진(fast-forward, 상한 8시간). 이탈 알림·자동 종료 없음.
// 실드 불가(스크린타임 권한 거부) 세션만 기존 이탈 정책 폴백:
//   나가면 일시정지(미적립), 15초 안에 복귀하면 이어감, 초과 시 자동 종료. 알림 즉시+15초.
// 수동 일시정지 중 이탈은 무시, 뽀모도로 휴식 중 이탈은 벽시계만큼 휴식만 소진.
// 짧은 진동 2번 — 패턴 의미가 플랫폼별로 다르다(코덱스 리뷰): iOS는 진동 길이 고정에
// 배열=진동 사이 간격([0,500]=2번), Android는 [대기,진동] 교대라 [0,500]이 1번 500ms가 된다.
const DOUBLE_VIBRATE_PATTERN = Platform.OS === 'android' ? [0, 400, 200, 400] : [0, 500];
// 페이지 인덱스 → 뷰 정체성(GROMO-987) — 아래 페이저 JSX의 렌더 순서와 반드시 일치시킬 것.
// 계측(focus_view_changed)은 인덱스가 아니라 이 뷰 이름으로 발행한다 — 스와이프 순서가
// 또 바뀌어도(985 참고) 이 배열만 함께 고치면 GA4 측정기준 값은 그대로 유지된다.
// 페이지 인덱스 → 뷰 이름(뷰 체류 계측 GROMO-987). 그룹 페이지가 동적(참여 그룹 수)이라 고정 배열
// 대신 개수로 계산한다. 순서: [캐릭터][친구][그룹×N][내 리그=같은 시험][전체 리그].
function viewForPage(index: number, groupCount: number): FocusViewName {
  if (index <= 0) return 'character';
  if (index === 1) return 'friends';
  if (index < 2 + groupCount) return 'groups';
  if (index === 2 + groupCount) return 'my_league';
  return 'all_league';
}
// 가로 뷰(GROMO-973)는 iOS 전용 — 안드로이드는 미검증이라 방향 잠금 해제·가로 버튼·가로 렌더를
// 막는다(코덱스 리뷰). expo-screen-orientation은 안드로이드에서도 액티비티 방향을 바꿔 매니페스트의
// 초기 세로 설정을 덮으므로, 플랫폼으로 명시적으로 게이트하지 않으면 미검증 가로 UI가 노출된다.
const LANDSCAPE_ENABLED = Platform.OS === 'ios';

// ── 렌더 계층 전용 상수(GROMO-1381) — 아래 세션 로직과 무관하다 ──────────────────────
// 페이저 도트 — 활성 알약(너비 7→18)과 색이 값 변화를 부드럽게 따라가게 한다.
const DOT_TRANSITION = transition({
  property: ['width', 'backgroundColor'],
  duration: M.dur.quick,
});

// 세션 상태 전이는 engine/machine.ts의 순수 계층으로 이관됐다(GROMO-1600 1단계) —
// 화면은 config를 만들어 위임만 한다.

export default function FocusSessionScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { params } = useRoute<RouteProp<V2RootStackParamList, 'FocusSession'>>();
  const { subjectId, subjectName, mode } = params;
  const entrySource = normalizeFocusEntrySource(params.entrySource);
  const interactionId = entrySource === 'group_card' ? params.interactionId : undefined;
  const interactionAcceptedAt =
    entrySource === 'group_card' ? params.interactionAcceptedAt : undefined;
  const goal = params.goalSeconds ?? 25 * 60;
  const pomo = params.pomodoro ?? { focusMin: 25, breakMin: 5, sets: 4 };

  const { width, height, fontScale } = useWindowDimensions();
  // 세로 레이아웃 예산 계산용 — 노치·홈 인디케이터를 뺀 실제 가용 높이를 알아야 한다(아래 uiScale).
  const insets = useSafeAreaInsets();
  // 가로 판별 — 방향 전환에 따라 렌더만 분기한다(세션 로직은 방향과 무관, GROMO-973).
  const isLandscape = width > height;
  // 모션 게이트('동작 줄이기') — 이 화면에서는 렌더 계층에서만 쓴다(GROMO-1381).
  const m = useMotion();
  const { userId, nickname, occupation: myOccupation } = useUser();
  const { addFocusSeconds, todayFocusSeconds } = useFocus();
  const { refresh: refreshCoins } = useCoins();
  const { subjects, addFocusToSubject } = useSubjects();
  // 장착된 커스텀(누끼) 캐릭터 URI — 있으면 세션·스냅샷 캡처에 반영, 없으면 기존 study 포즈 유지.
  const { activeSource } = useCharacter();
  // Live Activity 시작 시점에 읽을 과목 목록 — effect 재실행 없이 최신값 참조용
  const subjectsRef = useRef(subjects);
  subjectsRef.current = subjects;
  // 마커 취소·대기열 재시도에 실어 보낼 소유 계정(GROMO-1214 코드리뷰 2차) — 취소 대기열이 계정
  // 스코프를 갖게 되면서 필요해졌다. ref로 두는 이유: cancelLiveSession·finish 같은 안정 콜백의
  // 의존성에 userId를 넣으면 세션 중 계정이 바뀔 때 언마운트 클린업이 돌아 마커가 조기 취소된다.
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const [page, setPage] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 완료 게이트(GROMO-864) — 카운트다운 종료 시 결과 화면 직행 대신 확인을 받는다
  const [doneGate, setDoneGate] = useState(false);
  // 친구 전체 라이브 상태 — 60초 폴링·포그라운드 복귀 갱신 (09 친구 그리드 실데이터).
  // pinnedIds는 그리드 3종 공통 핀 우선 정렬용(932) — 리그 그리드도 같은 집합을 쓴다.
  const { friends: sessionFriends, pinnedIds } = useFocusFriends();
  // 리그(811)·같은 시험(812) 그리드 라이브 멤버 — 서버의 내 행은 제외하고, 내 셀은 로컬
  // 타이머 기준으로 그리드가 따로 렌더한다(GROMO-932, 아래 myGridMe) — 중복·시차 방지
  const myExamName = useOccupationName(myOccupation); // 같은 시험 그리드 타이틀용 표시명
  const { members: leagueMembers } = useSessionLeagueMembers({ excludeUserId: userId });
  const { members: examMembers } = useSessionLeagueMembers({
    occupation: myOccupation ?? undefined,
    enabled: myOccupation != null,
    excludeUserId: userId,
  });
  // 그룹 뷰(F2) — 내가 참여한 '그룹별로' 한 페이지씩. 각 그룹의 내 행은 제외하고 내 셀은 그리드가
  // 로컬 타이머로 따로 렌더한다(me). 라이브 집중중 신호는 group detail에 없어 오늘 집중분만 정적 표기한다.
  const { groups: sessionGroups, myFocus } = useSessionGroups({ excludeUserId: userId });
  // 그룹 페이지 개수 — 페이저 점·뷰 계측이 동적 페이지 수를 알아야 해서 ref로 최신값을 들고 있는다.
  const groupCountRef = useRef(0);
  groupCountRef.current = sessionGroups.length;
  // 상태 머신 설정 — machine.ts 순수 계층의 입력. 라우트 파라미터는 세션 중 불변이다.
  // ⚠️ deps는 스칼라로 — params.pomodoro 부재 시 pomo가 렌더마다 새 객체(?? 기본값)라
  //    객체 참조를 걸면 config 재생성 → 틱 이펙트가 매 렌더 재구독된다(원본 nextTick과 동일 규칙).
  const machineConfig = useMemo<SessionMachineConfig>(
    () => ({ mode, goalSeconds: goal, pomodoro: pomo }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, goal, pomo.focusMin, pomo.breakMin, pomo.sets],
  );
  // 세션 상태·틱의 소유자는 엔진(GROMO-1600 2단계) — 화면은 구독하는 뷰다.
  // isPaused/onFocusTick은 콜백 주입: 정지 상태와 오늘 몫 적립은 아직 화면 소유(후속 단계 이관).
  // 라이브 레코드의 소유 표식 — 과목 변경(라우트 갱신)·계정 전환을 따라가야 하므로 렌더 미러.
  const liveIdentityRef = useRef({ subjectId, subjectName, userId });
  liveIdentityRef.current = { subjectId, subjectName, userId };
  // 로컬 적립·코인 재조회 delegate — 훅이 주는 함수라 렌더 미러로 최신 참조를 넘긴다(4단계).
  const settleDelegatesRef = useRef({ addFocusSeconds, addFocusToSubject, refreshCoins });
  settleDelegatesRef.current = { addFocusSeconds, addFocusToSubject, refreshCoins };
  const engine = useMemo(
    () =>
      createFocusSessionEngine(machineConfig, {
        identity: () => liveIdentityRef.current,
        settleDelegates: () => settleDelegatesRef.current,
        // 세션 전 오늘 누적 — 마운트 시점 값으로 고정(화면 시절 gridPreSessionRef 초기값과 동일)
        preSessionTodaySeconds: todayFocusSeconds,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [machineConfig],
  );
  // 구독은 useState 브리지로 — useSyncExternalStore의 「통지 즉시 동기 렌더」는 같은
  // 프레임의 다른 마이크로태스크(캡처 재개 등)가 미표시 tick을 선관측하게 만든다. setState는
  // 스케줄러 배칭(매크로태스크 렌더)이라 화면 시절과 관측 타이밍이 동일하다(특성화가 잡은 차이).
  const [viewState, setViewState] = useState(() => ({
    session: engine.getSession(),
    paused: engine.isPausedState(),
  }));
  useEffect(
    () =>
      engine.subscribe(() =>
        setViewState({ session: engine.getSession(), paused: engine.isPausedState() }),
      ),
    [engine],
  );
  const { session, paused } = viewState;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const pageRef = useRef(page);
  pageRef.current = page;
  // 현재 보고 있는 뷰 이름을 '진입 시점'에 고정(GROMO-987) — 그룹 페이지가 동적이라 체류 중 그룹
  // 수가 바뀌어도 viewForPage 재계산으로 옛 체류가 다른 뷰에 잘못 귀속되지 않게 한다(코덱스 리뷰).
  const activeViewRef = useRef<FocusViewName>('character');
  // 뷰 체류 계측(GROMO-987) — 현재 뷰 진입 시각. 페이지 전환·세션 종료 때 직전 뷰의 체류를
  // 발행하고 기준을 리셋한다. 백그라운드 이탈 구간은 화면을 보고 있는 게 아니므로 체류에서
  // 차감한다(누적 away + 아직 복귀 전인 진행 중 구간까지 — 이탈 타임아웃 종료 flush 대비).
  const viewEnteredAtRef = useRef(Date.now());
  const dwellAwayMsRef = useRef(0);
  const dwellLeftAtRef = useRef<number | null>(null);
  // 완료 게이트에서 마지막 체류를 이미 발행했는지 — finish/언마운트의 재발행을 막는다(코덱스 리뷰)
  const dwellDoneRef = useRef(false);
  const flushViewDwell = useCallback(() => {
    const now = Date.now();
    const awayMs =
      dwellAwayMsRef.current + (dwellLeftAtRef.current != null ? now - dwellLeftAtRef.current : 0);
    const dwellSeconds = Math.max(0, Math.round((now - viewEnteredAtRef.current - awayMs) / 1000));
    viewEnteredAtRef.current = now;
    dwellAwayMsRef.current = 0;
    if (dwellLeftAtRef.current != null) dwellLeftAtRef.current = now;
    logFocusViewChanged({
      view: activeViewRef.current,
      dwell_seconds: dwellSeconds,
    });
  }, []);
  // 방향 체류 계측(GROMO-973) — 세로/가로 각각 얼마나 오래 집중하는지. 방향 전환·세션 종료 때
  // 직전 방향의 체류를 발행한다(뷰 체류와 같은 방식). 뷰 체류처럼 백그라운드·비활성 구간은
  // 화면을 보는 게 아니므로 차감한다 — 안 빼면 실드 세션이 오래 백그라운드에 있다 정지할 때 그
  // 시간이 통째로 마지막 방향의 체류로 잡혀 지표가 오염된다(코덱스 리뷰). 뷰 체류와 달리 가로/세로
  // 모두 '보이는' 상태이므로 away는 오직 이탈(백그라운드) 구간만 — 전용 마커로 따로 센다.
  const orientationRef = useRef<'portrait' | 'landscape'>('portrait');
  const orientEnteredAtRef = useRef(Date.now());
  const orientAwayMsRef = useRef(0);
  const orientLeftAtRef = useRef<number | null>(null);
  const flushOrientationDwell = useCallback(() => {
    const now = Date.now();
    const awayMs =
      orientAwayMsRef.current +
      (orientLeftAtRef.current != null ? now - orientLeftAtRef.current : 0);
    const dwellSeconds = Math.max(
      0,
      Math.round((now - orientEnteredAtRef.current - awayMs) / 1000),
    );
    orientEnteredAtRef.current = now;
    orientAwayMsRef.current = 0;
    if (orientLeftAtRef.current != null) orientLeftAtRef.current = now;
    logFocusOrientationChanged({
      orientation: orientationRef.current,
      dwell_seconds: dwellSeconds,
    });
  }, []);
  // 체류 시계 일시정지 — 아래 이탈 감지 이펙트보다 먼저 구독해야 복귀 시 away 구간이 먼저
  // 누적되고, 뒤이은 이탈 타임아웃 finish의 flush가 차감된 값을 읽는다(구독 순서 = 선언 순서).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      // iOS는 알림 센터·앱 전환기 등으로 화면이 가려지면 background 없이 inactive에 머문다 —
      // 그 시간도 뷰를 보는 게 아니므로 이탈로 취급(코덱스 리뷰). inactive→background로
      // 이어져도 아래 null 가드로 시작 시각은 처음 한 번만 찍힌다.
      if (state === 'background' || state === 'inactive') {
        const now = Date.now();
        if (dwellLeftAtRef.current == null) dwellLeftAtRef.current = now;
        if (orientLeftAtRef.current == null) orientLeftAtRef.current = now;
      } else if (state === 'active') {
        const now = Date.now();
        // 방향 체류: 화면은 가로/세로 모두 보이므로 복귀 즉시 이탈 구간을 닫는다(백그라운드만 제외).
        if (orientLeftAtRef.current != null) {
          orientAwayMsRef.current += now - orientLeftAtRef.current;
          orientLeftAtRef.current = null;
        }
        // 뷰 체류: 복귀했어도 아직 가로면 세로 페이저는 계속 가려진 상태 — 세로로 돌아온
        // 뒤에 이탈 구간을 닫는다(가로 구간은 아래 방향 전환 이펙트가 away로 흡수, 코덱스 리뷰).
        if (dwellLeftAtRef.current != null && orientationRef.current === 'portrait') {
          dwellAwayMsRef.current += now - dwellLeftAtRef.current;
          dwellLeftAtRef.current = null;
        }
      }
    });
    return () => sub.remove();
  }, []);
  // 정산 장부·마커·그리드 기준점은 엔진 소유(GROMO-1600 4단계) — 화면은 엔진 API를 부른다.
  const sessionStartedLoggedRef = useRef(false);

  // 집중 세션 시작 계측(GROMO-537) — 실제 세션 화면 진입 시 1회.
  // has_tag: 과목 부착 여부(현재 v2는 과목 선택이 필수라 항상 true지만, 계약상 명시). mode: 타이머 모드.
  // 완료(focus_session_completed)는 finish가 발행한다(GROMO-1004 — 서버[S]에서 클라 소유로 이관).
  useEffect(() => {
    if (sessionStartedLoggedRef.current) return;
    sessionStartedLoggedRef.current = true;
    if (AppState.currentState === 'background' || AppState.currentState === 'inactive') {
      invalidateCardInteraction(interactionId);
    }
    const attributedInteractionId = consumeCardInteraction(
      { entrySource, interactionId, interactionAcceptedAt },
      FOCUS_ATTRIBUTION_TTL_MS,
    );
    // 목표 시간(초→분): 카운트다운=목표, 뽀모도로=집중블록×세트 총 집중분. 카운트업은 목표 없음.
    const goalSecondsForLog =
      mode === 'countdown'
        ? goal
        : mode === 'pomodoro'
          ? pomo.focusMin * pomo.sets * 60
          : undefined;
    logFocusSessionStarted({
      has_tag: Boolean(subjectId),
      mode,
      goal_minutes: goalSecondsForLog != null ? Math.round(goalSecondsForLog / 60) : undefined,
      entry_source: entrySource,
      subject_key: subjectKeyOf(subjectId),
      interaction_id: attributedInteractionId,
    });
  }, [
    subjectId,
    mode,
    goal,
    pomo.focusMin,
    pomo.sets,
    entrySource,
    interactionId,
    interactionAcceptedAt,
  ]);

  // 세션 진입 시 첫 마커 등록 — 이후 블록 정산마다 닫히고(마커 회전, settleFocusBlock 참고),
  // 뽀모도로는 휴식이 끝나는 break→focus 경계에서 다음 블록 마커를 새로 연다.
  const liveStartedOnceRef = useRef(false);
  useEffect(() => {
    if (liveStartedOnceRef.current) return;
    liveStartedOnceRef.current = true;
    engine.startLiveSession(engine.sessionStartedAt());
  }, [engine]);

  // 1초 tick — 엔진 소유(GROMO-1600 2단계). 화면 생명주기와 함께 시작·정지.
  useEffect(() => {
    engine.startTicking();
    return () => engine.stopTicking();
  }, [engine]);

  // 라이브 레코드 저장은 엔진 소유(GROMO-1600 3단계) — 5초 주기는 엔진 틱 내부,
  // 즉시 저장이 필요한 순간(백그라운드 진입·실드 복귀 전진)은 persistLiveRecord를 직접 부른다.

  // 세션 실드 — 시작 시 허용앱 외 전부 차단, 화면을 떠날 때 해제(멱등, finish에서도 해제).
  // 적용 성공 여부(shielded)로 이탈 정책이 갈린다: 실드 O = 집중 인정 / 실드 X = 15초 정책.
  // 과목 변경 시엔 stop 없이 start만 다시 호출한다(같은 스토어를 덮어씀) — 중간에 stop을
  // 끼우면 다음 start까지 모든 차단이 풀리는 무방비 구간이 생긴다.
  useEffect(() => {
    engine.applyShield(subjectName);
  }, [engine, subjectName]);
  // 해제는 화면을 떠날 때 한 번만
  useEffect(() => () => engine.releaseShield(), [engine]);

  // LA 페이로드는 「마지막 렌더 시점」 상태를 읽는다 — 엔진 상태(즉시)가 아니라 렌더 미러.
  // 600ms 캡처 콜백은 렌더 밖에서 돌므로, 엔진을 직접 읽으면 같은 프레임의 미표시 tick이
  // 페이로드에 선반영돼 화면 표시와 어긋난다(엔진 이관 때 특성화가 잡은 차이).
  const renderedSessionRef = useRef(session);
  renderedSessionRef.current = session;
  // LA 페이로드 조립은 엔진(revision 소유) — 시간은 렌더 미러 기준(위 주석 참고).
  const buildActivityState = useCallback(
    (): FocusActivityState => engine.buildActivityState(renderedSessionRef.current),
    [engine],
  );

  // Live Activity(다이나믹 아일랜드) — 캐릭터 스냅샷을 App Group에 저장한 뒤 시작.
  // 화면을 떠나면 종료. 스냅샷 실패 시 위젯이 기본 마스코트로 폴백한다.
  const charShotRef = useRef<View>(null);
  useEffect(() => {
    let cancelled = false;
    // 캐릭터가 실제로 그려진 뒤 캡처(마운트 직후엔 빈 프레임일 수 있음)
    const snapshotTimer = setTimeout(async () => {
      try {
        // 캡처가 멈추면(드물지만) Live Activity 시작까지 막히므로 1.5초 타임아웃으로 가드
        const base64 = await Promise.race([
          captureRef(charShotRef, { format: 'png', quality: 1, result: 'base64' }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('capture timeout')), 1500)),
        ]);
        if (!cancelled) await ScreenTimeModule.saveCharacterSnapshot(base64);
      } catch {
        /* 스냅샷 실패/지연 — 위젯은 기본 마스코트로 폴백 */
      }
      if (!cancelled) {
        // 잠금화면에 보여줄 다른 과목들의 누적 집중 시간(세션 중 불변이라 시작 시점 값으로 고정)
        // 공부시간 내림차순 상위 2과목만 전달 — 위젯 표시 상한(2개)과 동일(GROMO-930)
        const others = subjectsRef.current
          .filter((x) => x.id !== subjectId)
          .sort((a, b) => b.accumulatedSeconds - a.accumulatedSeconds)
          .slice(0, 2)
          .map((x) => ({ name: x.name, seconds: x.accumulatedSeconds, color: x.color }));
        ScreenTimeModule.startFocusActivity(subjectName, others, buildActivityState()).catch(
          () => {},
        );
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(snapshotTimer);
      ScreenTimeModule.endFocusActivity().catch(() => {});
    };
  }, [subjectName, subjectId, buildActivityState]);

  // Live Activity 상태 동기화(GROMO-1597) — 정지/재개·뽀모도로 페이즈 전환 때만 밀어 넣고,
  // 그 사이 틱은 위젯의 Text(timerInterval:)가 자체 갱신한다(정지 중 증가하던 부정확 해소).
  // 렌더 뒤에 돌므로 엔진 세션·pausedRef가 이 상태 변화의 최신값이다. 백그라운드 복귀
  // 리플레이가 페이즈를 옮긴 경우도 이 이펙트가 잡는다. 활성 LA가 없으면 네이티브 no-op.
  // 옵셔널 호출인 이유: OTA JS × 구 바이너리 조합에서 이 메서드가 없는 네이티브 모듈과
  // 만날 수 있다(hot-updater 버전 스큐 관행 — ScreenTimeModule.ts의 능력 감지와 같은 부류).
  useEffect(() => {
    if (engine.isFinished() || engine.getSession().done) return;
    ScreenTimeModule.updateFocusActivity?.(buildActivityState()).catch(() => {});
  }, [paused, session.phase, buildActivityState, engine]);

  // finish를 거치지 않는 언마운트(안드로이드 시스템 back 등)에서도 마커를 닫는다 — 안 닫으면
  // 서버 스윕(12h)까지 친구 화면에 '집중 중'으로 남는다(코덱스 리뷰). 정상 종료는 finish/완료
  // 게이트가 이미 취소했으므로 no-op(라이브 참조가 비어 있음). 마지막 뷰 체류도 같은 조건으로
  // flush — finish 경로는 이미 발행했으므로 여기서 또 발행하면 이중 계측이다(GROMO-987).
  useEffect(
    () => () => {
      if (!engine.isFinished()) {
        engine.cancelLiveSession();
        if (!dwellDoneRef.current) {
          // 가로면 세로 페이저는 가려진 상태 — 뷰 flush를 건너뛰고 방향 체류만 발행(코덱스 리뷰)
          if (orientationRef.current !== 'landscape') flushViewDwell();
          flushOrientationDwell();
        }
        // 종결 계측 — finish를 안 거친 이탈도 abandoned로 남긴다(코덱스 리뷰). 안 남기면
        // 이 세션은 완료/포기 어느 쪽도 안 찍혀 상호배타가 깨진다. 시간 적립은 라이브
        // 레코드가 남아 다음 실행의 고아 정산이 처리하므로 여기선 계측만 한다.
        engine.logAbandonedOnce('system_back');
      }
    },
    [flushViewDwell, flushOrientationDwell, engine],
  );

  // 정지/완료는 엔진 명령(GROMO-1600 5단계) — 뷰 계측 flush·LA 종료만 훅으로 끼우고,
  // 결과 파라미터를 받아 화면이 결과 화면으로 replace한다(재진입은 null — 이동 없음).
  const finish = useCallback(
    async (completed?: boolean) => {
      const result = await engine.finish(completed, {
        flushViewInstrumentation: () => {
          // 완료 게이트가 이미 발행했다면 건너뛴다 — 게이트를 열어둔 시간이 직전 뷰/방향의
          // 체류로 다시 계상되는 이중 발행 방지(코덱스 리뷰).
          if (!dwellDoneRef.current) {
            // 가로면 세로 페이저는 가려진 상태 — 뷰 flush를 건너뛰고 방향 체류만 발행(코덱스 리뷰)
            if (orientationRef.current !== 'landscape') flushViewDwell();
            flushOrientationDwell();
          }
        },
        endLiveActivity: () => {
          ScreenTimeModule.endFocusActivity().catch(() => {});
        },
      });
      if (result == null) return;
      // 정산 성공 여부와 무관하게 화면은 반드시 빠져나간다 — 집중 결과 화면(GROMO-598)으로
      // replace, 길이 무관 항상 결과 화면을 보여준다.
      navigation.replace('FocusResult', { ...result, subjectId, subjectName });
    },
    [engine, flushViewDwell, flushOrientationDwell, navigation, subjectId, subjectName],
  );

  // 완료 게이트는 이미 세션을 정산하고 라이브 레코드를 제거한 상태다. Android 하드웨어
  // 뒤로가기가 스택을 pop하면 결과 화면의 스트릭/목표 연출을 건너뛰므로 확인과 같은 경로로 보낸다.
  useEffect(() => {
    if (!doneGate) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      finish();
      return true;
    });
    return () => sub.remove();
  }, [doneGate, finish]);

  // 완료 시 처리(GROMO-864) — 카운트다운/뽀모도로 완료는 결과 화면 직행 대신 완료 게이트를
  // 띄우고 확인을 눌러야 finish로 넘어간다. 실드·Live Activity 해제와 정산(적립+서버 업로드)은
  // 게이트 시점에 바로 한다 — 정산을 확인까지 미루면 게이트에 머문 시간이 서버 세션 구간
  // (endedAt=now)에 집중으로 붙는다(코덱스 리뷰). 셋 다 멱등이라 finish에서 또 불러도
  // 무해하다(정산은 delta 0 no-op).
  useEffect(() => {
    if (!session.done || engine.isFinished()) return;
    if (doneGate) return; // 게이트가 이미 떠 있으면 재실행에도 진동·정산 반복 금지
    setDoneGate(true);
    engine.releaseShield();
    ScreenTimeModule.endFocusActivity().catch(() => {});
    engine.settleFocusBlock();
    // 세션은 이미 끝났으므로 마커도 게이트 시점에 바로 닫는다 — 확인을 누를 때까지 미루면
    // 게이트에 머문 시간만큼 친구 화면에 '집중 중'이 이어져 보인다(코덱스 리뷰). finish에서
    // 또 불려도 라이브 참조가 비어 no-op.
    engine.cancelLiveSession();
    // 마지막 뷰·방향 체류도 게이트가 화면을 덮는 지금 발행 — 확인을 누를 때까지 열어둔 시간은
    // 가려진 뷰를 보거나 방향을 유지하는 게 아니므로 체류에서 제외한다(코덱스 리뷰). finish의 flush는 스킵됨.
    dwellDoneRef.current = true;
    // 가로에선 세로 페이저가 가려져 있고 마지막 페이지 체류는 가로 진입 때 이미 발행됐다 — 여기서 또
    // flush하면 리셋된 character 페이지의 0초 체류가 발행된다(코덱스 리뷰). 방향 체류만 발행한다.
    if (orientationRef.current !== 'landscape') flushViewDwell();
    flushOrientationDwell();
    // 완료 계측도 게이트 시점에 발행 — 게이트를 띄운 채 앱이 종료되면 finish가 안 불려
    // 저장된 세션의 완료 이벤트만 유실된다(코덱스 리뷰). finish에서 또 불려도 가드로 no-op.
    engine.logCompletedOnce();
    Vibration.vibrate(DOUBLE_VIBRATE_PATTERN);
  }, [session.done, doneGate, engine, flushViewDwell, flushOrientationDwell]);

  // 뽀모도로 페이즈 경계 처리는 엔진 소유(GROMO-1600 6단계) — 화면은 전환 신호만 전달.
  useEffect(() => {
    engine.handlePhaseTransition();
  }, [session.phase, engine]);

  // 이탈 감지·복귀 리플레이는 엔진 소유(GROMO-1600 6단계 — D2 보강: 관측 로직의 엔진 이관).
  // AppState 구독은 화면이 유지하고 포워딩한다 — 구독 순서(위 체류 리스너가 먼저)가 동작의
  // 일부라(특성화 고정) 엔진이 직접 구독하면 순서가 깨진다. 자체 구독은 페이즈 1에서.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) =>
      engine.onAppStateChange(state, { onLeaveTimeout: () => finish() }),
    );
    return () => {
      sub.remove();
      cancelLeaveNotifications().catch(() => {});
    };
  }, [engine, finish]);

  // 일시정지/재개 토글은 엔진 명령(GROMO-1600 5단계).
  const togglePause = useCallback(() => engine.togglePause(), [engine]);

  // 정지 버튼(사용자 수동 종료) — 유저가 직접 마친 세션이므로 모드 무관 completed로 계측한다
  // (GROMO-1004, abandoned는 이탈 타임아웃 전용 — finish 안에서 발행). completed 인자는 별점
  // 게이트(GROMO-980) 기준이라 그대로 둔다 — 중도 정지엔 별점창을 띄우지 않는 결정 유지.
  const stopByUser = useCallback(() => {
    // countup은 done이 없어 정지가 유일한 정상 종료 경로 — 완료로 취급한다(별점 게이트용).
    finish(engine.getSession().done || mode === 'countup');
  }, [engine, finish, mode]);

  // 화면 방향 제어(GROMO-973) — 이 화면에 있는 동안만 가로 회전을 허용(자동 회전)하고,
  // 화면을 벗어나면 다시 세로로 고정한다. 앱의 다른 화면은 App.tsx의 전역 세로 잠금을 따른다.
  useEffect(() => {
    if (!LANDSCAPE_ENABLED) return; // 안드로이드는 전역 세로 잠금 유지(코덱스 리뷰)
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT).catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  // 완료 시엔 세로로 되돌린다 — 완료 게이트(확인)는 세로 화면에만 있어 가로에선 안 보인다.
  useEffect(() => {
    if (session.done && LANDSCAPE_ENABLED) {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
  }, [session.done]);

  // 세로↔가로 전환 시 직전 방향의 체류를 발행(GROMO-973)하고, 가로 동안 세로 페이저의 뷰 체류를
  // 멈춘다(GROMO-987). 가로는 세로 ScrollView를 언마운트하므로, 그동안 흐른 시간을 그대로 두면
  // 마지막 페이지(character/friends/league)의 체류로 발행돼 focus_view_changed가 오염된다(코덱스 리뷰).
  useEffect(() => {
    // iOS 전용 기능 — 비-iOS(데스크톱 웹·안드 대화면/멀티윈도우)에선 창이 가로로 넓어도 세로
    // 페이저가 그대로 보이므로, 이 이펙트가 돌면 보이는 페이저를 '가려짐'으로 잘못 표시한다(코덱스 리뷰).
    if (!LANDSCAPE_ENABLED) return;
    const next = isLandscape ? 'landscape' : 'portrait';
    if (orientationRef.current === next) return;
    // 완료 게이트가 이미 마지막 뷰·방향 체류를 발행했다면(dwellDoneRef), 강제 세로 복귀는
    // 재발행하지 않고 방향만 동기화한다 — 게이트 이후 회전이 spurious 이벤트를 내지 않게(코덱스 리뷰).
    if (dwellDoneRef.current) {
      orientationRef.current = next;
      return;
    }
    flushOrientationDwell();
    orientationRef.current = next;
    const now = Date.now();
    if (next === 'landscape') {
      // 가로 진입 — 직전 세로 페이지의 체류를 발행하고, 가로 구간을 뷰 '가려짐'으로 표시한다.
      flushViewDwell();
      if (dwellLeftAtRef.current == null) dwellLeftAtRef.current = now;
      // 세로 복귀 시 페이저는 오프셋 0으로 새로 마운트되는데 page 상태만 남으면 점·계측이
      // 옛 페이지를 가리켜 어긋난다 — 진입 시 0으로 맞춰 복귀 시 일치시킨다(코덱스 리뷰).
      setPage(0);
      pageRef.current = 0;
      activeViewRef.current = 'character';
    } else {
      // 세로 복귀 — 가로(가려짐) 구간을 뷰 이탈로 흡수하고 0페이지 체류를 새로 시작한다.
      if (dwellLeftAtRef.current != null) {
        dwellAwayMsRef.current += now - dwellLeftAtRef.current;
        dwellLeftAtRef.current = null;
      }
    }
  }, [isLandscape, flushOrientationDwell, flushViewDwell]);

  // 회전 버튼 — 세로에선 가로로 고정, 가로에선 세로로 고정(들고 있는 방향과 무관하게 되돌린다).
  const goLandscape = useCallback(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
  }, []);
  const goPortrait = useCallback(() => {
    // 버튼 라벨('세로 화면으로 전환')대로 세로로 강제한다 — DEFAULT는 잠금만 풀어, 폰을 가로로
    // 든 채 누르면 가로가 그대로 유지된다. 완료·정리 경로와 동일하게 PORTRAIT_UP으로 되돌린다(코덱스 리뷰).
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    // 페이지 전환 시 직전 뷰의 체류를 발행(GROMO-987). 같은 페이지로 되돌아온 스크롤은 미계측.
    if (next !== page) flushViewDwell();
    activeViewRef.current = viewForPage(next, groupCountRef.current);
    setPage(next);
  }

  // 그룹방 FAB로 진입(initialGroupId)했으면 그 그룹의 '그룹: {그룹명}' 페이지를 기본으로 연다(F2 Part2).
  // 그룹 목록은 비동기라, 로드되어 해당 그룹을 찾으면 1회만 스크롤한다([캐릭터][친구] 다음이 그룹 시작).
  const pagerRef = useRef<ScrollView>(null);
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    const gid = params.initialGroupId;
    if (gid == null || sessionGroups.length === 0) return;
    const gi = sessionGroups.findIndex((g) => g.groupId === gid);
    if (gi < 0) return;
    // 가로면 세로용 페이저가 언마운트돼 pagerRef가 null — 스크롤 못 하니 완료 처리하지 않고
    // 세로 복귀(width 변경으로 이 이펙트 재실행) 후 재시도한다(코덱스 리뷰).
    if (!pagerRef.current) return;
    const target = 2 + gi;
    didInitialScrollRef.current = true;
    flushViewDwell();
    pagerRef.current.scrollTo({ x: target * width, animated: false });
    activeViewRef.current = viewForPage(target, groupCountRef.current);
    setPage(target);
    pageRef.current = target;
  }, [params.initialGroupId, sessionGroups, width, flushViewDwell]);

  // 첫 세션 사용법 안내(GROMO-652) — 페이저·메뉴·컨트롤을 차례로 설명 (세션은 계속 흐른다)
  const dotsRef = useRef<View | null>(null);
  const hamburgerRef = useRef<View | null>(null);
  const controlsRef = useRef<View | null>(null);
  const guideSteps: GuideStep[] = [
    {
      text: t('focus.session.guide1'),
      character: require('@/assets/character_study.png'),
    },
    {
      text: t('focus.session.guide2'),
      character: require('@/assets/character_happy.png'),
      anchor: dotsRef,
    },
    {
      text: t('focus.session.guide3'),
      character: require('@/assets/character_hi.png'),
      anchor: hamburgerRef,
      round: true,
    },
    {
      text: t('focus.session.guide4'),
      character: require('@/assets/character_study.png'),
      anchor: controlsRef,
      radius: 36,
    },
  ];

  // 내 그리드 셀(GROMO-932) — 오늘 총 집중 = 세션 전 오늘 몫 + 세션의 오늘 정산 몫 + 미정산 경과.
  // 집계 방식·자정 경계 규칙은 gridPreSessionRef 선언부 주석 참고. 타이머 틱마다 리렌더돼 오른다.
  const gridDay = todayStr();
  const gridKstDay = todayStrKst();
  // 서버 스냅샷은 기준일이 오늘(KST)일 때만 유효 — 자정을 넘긴 채 폴링이 계속 실패하면 전날
  // 값이 남아 있다(코덱스 리뷰 ②). 그 회차는 폴백(로컬 집계)으로 내려간다.
  const gridServerToday = myFocus?.day === gridKstDay ? myFocus.minutes : null;
  // 정산 시점에 읽을 수 있게 최신 스냅샷을 엔진에 밀어 둔다(렌더 위치 유지 — 코덱스 리뷰 ⑩).
  engine.setServerSnapshot(
    gridServerToday != null ? { day: gridKstDay, seconds: gridServerToday * 60 } : null,
  );
  engine.resetFloorIfNewDay(gridKstDay);
  const gridBaseline = engine.gridBaseline();
  // 아직 정산되지 않은 집중초 중 '오늘' 몫(GROMO-1252 코드리뷰) — 그리드 셀·메뉴 드로어 공용.
  // session.elapsed 전체를 쓰면 ① 자정을 걸친 세션의 어제 몫까지 오늘로 표시되고(23:00~00:05
  // 세션이 65분으로 보이다가 정산 후 5분으로 줄어드는 역전) ② 뽀모도로처럼 이미 정산된 블록이
  // 저장분과 이중으로 잡힌다. 타이머 tick마다 리렌더되므로 ref를 그대로 읽어도 값이 따라 오른다.
  const liveTodaySeconds = blockTodaySeconds(engine.blockTodayView());
  // 표시 기준은 멤버 셀과 같은 서버 KST 버킷(GROMO-1246) — 로컬 집계는 서버 스냅샷을 못
  // 받았을 때(그룹 미가입·조회 실패·자정 넘겨 무효화)의 폴백으로만 쓴다. 측정·저장 경로는
  // 그대로다(1236의 "측정 축은 로컬 유지" 결정 유지 — 바뀌는 건 표시 결합부뿐).
  // 계산 결과를 바닥에 되먹여 다음 렌더의 하한으로 삼는다(정산 직후 되밀림 방지).
  const gridTotalSeconds = myLiveTotalSeconds({
    serverBase: gridServerToday != null ? gridServerToday * 60 : null,
    delta: blockKstTodaySeconds(engine.blockTodayView()),
    localFallback:
      (gridBaseline.preSession.day === gridDay ? gridBaseline.preSession.base : 0) +
      (gridBaseline.settledToday.day === gridDay ? gridBaseline.settledToday.seconds : 0) +
      liveTodaySeconds,
    settledFloor: gridBaseline.settledFloorSeconds,
    // 서버 버킷이 KST 고정(GROMO-1259)이라 동축 판정은 기기 오프셋이 KST인지로 족하다.
    sameAxis: kstLocalSameDay(),
  });
  const myGridMe = {
    nickname: nickname || t('common.me'),
    // 일시정지·뽀모도로 휴식·완료 게이트에선 비집중 표시 — 그리드의 초록은 isFocusing 의미(코덱스 리뷰)
    isFocusing: !paused && session.phase === 'focus' && !session.done,
    totalSeconds: gridTotalSeconds,
    tagName: subjectName,
  };

  // ── 렌더 계층(GROMO-1381) — 아래 블록은 세션 로직에 전혀 관여하지 않는다 ──────────────
  // 캐릭터 크기와 타이머 지정 크기는 전부 readoutLayout.ts의 순수 함수가 정한다(단위 테스트로
  // 잠겨 있다). 여기서는 입력(가용 높이·폭·글자 배율·모드)만 넘긴다.
  // ⚠️ fontScale을 반드시 넘긴다 — Text의 allowFontScaling 기본값 때문에 시스템 글자 크기를
  //    키운 사용자에게는 타이머가 다시 확대되어, 그만큼 캐릭터 몫이 줄어야 한다(codex 리뷰).
  const layout = focusReadoutLayout(
    Math.max(0, height - insets.top - insets.bottom),
    width,
    fontScale,
    // ⚠️ 뽀모도로는 세트배지·세트도트를 함께 그린다 — 예산에 넣지 않으면 캐릭터를 크게 유지한 채
    //    리드아웃이 페이저를 밀어내 도트·캐릭터가 겹친다.
    mode === 'pomodoro',
    // ⚠️ 카운트다운은 '목표 HH:MM:SS' 줄을 함께 그린다(codex 리뷰).
    mode === 'countdown',
  );
  const charSize = layout.charSize;
  // 자간·행높이는 지정 fontSize에 비례시켜 폰트 메트릭을 유지한다(시스템 배율은 RN이 곱한다).
  const timerTextStyle = {
    fontSize: layout.timerFontSize,
    lineHeight: Math.round(layout.timerFontSize * 1.08),
    letterSpacing: (T.text.timer.letterSpacing * layout.timerFontSize) / T.text.timer.fontSize,
  };

  // 가로 — 플립 시계만 크게 보는 컴팩트 뷰(GROMO-973). 세션 상태·타이머는 위 훅들이 그대로 굴린다.
  // 자릿수는 세션 최대 길이로 판정 — 1시간 이상(뽀모도로가 시간 단위인 경우 포함)이면 HH:MM:SS, 아니면 MM:SS.
  const landscapeFormat: 'hhmmss' | 'mmss' =
    mode === 'countup'
      ? 'hhmmss'
      : (mode === 'countdown' ? goal : Math.max(pomo.focusMin, pomo.breakMin) * 60) >= 3600
        ? 'hhmmss'
        : 'mmss';
  if (isLandscape && LANDSCAPE_ENABLED) {
    return (
      <FocusLandscape
        mode={mode}
        format={landscapeFormat}
        displaySeconds={session.display}
        phase={session.phase}
        setIndex={session.setIndex}
        sets={pomo.sets}
        subjectName={subjectName}
        onRotatePortrait={goPortrait}
      />
    );
  }

  return (
    <View testID="focus.session.screen" style={s.root}>
      <LinearGradient colors={[T.night.top, T.night.bottom]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={s.flex1} edges={['top', 'bottom']}>
        {/* 상단바 — 좌측 회전 버튼(→가로, GROMO-973) · 우측 햄버거 메뉴 */}
        <View style={s.topBar}>
          {LANDSCAPE_ENABLED ? (
            <PressableScale
              style={s.hamburger}
              scaleTo={0.9}
              haptic="light"
              accessibilityLabel={t('focus.session.toLandscape')}
              onPress={goLandscape}
            >
              <Ionicons name="phone-landscape-outline" size={20} color={T.paperLight} />
            </PressableScale>
          ) : (
            // 안드로이드 등 비대상 플랫폼 — 가로 버튼을 숨기되 좌측 자리를 채워 햄버거를 우측 유지(코덱스 리뷰)
            <View />
          )}
          {/* 같은 화면의 일시정지·정지와 피드백을 맞춘다(햅틱만 제외 — 주요 CTA가 아니라서).
              ref는 드로어 앵커 측정용 — Animated.createAnimatedComponent(Pressable)도
              호스트 뷰로 ref를 넘겨서 measureInWindow가 그대로 동작한다. */}
          <PressableScale
            style={s.hamburger}
            scaleTo={0.9}
            ref={hamburgerRef}
            accessibilityLabel={t('focus.session.openMenu')}
            onPress={() => {
              logFocusMenuOpened();
              setDrawerOpen(true);
            }}
          >
            <Ionicons name="menu" size={18} color={T.paperLight} />
          </PressableScale>
        </View>

        {/* 페이저 — [캐릭터] ↔ [내 친구(656)] ↔ [내 그룹(F2)] ↔ [내 리그=같은 시험(812)] ↔ [전체 리그(811)]
            순서를 바꾸면 상단 PAGE_VIEWS(뷰 체류 계측, GROMO-987)도 반드시 같이 고칠 것 */}
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          style={s.flex1}
        >
          <View style={[s.page, { width }]}>
            <View style={s.characterWrap}>
              {/* 호흡 래퍼 — children 슬롯에 캡처 뷰를 넣어 래퍼가 charShotRef의 **부모**가 되게
                  한다(정책 D-22). ref 안쪽에 transform이 걸리면 아래 captureRef가 세로로 눌린
                  호흡 중간 프레임을 그대로 PNG로 구워 Live Activity·차폐 화면에 박아 버린다.
                  일시정지면 calm(주기 2600ms·얕은 진폭)으로 가라앉는다. reduce 처리는 컴포넌트 몫. */}
              {/* ⚠️ active={page === 0} — 가로 페이저는 다른 페이지로 넘어가도 캐릭터 페이지가
                  마운트된 채 남는다. 안 넘기면 보이지도 않는 캐릭터의 무한 호흡이 몇 시간짜리
                  세션 내내 UI 스레드를 먹는다(codex 리뷰). 홈의 useIsFocused와 같은 부류다. */}
              <AnimatedCharacter
                size={charSize}
                mood={paused ? 'calm' : 'idle'}
                // ⚠️ `!doneGate`도 함께 본다. 완료 게이트는 화면을 통째로 덮는데, 캐릭터
                //    페이지에서 세션을 끝내면 `page === 0`이 그대로 참이라 **가려진 캐릭터의
                //    무한 호흡이 사용자가 확인을 누를 때까지 계속 돈다**(codex 리뷰).
                //    게이트는 사용자가 닫을 때까지 열려 있을 수 있어 그 사이 UI 스레드와
                //    배터리를 계속 먹는다. 위 페이저 사유와 같은 부류다.
                active={page === 0 && !doneGate}
              >
                {/* 스냅샷 캡처 범위 — Live Activity·가림막에 들어갈 캐릭터(공부 집중 = study 캐릭터).
                    ⚠️ charSize가 작은 화면에서 줄면 캡처 PNG 해상도도 함께 줄어든다. 기기 배율
                    (@2x/@3x) 때문에 해상도는 원래도 460~690px로 흔들렸고, 축소 하한(≈370px)도
                    위젯 실제 표시 크기보다 크다 — 별도 캡처 크기를 두지 않는다(보고 참고). */}
                <View ref={charShotRef} collapsable={false}>
                  <CharacterImage
                    size={charSize}
                    variant="study"
                    sourceUri={activeSource ?? undefined}
                  />
                </View>
              </AnimatedCharacter>
            </View>
          </View>
          <View style={[s.page, { width }]}>
            <LiveFocusGrid
              members={sessionFriends}
              me={myGridMe}
              pinnedIds={pinnedIds}
              // 페이지 인덱스는 viewForPage()의 순서와 같다 — [캐릭터0][친구1][그룹×N][내리그][전체리그].
              // 안 보이는 그리드의 1초 시계를 세우기 위한 것(서버 폴링은 계속 돈다).
              visible={page === 1}
              title={t('focus.session.friendsTitle')}
              emptyTitle={t('focus.session.friendsEmptyTitle')}
              emptySub={t('focus.session.friendsEmptySub')}
            />
            {/* 친구 그리드 아래 '함께 공부' 군집 일러스트 */}
            <Image
              source={require('@/assets/characters_study.png')}
              style={s.friendsStudy}
              resizeMode="contain"
            />
          </View>
          {/* 그룹 뷰(F2) — 참여한 '그룹마다' 한 페이지씩("그룹: {그룹명}"). pinnedIds는 친구 전용이라 안 넘긴다.
              라이브 집중중 신호가 없어(그룹 detail 폴링) 오늘 집중분만 정적 표기된다. */}
          {sessionGroups.map((g, i) => (
            <View
              key={g.groupId}
              testID={`focus.group.page.${g.groupId}`}
              style={[s.page, { width }]}
            >
              <LiveFocusGrid
                members={g.members}
                me={myGridMe}
                showMeWhenEmpty
                visible={page === 2 + i}
                title={t('focus.session.groupTitle', { name: g.groupName })}
                emptyTitle={t('focus.session.groupEmptyTitle')}
                emptySub={t('focus.session.groupEmptySub')}
              />
            </View>
          ))}
          <View style={[s.page, { width }]}>
            <LiveFocusGrid
              members={examMembers}
              me={myGridMe}
              pinnedIds={pinnedIds}
              visible={page === 2 + sessionGroups.length}
              title={
                myExamName
                  ? t('focus.session.categoryLeagueTitle', { category: myExamName })
                  : t('focus.session.sameExamTitle')
              }
              emptyTitle={t(
                myOccupation == null
                  ? 'focus.session.examUnsetTitle'
                  : 'focus.session.examEmptyTitle',
              )}
              emptySub={t(
                myOccupation == null ? 'focus.session.examUnsetSub' : 'focus.session.examEmptySub',
              )}
            />
          </View>
          <View style={[s.page, { width }]}>
            <LiveFocusGrid
              members={leagueMembers}
              me={myGridMe}
              pinnedIds={pinnedIds}
              visible={page === 3 + sessionGroups.length}
              title={t('focus.session.allLeagueTitle')}
              emptyTitle={t('focus.session.leagueEmptyTitle')}
              emptySub={t('focus.session.leagueEmptySub')}
            />
          </View>
        </ScrollView>

        {/* 페이지 인디케이터 */}
        <View style={s.dots} ref={dotsRef} collapsable={false}>
          {/* 페이저 페이지 수와 항상 일치 — 캐릭터·친구(2) + 그룹×N + 내리그·전체리그(2) */}
          {Array.from({ length: 4 + sessionGroups.length }).map((_, i) => (
            <Animated.View
              key={i}
              style={[s.dot, page === i && s.dotActive, m.css(DOT_TRANSITION)]}
            />
          ))}
        </View>

        {/* 타이머 리드아웃(모드별).
            key=phase — 뽀모도로 집중↔휴식 경계에서 리드아웃이 통째로 새로 마운트되며 크로스페이드로
            갈아탄다(카운트다운·카운트업은 phase가 'focus' 고정이라 진입 1회만 페이드된다). */}
        <PhaseReadout key={session.phase}>
          {renderReadout(mode, session, goal, pomo, subjectName, timerTextStyle)}
        </PhaseReadout>

        {/* 컨트롤 — 일시정지 / 정지 */}
        <View style={s.controls} ref={controlsRef} collapsable={false}>
          <PressableScale
            testID="focus.pause"
            style={s.ctrlBtn}
            scaleTo={0.92}
            haptic="light"
            onPress={togglePause}
          >
            {/* 아이콘이 바뀌는 순간 팝으로 갈아탄다 — key로 새로 마운트시켜야 프리셋이 다시 돈다.
                버튼의 testID(focus.pause)는 위 PressableScale에 그대로 남아 E2E 셀렉터에 영향 없음. */}
            <PopIcon key={paused ? 'play' : 'pause'} name={paused ? 'play' : 'pause'} />
          </PressableScale>
          <PressableScale
            testID="focus.stop"
            style={[s.ctrlBtn, s.stopBtn]}
            scaleTo={0.92}
            haptic="light"
            onPress={stopByUser}
          >
            <Ionicons name="square" size={19} color={T.paperLight} />
          </PressableScale>
        </View>
      </SafeAreaView>

      {/* 첫 세션 사용법 안내(GROMO-652) */}
      <TabGuideOverlay storageKey={STORAGE_KEYS.guideFocusSession} steps={guideSteps} />

      <FocusMenuDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        liveSubjectId={subjectId}
        liveSeconds={liveTodaySeconds}
      />

      {/* 완료 게이트(GROMO-864) — 확인을 눌러야 결과 화면으로 넘어간다 */}
      {doneGate && (
        <View style={s.doneGate}>
          <Image
            source={require('@/assets/character_happy.png')}
            style={s.doneGateChar}
            resizeMode="contain"
          />
          <Text style={s.doneGateTitle}>{t('focus.session.doneTitle')}</Text>
          <Text style={s.doneGateSub}>
            {mode === 'pomodoro'
              ? t('focus.session.donePomodoroSub', { subject: subjectName, count: pomo.sets })
              : t('focus.session.doneSub', { subject: subjectName })}
          </Text>
          {/* onPress에 finish를 직접 넘기면 제스처 이벤트가 completed 인자로 들어간다 — 래핑 필수 */}
          <PressableScale style={s.doneGateBtn} haptic="light" onPress={() => finish()}>
            <Text style={s.doneGateBtnText}>{t('common.confirm')}</Text>
          </PressableScale>
        </View>
      )}
    </View>
  );
}

// 모드별 하단 리드아웃(라벨 + 큰 타이머 + 보조표시).
// 타이머 바로 위엔 모드 안내 문구 대신 집중 중인 과목명을 보여준다(GROMO-848).
// 뽀모도로 휴식 페이즈만 예외로 '휴식' — 과목명이 뜨면 집중 중으로 오해할 수 있어서.
//
// ⚠️ GROMO-1525 — 세 모드가 **모두 같은 숫자 배치**를 쓴다. 1381이 카운트다운·뽀모도로에만
//    씌웠던 원형 진행 링(`ProgressRing`)은 오너 결정으로 뺐다(재추가 예정). 진행률은 숫자로
//    그대로 읽히므로 정보 손실은 없다. 진입 연출은 호출부의 fadeIn(PhaseReadout)이 담당한다.
function renderReadout(
  mode: FocusTimerMode,
  session: SessionState,
  goal: number,
  pomo: { sets: number },
  subjectName: string,
  timerStyle: TextStyle,
) {
  // 큰 숫자 — 세 모드 공용.
  // ⚠️ adjustsFontSizeToFit은 최후 방어선이다. 지정 크기는 이미 readoutLayout이 화면 폭에 맞춰
  //    낮춰 두었고, 이건 폰트 메트릭 추정이 빗나갔을 때 **말줄임 대신 축소**되게 한다.
  const bigTime = (
    <Text
      style={[s.bigTime, timerStyle]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={PLAIN_TIMER_MIN_FONT_SCALE}
    >
      {hms(session.display)}
    </Text>
  );

  if (mode === 'countup') {
    return (
      <>
        <Text style={s.roSubject} numberOfLines={1}>
          {subjectName}
        </Text>
        {bigTime}
      </>
    );
  }
  if (mode === 'countdown') {
    return (
      <>
        <Text style={s.roSubject} numberOfLines={1}>
          {subjectName}
        </Text>
        {bigTime}
        <Text style={s.roGoal}>{t('focus.session.goal', { time: hms(goal) })}</Text>
      </>
    );
  }
  // pomodoro
  return (
    <>
      <View style={s.setBadgeRow}>
        <View style={s.setBadge}>
          <View style={s.setBadgeDot} />
          <Text style={s.setBadgeText}>
            {t('focus.session.setProgress', { current: session.setIndex, total: pomo.sets })}
          </Text>
        </View>
      </View>
      <Text style={s.roSubject} numberOfLines={1}>
        {session.phase === 'focus' ? subjectName : t('focus.session.break')}
      </Text>
      {bigTime}
      <View style={s.setDots}>
        {Array.from({ length: pomo.sets }).map((_, i) => (
          <View key={i} style={[s.setDot, i < session.setIndex && s.setDotOn]} />
        ))}
      </View>
    </>
  );
}

// ⚠️ 키로 remount되는 진입 요소는 **자기 컴포넌트여야 한다.** `m.enter`의 결정은 useMotion을
//    호출한 컴포넌트 인스턴스 단위로 얼리는데(기반 설계), 부모인 FocusSessionScreen은 페이즈가
//    바뀌어도 remount되지 않는다. 부모의 결정에 묶이면 '동작 줄이기'를 끈 뒤 새로 마운트되는
//    리드아웃·아이콘이 진입 연출을 영영 못 받는다(codex 리뷰).
//    ⚠️ 뷰를 새로 끼운 게 아니다 — 이 컴포넌트가 곧 그 Animated.View다(D-04 유지).
function PhaseReadout({ children }: { children: ReactNode }) {
  const m = useMotion();
  return <Animated.View style={[s.readout, m.enter(fadeIn())]}>{children}</Animated.View>;
}

// 같은 이유로 분리 — 아이콘이 바뀔 때마다 key로 remount되며 그 시점 설정으로 다시 정한다.
function PopIcon({ name }: { name: 'play' | 'pause' }) {
  const m = useMotion();
  return (
    <Animated.View style={m.enter(pop())}>
      <Ionicons name={name} size={22} color={T.paperLight} />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.night.bottom },
  flex1: { flex: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.space.xxl,
    paddingVertical: T.space.sm,
    minHeight: 40,
  },
  hamburger: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: withAlpha(T.white, 0.1),
    alignItems: 'center',
    justifyContent: 'center',
  },

  page: { flex: 1 },
  friendsStudy: { width: '100%', height: 104, marginBottom: T.space.md },
  characterWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: T.space.sm,
    paddingVertical: T.space.sm,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: withAlpha(T.night.cream, 0.3) },
  dotActive: { width: 18, backgroundColor: T.night.gold },

  readout: {
    alignItems: 'center',
    paddingBottom: T.space.xl,
    minHeight: 118,
    justifyContent: 'flex-end',
  },
  // 리드아웃의 과목명(전 모드 공통) — 구 상단바 과목명의 크림색 유지
  // ⚠️ 호출부에서 numberOfLines={1}로 **한 줄로 고정**한다. 과목명은 사용자가 자유 입력하는
  //    값이라 길면 줄바꿈되는데, readoutLayout의 PLAIN_BASE 예산이 과목명을 30pt(한 줄)로
  //    계산하므로 늘어난 줄만큼 캐릭터와 리드아웃이 다시 겹친다(codex 리뷰).
  roSubject: { ...T.text.subtitle, color: T.night.cream, marginBottom: T.space.sm },
  bigTime: {
    ...T.text.timer,
    color: T.paperLight,
    fontVariant: ['tabular-nums'],
    lineHeight: 56,
  },
  roGoal: { ...T.text.label, fontWeight: '500', color: T.night.muted, marginTop: T.space.xs },

  setBadgeRow: { marginBottom: T.space.sm },
  setBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.xs,
    backgroundColor: withAlpha(T.accent, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(T.accent, 0.32),
    borderRadius: 99,
    paddingVertical: T.space.xs,
    paddingHorizontal: T.space.md,
  },
  setBadgeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: T.night.gold },
  setBadgeText: { ...T.text.caption, fontWeight: '700', color: T.night.gold },
  setDots: { flexDirection: 'row', gap: T.space.sm, marginTop: T.space.md },
  setDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: withAlpha(T.night.cream, 0.22) },
  setDotOn: { backgroundColor: T.night.gold },

  doneGate: {
    ...StyleSheet.absoluteFill,
    backgroundColor: withAlpha(T.night.bottom, 0.94),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: T.space.xxl,
  },
  doneGateChar: { width: 140, height: 140, marginBottom: T.space.lg },
  doneGateTitle: { ...T.text.title, color: T.paperLight, marginBottom: T.space.sm },
  doneGateSub: { ...T.text.body, color: T.night.muted, marginBottom: T.space.xxl },
  doneGateBtn: {
    backgroundColor: T.night.gold,
    borderRadius: 99,
    paddingVertical: T.space.md,
    paddingHorizontal: 56,
  },
  doneGateBtnText: { ...T.text.subtitle, color: T.ink },

  controls: { flexDirection: 'row', justifyContent: 'center', gap: T.space.xl, paddingBottom: 30 },
  ctrlBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: withAlpha(T.white, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBtn: { backgroundColor: T.accentAlt },
});
