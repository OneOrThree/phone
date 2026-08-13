import { useCallback, useEffect, useRef, useState } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
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
import { startFocusSession } from '@/services/focusApi';
import type { FocusType } from '@/types/dto/focus';
import { ensureFocusTagId } from './tagSync';
import { uploadFocusBlock } from './uploadFocusBlock';
import { cancelMarker, flushPendingMarkerCancels } from './pendingMarkerCancels';
import { isTodayVerdict, publishSessionSaveVerdict } from './sessionSaveVerdict';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { useFocus } from '@/store/FocusContext';
import { useCoins } from '@/store/CoinContext';
import { useSubjects } from '@/store/SubjectContext';
import { useUser } from '@/store/UserContext';
import { useCharacter } from '@/store/CharacterContext';
import { STORAGE_KEYS } from '@/types/storage';
import type { V2RootStackParamList } from '@/navigation/types';
import type { FocusTimerMode, LiveFocusSession } from './types';
import { hms } from './format';
import { focusReadoutLayout, PLAIN_TIMER_MIN_FONT_SCALE } from './readoutLayout';
import { scheduleLeaveNotifications, cancelLeaveNotifications } from './leaveNotifications';
import { kstLocalSameDay, todayStr, todayStrKst } from '@/utils/localDate';
import {
  newBlockToday,
  creditTick,
  creditTicks,
  blockTodaySeconds,
  blockKstTodaySeconds,
  type BlockToday,
} from './blockToday';
import { myLiveTotalSeconds } from '@/utils/liveFocus';
import { newBlockPause, pauseStart, pauseEnd, blockPauseSeconds, pauseCutAt } from './blockPause';
import { useFocusFriends } from '@/screens/league/useFocusFriends';
import { useFocusCategory } from '@/hooks/useFocusCategory';
import { occupationForCategory } from '@/constants/focusCategories';
import { useSessionLeagueMembers } from './useSessionLeagueMembers';
import { useSessionGroups } from './useSessionGroups';
import { LiveFocusGrid } from './components/LiveFocusGrid';
import { FocusMenuDrawer } from './components/FocusMenuDrawer';
import { FocusLandscape } from './FocusLandscape';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
import {
  logFocusSessionStarted,
  logFocusSessionPaused,
  logFocusSessionResumed,
  logFocusSessionCompleted,
  logFocusSessionAbandoned,
  logFocusDistractionDetected,
  logFocusMenuOpened,
  logFocusViewChanged,
  logFocusOrientationChanged,
  logFocusMarkerStartFailed,
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
const LEAVE_END_S = 15;
const AWAY_CREDIT_CAP_S = 8 * 3600; // 실드 세션 복귀 시 집중 인정 상한
// 짧은 진동 2번 — 패턴 의미가 플랫폼별로 다르다(코덱스 리뷰): iOS는 진동 길이 고정에
// 배열=진동 사이 간격([0,500]=2번), Android는 [대기,진동] 교대라 [0,500]이 1번 500ms가 된다.
const DOUBLE_VIBRATE_PATTERN = Platform.OS === 'android' ? [0, 400, 200, 400] : [0, 500];
// 타이머 모드 → 서버 FocusType 매핑(GROMO-733)
const FOCUS_TYPE_BY_MODE: Record<FocusTimerMode, FocusType> = {
  countup: 'INFINITE',
  countdown: 'RANGE',
  pomodoro: 'POMODORO',
};
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

interface SessionState {
  elapsed: number; // 실제 집중 초(적립 기준) — 뽀모도로는 집중 블록만 누적
  display: number; // 큰 숫자: countup=경과 / countdown=남음 / pomodoro=현 페이즈 남음
  phase: 'focus' | 'break';
  setIndex: number; // 1-based
  done: boolean;
}

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
  const { userId, nickname } = useUser();
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
  const [paused, setPaused] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 완료 게이트(GROMO-864) — 카운트다운 종료 시 결과 화면 직행 대신 확인을 받는다
  const [doneGate, setDoneGate] = useState(false);
  // 친구 전체 라이브 상태 — 60초 폴링·포그라운드 복귀 갱신 (09 친구 그리드 실데이터).
  // pinnedIds는 그리드 3종 공통 핀 우선 정렬용(932) — 리그 그리드도 같은 집합을 쓴다.
  const { friends: sessionFriends, pinnedIds } = useFocusFriends();
  // 리그(811)·같은 시험(812) 그리드 라이브 멤버 — 서버의 내 행은 제외하고, 내 셀은 로컬
  // 타이머 기준으로 그리드가 따로 렌더한다(GROMO-932, 아래 myGridMe) — 중복·시차 방지
  const myCategory = useFocusCategory();
  const myOccupation = occupationForCategory(myCategory);
  const { members: leagueMembers } = useSessionLeagueMembers({ excludeUserId: userId, pinnedIds });
  const { members: examMembers } = useSessionLeagueMembers({
    occupation: myOccupation ?? undefined,
    enabled: myOccupation != null,
    excludeUserId: userId,
    pinnedIds,
  });
  // 그룹 뷰(F2) — 내가 참여한 '그룹별로' 한 페이지씩. 각 그룹의 내 행은 제외하고 내 셀은 그리드가
  // 로컬 타이머로 따로 렌더한다(me). 라이브 집중중 신호는 group detail에 없어 오늘 집중분만 정적 표기한다.
  const { groups: sessionGroups, myFocus } = useSessionGroups({ excludeUserId: userId });
  // 그룹 페이지 개수 — 페이저 점·뷰 계측이 동적 페이지 수를 알아야 해서 ref로 최신값을 들고 있는다.
  const groupCountRef = useRef(0);
  groupCountRef.current = sessionGroups.length;
  const [session, setSession] = useState<SessionState>(() => ({
    elapsed: 0,
    display: mode === 'countdown' ? goal : mode === 'pomodoro' ? pomo.focusMin * 60 : 0,
    phase: 'focus',
    setIndex: 1,
    done: false,
  }));

  const sessionRef = useRef(session);
  sessionRef.current = session;
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
  const finishedRef = useRef(false);
  // 이탈 타임아웃으로 abandoned를 발행한 세션 — completed 발행과 상호배타 보장(GROMO-1004)
  const abandonedRef = useRef(false);
  // completed를 이미 발행했는지 — 완료 게이트와 finish 두 경로의 이중 발행 방지(코덱스 리뷰)
  const completedLoggedRef = useRef(false);
  const startedAtRef = useRef(new Date().toISOString());
  // 서버 업로드 정산 마커 — 이미 정산(로컬 적립·서버 업로드)된 집중초와 미정산 구간 시작 시각.
  // 뽀모도로는 집중 블록마다, 그 외 모드는 종료 시 한 번 정산한다.
  // 코인은 여기서 세지 않는다(GROMO-1049) — 지급도 잔액도 서버가 정본이라 앱이 미리 계산하지 않는다.
  const settledSecondsRef = useRef(0);
  const settleAtRef = useRef(startedAtRef.current);
  // 이 블록의 수동 일시정지 누적(방해초, GROMO-1214 코드리뷰) — 규칙·근거는 blockPause.ts 주석 참고.
  const blockPauseRef = useRef(newBlockPause());
  // 정산 블록의 시작점을 옮기면서 방해 카운터도 함께 리셋한다 — settleAt을 옮기는 모든 지점이
  // 곧 '새 블록 시작'이라, 그 전에 쌓인 일시정지는 이전 블록 몫(이미 정산에 실렸거나 정산 구간
  // 밖)이라 넘어오면 안 된다.
  const startBlockAt = useCallback((at: string) => {
    settleAtRef.current = at;
    blockPauseRef.current = newBlockPause(blockPauseRef.current);
  }, []);
  // 미정산 블록의 날짜별 집중초(GROMO-1252) — 정산 적립·그리드 셀·메뉴 드로어의 '오늘 몫'이자,
  // 업로드 페이로드의 focusSecondsByDate. 벽시계 겹침이 아니라 집중 tick의 날짜로 세는 이유는
  // blockToday.ts 주석 참고.
  const blockTodayRef = useRef(newBlockToday());
  // 이탈(background) 시점의 날짜 맵 스냅샷 — 복귀 리플레이가 세션 상태(leftSessionRef)를 되감는 만큼
  // 날짜 맵도 되감아야 한다(GROMO-1252 코드리뷰 ⑤). 안 되감으면 background 이벤트 뒤 JS 정지 전까지
  // 더 돈 tick이 리플레이에서 한 번 더 세져 업로드·로컬 양쪽이 부풀고, 자정을 걸친 블록에선 날짜별
  // 벽시계 상한을 넘어 서버 클램프로 잘린다. 정산이 끼면(settleFocusBlock) 스냅샷은 버린다.
  const leftBlockTodayRef = useRef<BlockToday | null>(null);
  const creditFocusTick = useCallback((at?: Date) => {
    blockTodayRef.current = creditTick(blockTodayRef.current, at);
  }, []);
  // 연속 tick 묶음 적립 — 복귀 리플레이 전용(GROMO-1252 코드리뷰 6차 ④). 귀속 결과는 tick별 호출과 동일.
  const creditFocusTicks = useCallback((firstAt: Date, count: number) => {
    blockTodayRef.current = creditTicks(blockTodayRef.current, firstAt, count);
  }, []);
  // 내 그리드 셀 오늘 몫 집계(GROMO-932) — todayFocusSeconds는 FocusProvider 마운트 시에만
  // 날짜를 확인해 세션이 자정을 넘기면 어제 누적이 남는다. 렌더 시점 스냅샷으로 걷어내는
  // 방식은 백그라운드 리플레이가 첫 렌더 전에 자정 이후 블록을 정산하면 그 몫까지 스냅샷에
  // 섞여 오늘 몫에서 빠진다(코덱스 리뷰). 그래서 렌더 순서와 무관하게 직접 집계한다:
  //   세션 전 오늘 몫(마운트 시점 todayFocusSeconds — 날짜가 바뀌면 0)
  //   + 이 세션이 오늘로 귀속시킨 정산 델타(settleFocusBlock에서 날짜 키로 누적)
  //   + 미정산 경과의 오늘 몫(blockTodayRef — 자정을 걸친 세션에서 어제 몫은 빼고 센다)
  const gridPreSessionRef = useRef({ day: todayStr(), base: todayFocusSeconds });
  const gridSettledTodayRef = useRef({ day: todayStr(), seconds: 0 });
  // 내 그리드 셀의 **정산 기준점**(GROMO-1246 코덱스 리뷰 ③·④·⑧) — 마지막 정산 직후 확정한
  // KST 오늘 총합. 새 블록의 델타는 이 위에 쌓이고, 서버가 그 정산분을 반영하면 serverBase가
  // 같은 총합으로 수렴해 이중 계상이 없다. 기준일을 함께 들고 KST 자정을 넘기면 0으로 리셋한다.
  const gridSettledFloorRef = useRef({ day: todayStrKst(), seconds: 0 });
  // 정산 시점에 읽을 최신 서버 스냅샷 — settleFocusBlock 이 렌더 값을 클로저로 못 잡아 ref 로 둔다.
  // **기준일을 함께** 들고 있어야 한다(코덱스 리뷰 ⑩): 자정 전에 스냅샷을 받고 백그라운드에 있다가
  // 자정을 넘겨 복귀하면 AppState 리플레이가 새 렌더보다 먼저 정산을 돌린다 — 그때 날짜 확인 없이
  // 쓰면 전날 누적 위에 새 날 블록을 얹은 값이 오늘 기준점으로 굳어 하루 종일 과대 표시된다.
  const gridServerSnapshotRef = useRef<{ day: string; seconds: number } | null>(null);
  // 서버 라이브 마커 세션(GROMO-873) — 시작 시 진행 중(endedAt NULL) 레코드를 만들어 친구/리그에
  // '집중 중'으로 뜨게 한다. 표시용 마커일 뿐 시간 저장·통계는 기존 완주 저장(POST, settleFocusBlock)이
  // 담당하고, 마커는 블록 정산·세션 종료 시 취소(통계 미귀속)로 닫는다 — 이중 집계 없음. liveIdRef는
  // 라이브 레코드 저장용 스냅샷, liveStartPromiseRef는 시작 응답 시퀀싱용 — 응답 전에 취소가 걸려도
  // 순서대로 처리된다.
  const liveIdRef = useRef<string | null>(null);
  const liveStartPromiseRef = useRef<Promise<string | null>>(Promise.resolve(null));
  // 취소 실패한 마커 id는 AsyncStorage 대기열(pendingMarkerCancels)에 남긴다 — 회전 중 버리면 옛 마커가
  // 열린 채 남아 친구 화면에 옛 블록 시작부터의 '집중 중'으로 되살아난다(코덱스 리뷰). 종전엔 화면 ref에만
  // 담아, 정산 직후 화면을 떠나면(finish는 업로드를 기다리지 않는다) 재시도가 영영 안 돌았다(GROMO-1214
  // 코드리뷰). 이제 새 마커 시작·앱 복귀·종료에 더해 **다음 실행·포그라운드 복귀**(PendingFocusUploader)
  // 에서도 재시도하고, 그래도 남으면 서버 고아 스윕(12h)이 최후 보루.
  // 휴식 만료 복귀가 다음 블록을 일시정지 대기로 만든 경우 — 마커 오픈을 재개 시점까지 유예(코덱스 리뷰)
  const markerDeferredRef = useRef(false);
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

  // 서버에 라이브 마커 시작을 등록 — 등록돼야 친구/리그 화면에 '집중 중'(과목명 포함)으로 보인다.
  // 태그를 해석해 실어 보내되, 실패(오프라인 등)해도 세션·시간 저장은 영향 없다(마커는 표시용).
  // sessionId는 promise로 전달 — 취소가 시작 응답보다 먼저 걸려도 순서대로 처리된다.
  const startLiveSession = useCallback(
    (startedAt: string) => {
      // 회전 시점 = 연결이 살아있을 가능성이 큰 시점 — 밀린 취소부터 재시도(코덱스 리뷰)
      flushPendingMarkerCancels(userIdRef.current).catch(() => {});
      const promise = ensureFocusTagId(subjectName, userId)
        .catch(() => null)
        .then((focusTagId) =>
          startFocusSession({ focusTagId, startedAt, focusType: FOCUS_TYPE_BY_MODE[mode] }),
        )
        .then(
          (res) => {
            // 이 시작이 여전히 현재 마커일 때만 스냅샷 갱신 — 취소로 이미 닫힌 마커의 id를
            // 늦게 도착한 응답이 라이브 레코드에 되살리지 않게.
            if (liveStartPromiseRef.current === promise) liveIdRef.current = res.sessionId;
            return res.sessionId;
          },
          (e: unknown) => {
            // 마커 시작 실패는 종전까지 조용히 삼켜져 비율조차 몰랐다 — 계측만 남기고 세션은
            // 그대로 진행한다(GROMO-1214). 마커가 없으면 종료가 POST 폴백으로 간다.
            const status = axios.isAxiosError(e) ? e.response?.status : undefined;
            logFocusMarkerStartFailed({
              reason: axios.isAxiosError(e)
                ? status != null
                  ? `http_${status}`
                  : 'network'
                : 'unknown',
            });
            return null;
          },
        );
      liveStartPromiseRef.current = promise;
      return promise;
    },
    [subjectName, userId, mode],
  );

  // 세션 진입 시 첫 마커 등록 — 이후 블록 정산마다 닫히고(마커 회전, settleFocusBlock 참고),
  // 뽀모도로는 휴식이 끝나는 break→focus 경계에서 다음 블록 마커를 새로 연다.
  const liveStartedOnceRef = useRef(false);
  useEffect(() => {
    if (liveStartedOnceRef.current) return;
    liveStartedOnceRef.current = true;
    startLiveSession(startedAtRef.current);
  }, [startLiveSession]);

  // 한 tick 진행 — 모드별 다음 상태 계산.
  const nextTick = useCallback(
    (prev: SessionState): SessionState => {
      if (mode === 'countup') {
        return { ...prev, elapsed: prev.elapsed + 1, display: prev.display + 1 };
      }
      if (mode === 'countdown') {
        const remaining = prev.display - 1;
        return {
          ...prev,
          elapsed: prev.elapsed + 1,
          display: Math.max(0, remaining),
          done: remaining <= 0,
        };
      }
      // pomodoro
      const elapsed = prev.phase === 'focus' ? prev.elapsed + 1 : prev.elapsed;
      const rem = prev.display - 1;
      if (rem > 0) return { ...prev, elapsed, display: rem };
      if (prev.phase === 'focus') {
        // 마지막 세트의 집중이 끝나면 종료(트레일링 휴식 없음)
        if (prev.setIndex >= pomo.sets) {
          return { ...prev, elapsed, display: 0, done: true };
        }
        return { ...prev, elapsed, display: pomo.breakMin * 60, phase: 'break' };
      }
      // 휴식 종료 → 다음 세트 집중
      return {
        ...prev,
        elapsed,
        display: pomo.focusMin * 60,
        phase: 'focus',
        setIndex: prev.setIndex + 1,
      };
    },
    [mode, pomo.sets, pomo.breakMin, pomo.focusMin],
  );

  // 1초 tick — 화면 생명주기 동안 유지, 일시정지·완료 시엔 진행만 멈춤.
  useEffect(() => {
    const id = setInterval(() => {
      if (pausedRef.current) return;
      const prev = sessionRef.current;
      if (prev.done) return;
      const next = nextTick(prev);
      // 집중 tick(elapsed가 오른 tick)만 오늘 몫에 적립 — 일시정지·뽀모도로 휴식은
      // 여기까지 오지 않거나 elapsed가 멈춰 자연히 빠진다(GROMO-1252 코드리뷰).
      if (next.elapsed > prev.elapsed) creditFocusTick();
      setSession(next);
    }, 1000);
    return () => clearInterval(id);
  }, [nextTick, creditFocusTick]);

  // 라이브 세션 레코드 — 강제 종료돼도 다음 실행 때 OrphanFocusSettler가 정산할 수 있게 남긴다.
  // 저장값은 '미정산 구간'만: elapsed=아직 서버/로컬에 안 올린 집중초, startedAt=그 구간 시작 시각.
  // (집중 블록을 증분 정산하므로 이미 올린 블록은 레코드에서 빠져 고아 정산이 이중 적립하지 않는다.)
  // finish 후엔 저장 금지 — 종료 시 제거한 레코드가 되살아나면 다음 실행에서 이중 정산된다.
  const saveLive = useCallback(
    (elapsed: number) => {
      if (finishedRef.current) return;
      const remaining = Math.floor(elapsed) - settledSecondsRef.current;
      if (remaining <= 0) return;
      const record: LiveFocusSession = {
        subjectId,
        subjectName,
        elapsed: remaining,
        startedAt: settleAtRef.current,
        updatedAt: new Date().toISOString(),
        userId, // 소유 계정 — 고아 정산 시 다른 계정으로 적립/업로드되는 것을 막는다
        serverSessionId: liveIdRef.current, // 열려 있는 라이브 마커 — 강제종료 시 서버 스윕이 마감
        // 날짜별 집중초 스냅샷(GROMO-1252) — 고아 정산이 여기와 같은 규칙으로 '오늘 몫'을 고르고,
        // 서버 업로드에도 그대로 실어 보낸다. 구간 겹침만으로는 일시정지가 자정을 걸친 블록을
        // 과다 계상한다.
        focusDays: blockTodayRef.current,
      };
      AsyncStorage.setItem(STORAGE_KEYS.focusLiveSession, JSON.stringify(record)).catch(() => {});
    },
    [subjectId, subjectName, userId],
  );

  // 매초 쓰기는 과해서 5초마다 갱신. 백그라운드 진입·실드 복귀 전진 시엔 그 순간 값으로 즉시 저장.
  useEffect(() => {
    if (session.elapsed > 0 && session.elapsed % 5 === 0) saveLive(session.elapsed);
  }, [session.elapsed, saveLive]);

  // 세션 실드 — 시작 시 허용앱 외 전부 차단, 화면을 떠날 때 해제(멱등, finish에서도 해제).
  // 적용 성공 여부(shielded)로 이탈 정책이 갈린다: 실드 O = 집중 인정 / 실드 X = 15초 정책.
  // 과목 변경 시엔 stop 없이 start만 다시 호출한다(같은 스토어를 덮어씀) — 중간에 stop을
  // 끼우면 다음 start까지 모든 차단이 풀리는 무방비 구간이 생긴다.
  const shieldedRef = useRef(false);
  useEffect(() => {
    ScreenTimeModule.startFocusShield(subjectName)
      .then((ok) => {
        shieldedRef.current = ok;
      })
      .catch(() => {});
  }, [subjectName]);
  // 해제는 화면을 떠날 때 한 번만
  useEffect(
    () => () => {
      shieldedRef.current = false;
      ScreenTimeModule.stopFocusShield().catch(() => {});
    },
    [],
  );

  // Live Activity(다이나믹 아일랜드) — 캐릭터 스냅샷을 App Group에 저장한 뒤 시작.
  // 화면을 떠나면 종료. 스냅샷 실패 시 위젯이 기본 마스코트로 폴백한다.
  const charShotRef = useRef<View>(null);
  useEffect(() => {
    let cancelled = false;
    // 캐릭터가 실제로 그려진 뒤 캡처(마운트 직후엔 빈 프레임일 수 있음)
    const t = setTimeout(async () => {
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
        ScreenTimeModule.startFocusActivity(subjectName, others).catch(() => {});
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
      ScreenTimeModule.endFocusActivity().catch(() => {});
    };
  }, [subjectName, subjectId]);

  // 라이브 마커 마감 — 취소(통계 미귀속)로 닫아 친구 화면의 '집중 중'을 끈다. 시간 저장은
  // settleFocusBlock의 업로드가 별도로 담당하므로 취소해도 기록은 잃지 않는다.
  // 실패해도 cancelMarker가 대기열에 남겨 다음 실행·포그라운드에 재시도하므로 fire-and-forget.
  const cancelLiveSession = useCallback(() => {
    const livePromise = liveStartPromiseRef.current;
    liveIdRef.current = null;
    liveStartPromiseRef.current = Promise.resolve(null);
    livePromise
      .then((sessionId) =>
        sessionId != null ? cancelMarker(sessionId, userIdRef.current) : undefined,
      )
      // 이 취소의 성패가 확정된 뒤 밀린 취소를 재시도 — finish의 flush가 진행 중이던 마지막
      // 취소보다 먼저 돌아 실패분을 놓치는 순서 경합 방지(코덱스 리뷰). 체인은 언마운트 후에도
      // 살아 있어 정지 직후 화면을 떠나도 재시도가 한 번은 돈다.
      .then(() => flushPendingMarkerCancels(userIdRef.current))
      .catch(() => {});
  }, []);

  // finish를 거치지 않는 언마운트(안드로이드 시스템 back 등)에서도 마커를 닫는다 — 안 닫으면
  // 서버 스윕(12h)까지 친구 화면에 '집중 중'으로 남는다(코덱스 리뷰). 정상 종료는 finish/완료
  // 게이트가 이미 취소했으므로 no-op(라이브 참조가 비어 있음). 마지막 뷰 체류도 같은 조건으로
  // flush — finish 경로는 이미 발행했으므로 여기서 또 발행하면 이중 계측이다(GROMO-987).
  useEffect(
    () => () => {
      if (!finishedRef.current) {
        cancelLiveSession();
        if (!dwellDoneRef.current) {
          // 가로면 세로 페이저는 가려진 상태 — 뷰 flush를 건너뛰고 방향 체류만 발행(코덱스 리뷰)
          if (orientationRef.current !== 'landscape') flushViewDwell();
          flushOrientationDwell();
        }
        // 종결 계측 — finish를 안 거친 이탈도 abandoned로 남긴다(코덱스 리뷰). 안 남기면
        // 이 세션은 완료/포기 어느 쪽도 안 찍혀 상호배타가 깨진다. 시간 적립은 라이브
        // 레코드가 남아 다음 실행의 고아 정산이 처리하므로 여기선 계측만 한다.
        if (!abandonedRef.current && !completedLoggedRef.current) {
          abandonedRef.current = true;
          logFocusSessionAbandoned({
            elapsed_seconds: Math.floor(sessionRef.current.elapsed),
            reason: 'system_back',
          });
        }
      }
    },
    [cancelLiveSession, flushViewDwell, flushOrientationDwell],
  );

  // 집중 블록 증분 정산 — 마지막 정산 이후 쌓인 집중초(delta)를 로컬·과목·코인에 적립하고
  // 그 구간[settleAt, now]을 서버에 세션으로 업로드한다. 뽀모도로는 집중 블록 끝마다,
  // 그 외 모드는 finish에서 1회 호출된다. 정산 완료분은 라이브 레코드에서 제거(고아 이중정산 방지).
  // endedAtOverride: 빨리감기 리플레이가 '지난 경계의 실제 벽시계 시각'을 지정할 때 쓴다(생략 시 지금).
  // 복귀 시각으로 찍으면 첫 블록 구간이 이후 휴식·블록까지 삼키고 나머지가 0초가 돼
  // 서버 통계(endedAt−startedAt 합산)가 오염된다(코덱스 리뷰).
  const settleFocusBlock = useCallback(
    (endedAtOverride?: string) => {
      const elapsed = Math.floor(sessionRef.current.elapsed);
      const delta = elapsed - settledSecondsRef.current;
      if (delta <= 0) return;
      // 24시간을 넘긴 일시정지는 방해값(서버 DTO 상한 24h)으로 실을 수 없다 — 값만 자르면 초과분이
      // 통째로 집중으로 계상된다(blockPause.ts pauseCutAt 주석). 그런 블록은 '지금'이 아니라
      // 정지 시작 시점에서 끊고, 남은 [정지시작, 지금] 공백은 재개 때 새 블록이 가져간다.
      const cutAt = pauseCutAt(blockPauseRef.current);
      const endedAt = endedAtOverride ?? new Date(cutAt ?? Date.now()).toISOString();
      const startedAt = settleAtRef.current;
      // 이 블록의 방해초 — 아직 안 닫힌 정지 구간(정지 중 정지 버튼으로 종료)까지 포함하되,
      // 구간 끝(endedAt)까지만 센다.
      const totalDistractionSeconds = blockPauseSeconds(blockPauseRef.current, Date.parse(endedAt));
      const distractionCount = blockPauseRef.current.count;
      // 마커·레코드를 적립보다 먼저 갱신 — 적립 후 제거 전에 죽으면 고아 정산이 또 적립한다(원 finish와 동일 순서).
      settledSecondsRef.current = elapsed;
      startBlockAt(endedAt);
      AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession).catch(() => {});
      // 로컬/과목 적립 — 둘 다 '오늘' 기준 스토어라, 이 블록의 집중초 중 오늘 몫만 반영한다
      // (GROMO-1252 — 종전엔 endedAt 하루만 보고 delta 전체를 오늘에 꽂아, 자정을 걸친 블록의
      // 어제 몫까지 오늘로 들어왔다). 몫은 벽시계 겹침이 아니라 집중 tick의 날짜로 센다 —
      // 겹침으로 클램프하면 일시정지가 자정을 걸칠 때 여전히 과다 계상된다(blockToday.ts 주석).
      // 코인은 all-time이라 항상 반영.
      // 이 블록의 날짜별 집중초 — 서버 업로드엔 서버 존 축(프로필 timeZone)을 실어 보낸다
      // (GROMO-1252 ①·②). 로컬 적립은 기기 로컬 축(유저가 보는 '오늘'). 리셋 전에 붙든다.
      // 이 맵은 집중 tick만 센 net 이라 서버가 방해초를 또 빼지 않는다(GROMO-1214).
      const blockToday = blockTodayRef.current;
      const focusSecondsByDate = blockToday.server;
      const todaySeconds = Math.min(delta, blockTodaySeconds(blockToday));
      // 다음 블록은 endedAt부터 — 카운터도 0에서 다시 시작한다. 이탈 스냅샷도 함께 버린다(⑤) —
      // 정산이 이미 이 tick들을 적립했으므로 복귀 리플레이가 스냅샷을 되돌리면 이중 적립이다.
      blockTodayRef.current = newBlockToday();
      leftBlockTodayRef.current = null;
      if (todaySeconds > 0) {
        addFocusSeconds(todaySeconds);
        addFocusToSubject(subjectId, todaySeconds);
        // 내 그리드 셀 오늘 몫에도 같은 귀속 규칙으로 누적 — 리플레이가 렌더 전에 정산해도 안전
        if (gridSettledTodayRef.current.day !== todayStr()) {
          gridSettledTodayRef.current = { day: todayStr(), seconds: 0 };
        }
        gridSettledTodayRef.current.seconds += todaySeconds;
      }
      // 그리드 표시 기준점 확정(코덱스 리뷰 ⑧) — '그 시점 서버가 아는 값'과 '직전 기준점' 중 큰
      // 쪽에 이번 블록의 KST 몫을 얹는다. 정산 시점에 serverBase 를 읽으므로 첫 스냅샷이 정산
      // 뒤에 도착해도 같은 블록을 두 번 세지 않고(④), 다음 블록의 델타는 이 총합 위에 쌓인다(⑧).
      const kstToday = todayStrKst();
      const kstSeconds = blockToday.kst?.[kstToday] ?? 0;
      if (kstSeconds > 0) {
        const prevFloor =
          gridSettledFloorRef.current.day === kstToday ? gridSettledFloorRef.current.seconds : 0;
        // 스냅샷·직전 기준점 모두 **오늘(KST) 것일 때만** 쓴다 — 자정을 넘긴 리플레이가 렌더보다
        // 먼저 여기 닿으면 둘 다 전날 값이라, 날짜를 안 보면 전날 총합이 오늘로 넘어온다(⑩).
        const snap = gridServerSnapshotRef.current;
        const snapshotSeconds = snap?.day === kstToday ? snap.seconds : 0;
        gridSettledFloorRef.current = {
          day: kstToday,
          seconds: Math.max(snapshotSeconds, prevFloor) + kstSeconds,
        };
      }
      // 마커 회전(코덱스 리뷰) — 정산된 블록은 서버 누적(base)에 들어가는데 마커를 그대로 두면
      // 친구 화면 라이브 합산(base + (now − focusStartedAt))에 같은 구간이 두 번 잡힌다.
      // 블록을 정산하는 즉시 마커 참조를 떼고, 다음 집중 블록 시작(break→focus)에서 새로 연다.
      // 종전과 달리 여기서 취소(cancel)하지 않는다 — 이 마커는 아래 업로드가 PATCH로 '종료'해
      // 시간·코인을 귀속시킬 대상이다(GROMO-1214). 취소로 버리면 그 지급 경로가 사라진다.
      // PATCH를 못 태우거나 실패한 경우에만 uploadFocusBlock이 cancelMarker로 닫는다.
      const livePromise = liveStartPromiseRef.current;
      liveIdRef.current = null;
      liveStartPromiseRef.current = Promise.resolve(null);
      // 서버 업로드 — 이번 집중 블록 구간만. 과목명을 서버 태그로 매칭/생성해 tagId를 실어 보낸다
      // (과목별 통계 집계용 — 매칭 실패 시 null = 미분류). 업로드 실패 시 대기열에 남겨
      // 재시도(GROMO-614) — 로컬 적립은 이미 반영돼 그냥 버리면 서버와 불일치. 대기열 바디에도
      // 해석된 tagId를 실어 재시도 시 과목이 유지되게 한다.
      Promise.all([
        ensureFocusTagId(subjectName, userId).catch(() => null),
        livePromise.catch(() => null),
      ])
        .then(([focusTagId, sessionId]) => {
          const body = {
            focusTagId,
            subject: subjectName,
            startedAt,
            endedAt,
            // 이 블록의 수동 일시정지 — 서버가 지급(코인)·일별 통계에서 이만큼 뺀다.
            // 블록마다 그 블록 몫만 싣는다(세션 누적을 매 블록에 중복으로 실으면 과다 차감).
            distractionCount,
            totalDistractionSeconds,
            // 완주 저장에도 세션 유형을 전파 — 마커에만 실으면 RANGE/POMODORO가
            // 전부 INFINITE(서버 기본)로 저장돼 유형별 통계가 오염된다(코덱스 리뷰).
            focusType: FOCUS_TYPE_BY_MODE[mode],
            // 날짜별 집중초(GROMO-1252 ①) — 서버는 [startedAt, endedAt]만으로는 일시정지가 자정을
            // 걸친 블록의 날짜별 몫을 알 수 없다. 서버가 날짜별 벽시계 몫을 상한으로 클램프해 받는다.
            focusSecondsByDate,
          };
          // 업로드는 실패·대기열 인계까지 안에서 끝낸다 — 여기서 던지지 않으므로, 아래 발행
          // 콜백에서 예외가 나도 이미 서버에 저장된 세션이 대기열에 재적재되지 않는다(PR 250 리뷰).
          return uploadFocusBlock({
            sessionId,
            body,
            userId,
            onMarkerStillOpen: (id) => {
              cancelMarker(id, userIdRef.current).catch(() => {});
            },
          }).then((result) => {
            // 저장 실패(대기열행)면 발행 없음 — 결과 화면은 기존 추정 판정으로 폴백.
            if (result.status !== 'saved') return;
            // 지급이 확정됐으니 서버 잔액을 다시 받는다(GROMO-1049) — 화면에 미리 올려 두고
            // 맞추는 방식은 '진행 중이던 조회가 지급 전인지 후인지'를 앱이 알 수 없어 성립하지
            // 않았다. 조회끼리는 CoinContext 의 시퀀스 가드가 순서를 잡아 준다.
            refreshCoins();
            // 서버 스트릭 판정을 결과 화면에 전달(GROMO-807). 결과 화면이 먼저 떠 있어도
            // 구독으로 갱신된다. PATCH 응답도 같은 필드를 실어 주므로 경로 구분 없이 쓴다.
            // 어제 몫으로 귀속된 저장의 응답이면 발행하지 않는다 — 판정의 '그날 누적'이 어제
            // 기준이라 오늘 판정을 오염시키고, 단조증가 가드에 걸려 오늘의 진짜 판정까지 막는다
            // (대기열 flush 미발행과 같은 규칙). 판정 날짜는 endedAt이 아니라 서버가 실제로 쓴
            // 분포 맵의 마지막 날짜다(GROMO-1252 4차 ④ — isTodayVerdict 주석).
            if (isTodayVerdict(focusSecondsByDate, endedAt)) {
              publishSessionSaveVerdict(result.response);
            }
          });
        })
        .catch(() => {});
    },
    [
      addFocusSeconds,
      addFocusToSubject,
      refreshCoins,
      startBlockAt,
      subjectId,
      subjectName,
      userId,
      mode,
    ],
  );

  // 정상 완료 계측(GROMO-1004) 1회 발행 — 완료 게이트(done 시점)와 finish(정지 버튼)가 공유한다.
  // 유저 주도 종료는 모드 무관 완료로 세고, 이탈 타임아웃(abandoned)과 상호배타 — 한 세션은
  // 둘 중 하나만 발행된다. completed 인자(별점 게이트, GROMO-980)와는 별개 기준.
  const logCompletedOnce = useCallback(() => {
    if (completedLoggedRef.current || abandonedRef.current) return;
    completedLoggedRef.current = true;
    logFocusSessionCompleted({
      mode,
      focus_minutes: Math.round(sessionRef.current.elapsed / 60),
      has_tag: Boolean(subjectId),
    });
  }, [mode, subjectId]);

  // 정지/완료 — 남은 집중 블록 정산(적립+서버 업로드) 후 홈으로. 한 번만 실행.
  // completed: 정상 완료 여부(기본 = 세션 done). 결과 화면이 별점 요청(GROMO-980) 게이트로 쓴다 —
  // 중도 이탈(정지·이탈 타임아웃) 세션에 별점창을 띄우면 부정적 순간에 1회 기회가 소모된다(코드리뷰 반영).
  const finish = useCallback(
    async (completed = sessionRef.current.done) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      // 완료 계측 — 완료 게이트가 이미 발행한 세션(카운트다운/뽀모도로 완주)은 가드로 스킵된다.
      logCompletedOnce();
      // 세션 종료(완료/취소 공통 경로) — 보고 있던 뷰의 마지막 체류 flush(GROMO-987).
      // 완료 게이트가 이미 발행했다면 건너뛴다 — 게이트를 열어둔 시간이 직전 뷰의 체류로
      // 다시 계상되는 이중 발행 방지(코덱스 리뷰).
      // 마지막 뷰·방향 체류를 함께 발행(GROMO-973/987). 완료 게이트가 이미 발행했다면 둘 다
      // 건너뛴다 — 게이트를 열어둔 시간이 직전 뷰/방향의 체류로 다시 계상되는 이중 발행 방지(코덱스 리뷰).
      if (!dwellDoneRef.current) {
        // 가로면 세로 페이저는 가려진 상태 — 뷰 flush를 건너뛰고 방향 체류만 발행(코덱스 리뷰)
        if (orientationRef.current !== 'landscape') flushViewDwell();
        flushOrientationDwell();
      }
      // 정상 종료 — 실드·Live Activity 해제
      ScreenTimeModule.stopFocusShield().catch(() => {});
      ScreenTimeModule.endFocusActivity().catch(() => {});
      // 라이브 레코드 제거를 먼저 시도하되, 실패해도 정산은 계속한다(GROMO-615).
      // 제거 실패로 정산까지 건너뛰면 적립·서버 업로드가 통째로 빠진다(보상 유실).
      // 제거는 settleFocusBlock 안에서 한 번 더 시도되고, 그래도 레코드가 남으면
      // 다음 실행의 고아 정산이 마지막 저장분만큼 이중 적립될 수 있으나 미적립보다 낫다.
      await AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession).catch(() => {});
      try {
        settleFocusBlock();
        // 완료·중도 정지 공통 — 표시용 마커는 여기서 항상 취소로 닫는다(GROMO-873).
        cancelLiveSession();
        // 화면을 떠나기 전 마지막 재시도 — 회전 중 실패해 쌓인 취소가 있으면 지금 정리(코덱스 리뷰)
        flushPendingMarkerCancels(userIdRef.current).catch(() => {});
      } finally {
        // 정산 성공 여부와 무관하게 화면은 반드시 빠져나간다 —
        // 집중 결과 화면(GROMO-598)으로 replace, 길이 무관 항상 결과 화면을 보여준다.
        const focusSeconds = Math.floor(sessionRef.current.elapsed);
        navigation.replace('FocusResult', { focusSeconds, subjectId, subjectName, completed });
      }
    },
    [
      settleFocusBlock,
      cancelLiveSession,
      flushViewDwell,
      flushOrientationDwell,
      logCompletedOnce,
      navigation,
      subjectId,
      subjectName,
    ],
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
    if (!session.done || finishedRef.current) return;
    if (doneGate) return; // 게이트가 이미 떠 있으면 재실행에도 진동·정산 반복 금지
    setDoneGate(true);
    shieldedRef.current = false;
    ScreenTimeModule.stopFocusShield().catch(() => {});
    ScreenTimeModule.endFocusActivity().catch(() => {});
    settleFocusBlock();
    // 세션은 이미 끝났으므로 마커도 게이트 시점에 바로 닫는다 — 확인을 누를 때까지 미루면
    // 게이트에 머문 시간만큼 친구 화면에 '집중 중'이 이어져 보인다(코덱스 리뷰). finish에서
    // 또 불려도 라이브 참조가 비어 no-op.
    cancelLiveSession();
    // 마지막 뷰·방향 체류도 게이트가 화면을 덮는 지금 발행 — 확인을 누를 때까지 열어둔 시간은
    // 가려진 뷰를 보거나 방향을 유지하는 게 아니므로 체류에서 제외한다(코덱스 리뷰). finish의 flush는 스킵됨.
    dwellDoneRef.current = true;
    // 가로에선 세로 페이저가 가려져 있고 마지막 페이지 체류는 가로 진입 때 이미 발행됐다 — 여기서 또
    // flush하면 리셋된 character 페이지의 0초 체류가 발행된다(코덱스 리뷰). 방향 체류만 발행한다.
    if (orientationRef.current !== 'landscape') flushViewDwell();
    flushOrientationDwell();
    // 완료 계측도 게이트 시점에 발행 — 게이트를 띄운 채 앱이 종료되면 finish가 안 불려
    // 저장된 세션의 완료 이벤트만 유실된다(코덱스 리뷰). finish에서 또 불려도 가드로 no-op.
    logCompletedOnce();
    Vibration.vibrate(DOUBLE_VIBRATE_PATTERN);
  }, [
    session.done,
    doneGate,
    settleFocusBlock,
    cancelLiveSession,
    flushViewDwell,
    flushOrientationDwell,
    logCompletedOnce,
  ]);

  // 뽀모도로 집중 블록 경계 — 집중→휴식 전환 시 완료된 블록을 정산·서버 업로드,
  // 휴식→집중 전환 시엔 다음 블록 시작으로 서버 구간 기준을 옮겨 휴식 시간을 제외한다.
  // 라이브 전환이면 진동 2번으로 경계를 알린다(GROMO-864). 백그라운드에서 지난 경계도
  // 복귀 시 현재 페이즈가 달라졌다면 한 번 알려준다.
  const prevPhaseRef = useRef(session.phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    const cur = session.phase;
    if (prev === cur) return;
    prevPhaseRef.current = cur;
    Vibration.vibrate(DOUBLE_VIBRATE_PATTERN);
    if (prev === 'focus' && cur === 'break') {
      settleFocusBlock();
    } else if (prev === 'break' && cur === 'focus') {
      startBlockAt(new Date().toISOString());
      if (pausedRef.current) {
        // 휴식 만료 복귀가 다음 블록을 일시정지 대기로 만든 경우 — 지금 열면 대기 내내
        // 친구 화면에 '집중 중'이 흐른다. 마커는 재개 시점에 연다(코덱스 리뷰).
        markerDeferredRef.current = true;
      } else {
        // 다음 집중 블록의 마커를 새로 연다(마커 회전) — 휴식 동안은 미집중으로 보인다.
        startLiveSession(settleAtRef.current);
      }
    }
  }, [session.phase, settleFocusBlock, startLiveSession, startBlockAt]);

  // 이탈 감지 — background 진입 시각을 기록해두고, 복귀 시 자리 비운 시간으로 판정한다.
  const leftAtRef = useRef<number | null>(null);
  const leftPhaseRef = useRef<'focus' | 'break'>('focus');
  // 이탈 시점 세션 스냅샷 — 서스펜드 전에 1초 tick이 몇 번 더 돌면 sessionRef가 leftAt보다
  // 앞서 있어, 복귀 리플레이의 경계 시각(leftAt + i초)이 그만큼 당겨진다(코덱스 리뷰).
  // 리플레이는 이 스냅샷에서 시작하고, 복귀 시 setSession이 전진분을 통째로 덮어쓴다.
  const leftSessionRef = useRef<SessionState | null>(null);
  // 이 세션에서 지금까지 인정한 이탈 크레딧 누적(GROMO-1253). 상한이 '복귀 1회당'이면
  // 백그라운드 왕복을 반복할 때마다 8시간씩 새로 붙어 하루 24시간을 넘긴다(34시간 신고 사례).
  const awayCreditedRef = useRef(0);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      // 나감 — 타이머가 실제 돌고 있을 때만 이탈로 취급(일시정지·완료 중은 무시)
      if (state === 'background') {
        if (sessionRef.current.done || finishedRef.current || pausedRef.current) return;
        leftAtRef.current = Date.now();
        leftPhaseRef.current = sessionRef.current.phase;
        leftSessionRef.current = sessionRef.current; // 리플레이 기준 스냅샷(leftAt과 짝)
        leftBlockTodayRef.current = blockTodayRef.current; // 날짜 맵도 같은 시점으로 되감는다(코드리뷰 ⑤)
        saveLive(sessionRef.current.elapsed); // 여기서 꺼져도 이 시점까지는 정산되게
        // 실드 세션은 나가 있어도 집중 인정이라 이탈 알림 없음(폴백 세션만 경고)
        if (sessionRef.current.phase === 'focus' && !shieldedRef.current) {
          scheduleLeaveNotifications(subjectName, LEAVE_END_S).catch(() => {});
        }
        // OS 예약 알림은 JS 프로세스가 종료된 뒤에도 남지만, 현재 고아 세션 레코드만으로는
        // 남은 타이머/뽀모도로 페이즈와 결과 화면을 복구할 수 없다. 실제 완료를 복구할 수 없는
        // 알림이 발송되지 않도록 백그라운드 경계 알림은 예약하지 않는다(코덱스 리뷰).
        return;
      }
      if (state !== 'active' || leftAtRef.current == null) return;

      // 복귀 — 자리 비운 시간 계산 (leftAtMs는 리플레이 경계 시각 복원용으로 보관)
      const leftAtMs = leftAtRef.current;
      // 하한 0 — 백그라운드 중 기기 시계가 뒤로 가면(수동 변경·NTP 보정) 음수가 된다. 그대로 두면
      // 실드 크레딧 잔량이 되레 늘고(코드리뷰), 카운트다운은 `display - away`로 남은 시간이 늘어난다.
      // 소비처가 넷이라 계산 지점에서 한 번에 막는다.
      const away = Math.max(0, Math.round((Date.now() - leftAtMs) / 1000));
      leftAtRef.current = null;
      cancelLeaveNotifications().catch(() => {});
      const distractionTimedOut =
        leftPhaseRef.current === 'focus' && !shieldedRef.current && away > LEAVE_END_S;
      // AppState만으로는 실드가 실제로 외부 앱을 차단했는지 알 수 없다. 실드 세션은
      // 홈 이동·기기 잠금·허용 앱 사용도 같은 콜백으로 들어오므로 차단 성공으로 기록하지 않고,
      // 차단 결과를 관측할 수 있는 일반 세션만 이탈 이벤트를 발행한다.
      if (leftPhaseRef.current === 'focus' && !shieldedRef.current && !distractionTimedOut) {
        logFocusDistractionDetected({
          reason: 'app_backgrounded',
          app_category: 'other',
          blocked: false,
          returned_to_focus: true,
        });
      }
      // 복귀 = 연결이 돌아왔을 가능성이 큰 시점 — 회전 중 실패한 마커 취소 재시도(코덱스 리뷰)
      flushPendingMarkerCancels(userIdRef.current).catch(() => {});
      if (__DEV__)
        console.log(`[이탈감지] ${away}초 만에 복귀 (실드 ${shieldedRef.current ? 'ON' : 'OFF'})`);
      if (sessionRef.current.done || finishedRef.current) return;

      if (leftPhaseRef.current === 'focus') {
        if (shieldedRef.current) {
          // 실드 세션 — 딴짓이 차단된 상태였으므로 자리 비운 시간을 집중으로 인정(전진).
          // 전진분은 즉시 저장 — 다음 5초 주기 저장 전에 강제 종료되면
          // 방금 인정한 시간이 고아 정산 대상에서 통째로 빠진다.
          // 상한은 세션 누적 기준 — 복귀 1회당이면 왕복 횟수만큼 곱해진다(GROMO-1253)
          const credit = Math.min(away, Math.max(0, AWAY_CREDIT_CAP_S - awayCreditedRef.current));
          awayCreditedRef.current += credit;
          // 리플레이는 이탈 시점 스냅샷에서 시작 — 서스펜드 전에 더 돈 tick으로 sessionRef가
          // 앞서 있어도 경계 시각(leftAt + i초)과 어긋나지 않는다. 그 tick 전진분은 아래
          // setSession(cur)이 덮어써 이중 계상 없음(settledSecondsRef 단조 가드도 동일 방어).
          let cur = leftSessionRef.current ?? sessionRef.current;
          leftSessionRef.current = null;
          // 세션 상태를 되감는 만큼 날짜 맵도 이탈 시점으로 되돌린다 — 안 그러면 서스펜드 전에 더 돈
          // tick이 리플레이에서 두 번 세진다(코드리뷰 ⑤). 정산이 끼었으면(스냅샷 null) 현재 값 유지.
          if (leftBlockTodayRef.current != null) blockTodayRef.current = leftBlockTodayRef.current;
          leftBlockTodayRef.current = null;
          let crossed = false;
          // 연속 집중 tick은 모아서 한 번에 적립한다(GROMO-1252 코드리뷰 6차 ④) — 8시간 크레딧이면
          // 28,800회라 tick마다 존 포맷(Intl)·객체 스프레드를 돌면 setSession 전에 JS 스레드가 멈춘다.
          // 정산(settleFocusBlock)은 날짜 맵을 읽고 리셋하므로 그 직전에 반드시 flush 한다.
          let pendingFromMs = 0;
          let pendingTicks = 0;
          const flushTicks = () => {
            if (pendingTicks > 0) creditFocusTicks(new Date(pendingFromMs), pendingTicks);
            pendingTicks = 0;
          };
          for (let i = 0; i < credit && !cur.done; i++) {
            const next = nextTick(cur);
            // 빨리감기가 지나치는 페이즈 경계도 실시간과 동일하게 정산·마커 회전 — 최종 페이즈만
            // 비교하면 집중→휴식→집중 한 바퀴(같은 페이즈 복귀)가 경계 없음으로 보여 옛 마커가
            // 휴식 시간까지 계속 흐른다(코덱스 리뷰).
            // 경계 시각은 '지금'이 아니라 실제 지난 벽시계로 복원한다 — 실드 전진은 자리 비운
            // 1초당 1 tick이라 i번째 tick 종료 = leftAt + (i+1)초(코덱스 리뷰).
            const boundaryMs = leftAtMs + (i + 1) * 1000;
            // 리플레이 tick도 '실제로 지난 시각'의 날짜로 오늘 몫에 적립한다(GROMO-1252 코드리뷰) —
            // 자정을 넘겨 복귀하면 자정 전 tick은 어제 몫이다. 정산(아래)이 카운터를 리셋하므로
            // 반드시 정산보다 먼저 센다. 1초 간격이 끊기면(뽀모도로 휴식) 묶음을 닫고 새로 연다.
            if (next.elapsed > cur.elapsed) {
              if (pendingTicks > 0 && boundaryMs !== pendingFromMs + pendingTicks * 1000)
                flushTicks();
              if (pendingTicks === 0) pendingFromMs = boundaryMs;
              pendingTicks++;
            }
            if (cur.phase === 'focus' && next.done) {
              // 마지막 블록 완료(카운트다운·뽀모도로 마지막 세트)를 백그라운드에서 넘긴 경우 —
              // 완료 경계 시각으로 정산해 완료~복귀 공백이 집중으로 계상되지 않게 한다(코덱스
              // 리뷰). 뒤따르는 done 이펙트의 정산은 delta 0 no-op, 마커도 여기서 이미 닫힌다.
              sessionRef.current = next;
              flushTicks();
              settleFocusBlock(new Date(boundaryMs).toISOString());
            } else if (cur.phase === 'focus' && next.phase === 'break') {
              crossed = true;
              sessionRef.current = next; // 정산이 경계 시점의 경과초를 읽도록 먼저 반영
              flushTicks();
              settleFocusBlock(new Date(boundaryMs).toISOString());
            } else if (cur.phase === 'break' && next.phase === 'focus') {
              crossed = true;
              // 새 집중 블록 시작 — 방해 카운터도 함께 리셋(GROMO-1214, startBlockAt).
              const boundaryAt = new Date(boundaryMs).toISOString();
              startBlockAt(boundaryAt);
              startLiveSession(boundaryAt);
            }
            cur = next;
          }
          flushTicks(); // 루프 종료분 — 아래 상한 부분정산·setSession 전에 반영
          // 크레딧 상한(8h)에 걸려 전진이 멈춘 경우 — 상한 시각으로 부분 정산하고 복귀 시점에서
          // 다시 연다. 안 하면 상한~복귀의 미인정 공백이 다음 정산 구간과 라이브 표시에 집중으로
          // 계상된다(코덱스 리뷰). 휴식 중 상한은 정산 구간에 안 들어가므로 집중 페이즈만.
          if (!cur.done && away > credit && cur.phase === 'focus') {
            sessionRef.current = cur;
            settleFocusBlock(new Date(leftAtMs + credit * 1000).toISOString());
            // 상한이 정확히 블록 경계(휴식→집중 직후)에 떨어지면 정산할 델타가 0이라 settle이
            // 마커를 안 닫는다 — 직전에 연 과거 마커가 아래 startLiveSession의 참조 덮어쓰기로
            // 유실돼 12h 스윕까지 '집중 중'으로 되살아나지 않게 명시적으로 닫는다(코덱스 리뷰).
            // settle이 이미 회전했다면 참조가 비어 no-op.
            cancelLiveSession();
            startBlockAt(new Date().toISOString());
            startLiveSession(settleAtRef.current);
          }
          if (crossed) {
            // 페이즈 이펙트가 같은 경계를 또 처리(마커 이중 오픈)하지 않게 기준을 동기화하고,
            // 지나온 경계는 진동 한 번으로만 알린다(기존 '복귀 시 한 번 알림' 동작 유지).
            prevPhaseRef.current = cur.phase;
            Vibration.vibrate(DOUBLE_VIBRATE_PATTERN);
          }
          setSession(cur);
          saveLive(cur.elapsed);
        } else if (away > LEAVE_END_S) {
          // 폴백(실드 없음) — 15초 초과 시 자동 종료(나가기 직전까지만 저장)
          // 정상 완료가 아닌 중도 이탈 종료이므로 abandoned 계측(reason: leave_timeout).
          abandonedRef.current = true;
          logFocusDistractionDetected({
            reason: 'leave_timeout',
            app_category: 'other',
            blocked: false,
            returned_to_focus: false,
          });
          logFocusSessionAbandoned({
            elapsed_seconds: Math.floor(sessionRef.current.elapsed),
            reason: 'leave_timeout',
          });
          finish();
        }
      } else {
        // 휴식 중 이탈 — 벽시계만큼 휴식만 소진. 휴식이 끝나 있으면 다음 집중을 일시정지로 대기.
        const cur = sessionRef.current;
        if (cur.phase !== 'break') return;
        if (away < cur.display) {
          setSession({ ...cur, display: cur.display - away });
        } else {
          setPaused(true);
          setSession({
            ...cur,
            display: pomo.focusMin * 60,
            phase: 'focus',
            setIndex: cur.setIndex + 1,
          });
        }
      }
    });
    return () => {
      sub.remove();
      cancelLeaveNotifications().catch(() => {});
    };
  }, [
    subjectName,
    finish,
    pomo.focusMin,
    pomo.breakMin,
    pomo.sets,
    saveLive,
    nextTick,
    mode,
    settleFocusBlock,
    startLiveSession,
    cancelLiveSession,
    creditFocusTicks,
    startBlockAt,
  ]);

  // 일시정지/재개 토글 — 새 상태에 맞춰 계측. 상태 업데이터 안이 아니라 여기서 발행(중복 방지).
  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    setPaused(next);
    if (next) {
      // 방해초(GROMO-1214 코드리뷰) — 정지 시작 시각을 찍고 횟수를 센다. 여기(유저 조작)에서만
      // 연다: 휴식 만료 복귀가 만드는 '일시정지 대기'는 아래 markerDeferred 분기가 정산 구간
      // 자체를 재개 시점으로 밀어 이미 제외되므로, 방해초로 또 빼면 이중 차감이다.
      blockPauseRef.current = pauseStart(blockPauseRef.current);
      logFocusSessionPaused({ elapsed_seconds: Math.floor(sessionRef.current.elapsed) });
    } else if (pauseCutAt(blockPauseRef.current) != null) {
      // 24시간을 넘긴 정지에서 재개 — 방해값으로 실을 수 없는 구간이라 블록 자체를 끊는다
      // (blockPause.ts pauseCutAt 주석). 정산은 정지 시작 시점까지만 올리고, 재개 시점부터
      // 새 블록·새 마커를 연다. 정지 구간은 어느 블록에도 안 들어가 집중으로 계상되지 않는다.
      const resumedAt = new Date().toISOString();
      settleFocusBlock();
      // 정산할 델타가 0이면 위 정산이 마커를 회전하지 않는다 — 참조를 덮어쓰기 전에 닫는다(회전했으면 no-op).
      cancelLiveSession();
      startBlockAt(resumedAt);
      blockPauseRef.current = newBlockPause(); // 열린 정지 구간은 새 블록으로 넘기지 않는다
      startLiveSession(settleAtRef.current);
      logFocusSessionResumed();
    } else {
      blockPauseRef.current = pauseEnd(blockPauseRef.current);
      // 일시정지 대기로 유예해둔 다음 블록 마커 — 실제 집중이 시작되는 재개 시점부터 연다.
      // 정산 기준(settleAt)도 재개 시점으로 — 대기 동안은 경과초가 멈춰 있어 안전(코덱스 리뷰).
      if (markerDeferredRef.current) {
        markerDeferredRef.current = false;
        startBlockAt(new Date().toISOString());
        startLiveSession(settleAtRef.current);
      }
      logFocusSessionResumed();
    }
  }, [startLiveSession, startBlockAt, settleFocusBlock, cancelLiveSession]);

  // 정지 버튼(사용자 수동 종료) — 유저가 직접 마친 세션이므로 모드 무관 completed로 계측한다
  // (GROMO-1004, abandoned는 이탈 타임아웃 전용 — finish 안에서 발행). completed 인자는 별점
  // 게이트(GROMO-980) 기준이라 그대로 둔다 — 중도 정지엔 별점창을 띄우지 않는 결정 유지.
  const stopByUser = useCallback(() => {
    // countup은 done이 없어 정지가 유일한 정상 종료 경로 — 완료로 취급한다(별점 게이트용).
    finish(sessionRef.current.done || mode === 'countup');
  }, [finish, mode]);

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
      text: '집중 세션이 시작됐어!\n여기서 흐른 시간이 그대로 과목의 공부 기록이 돼.',
      character: require('@/assets/character_study.png'),
    },
    {
      text: '화면을 옆으로 넘겨봐 —\n친구·그룹·같은 시험 준비생·전체 리그가 공부하는 모습을 볼 수 있어.',
      character: require('@/assets/character_happy.png'),
      anchor: dotsRef,
    },
    {
      text: '메뉴에서는 과목을 바꾸거나 오늘의 과목별 기록을 볼 수 있어.',
      character: require('@/assets/character_hi.png'),
      anchor: hamburgerRef,
      round: true,
    },
    {
      text: '잠깐 쉴 땐 일시정지, 끝낼 땐 정지!\n정지하면 기록이 저장되고 결과 화면으로 넘어가.',
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
  // 정산 시점에 읽을 수 있게 최신 스냅샷을 ref 로 옮겨 둔다.
  gridServerSnapshotRef.current =
    gridServerToday != null ? { day: gridKstDay, seconds: gridServerToday * 60 } : null;
  // 기준점은 KST 날짜가 바뀌면 0으로 — 자정 이후 새 날의 값이 전날 총합에 묶이면 안 된다.
  if (gridSettledFloorRef.current.day !== gridKstDay) {
    gridSettledFloorRef.current = { day: gridKstDay, seconds: 0 };
  }
  // 아직 정산되지 않은 집중초 중 '오늘' 몫(GROMO-1252 코드리뷰) — 그리드 셀·메뉴 드로어 공용.
  // session.elapsed 전체를 쓰면 ① 자정을 걸친 세션의 어제 몫까지 오늘로 표시되고(23:00~00:05
  // 세션이 65분으로 보이다가 정산 후 5분으로 줄어드는 역전) ② 뽀모도로처럼 이미 정산된 블록이
  // 저장분과 이중으로 잡힌다. 타이머 tick마다 리렌더되므로 ref를 그대로 읽어도 값이 따라 오른다.
  const liveTodaySeconds = blockTodaySeconds(blockTodayRef.current);
  // 표시 기준은 멤버 셀과 같은 서버 KST 버킷(GROMO-1246) — 로컬 집계는 서버 스냅샷을 못
  // 받았을 때(그룹 미가입·조회 실패·자정 넘겨 무효화)의 폴백으로만 쓴다. 측정·저장 경로는
  // 그대로다(1236의 "측정 축은 로컬 유지" 결정 유지 — 바뀌는 건 표시 결합부뿐).
  // 계산 결과를 바닥에 되먹여 다음 렌더의 하한으로 삼는다(정산 직후 되밀림 방지).
  const gridTotalSeconds = myLiveTotalSeconds({
    serverBase: gridServerToday != null ? gridServerToday * 60 : null,
    delta: blockKstTodaySeconds(blockTodayRef.current),
    localFallback:
      (gridPreSessionRef.current.day === gridDay ? gridPreSessionRef.current.base : 0) +
      (gridSettledTodayRef.current.day === gridDay ? gridSettledTodayRef.current.seconds : 0) +
      liveTodaySeconds,
    settledFloor: gridSettledFloorRef.current.seconds,
    // 서버 버킷이 KST 고정(GROMO-1259)이라 동축 판정은 기기 오프셋이 KST인지로 족하다.
    sameAxis: kstLocalSameDay(),
  });
  const myGridMe = {
    nickname: nickname || '나',
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
              accessibilityLabel="가로 화면으로 전환"
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
            accessibilityLabel="집중 메뉴 열기"
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
              title="내 친구"
              emptyTitle="아직 친구가 없어요"
              emptySub={'리그 탭에서 친구를 추가하면\n집중할 때 여기서 같이 보여요.'}
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
          {sessionGroups.map((g) => (
            <View
              key={g.groupId}
              testID={`focus.group.page.${g.groupId}`}
              style={[s.page, { width }]}
            >
              <LiveFocusGrid
                members={g.members}
                me={myGridMe}
                showMeWhenEmpty
                title={`그룹: ${g.groupName}`}
                emptyTitle="아직 그룹 멤버가 없어요"
                emptySub={'그룹에 멤버가 모이면\n집중할 때 여기서 같이 보여요.'}
              />
            </View>
          ))}
          <View style={[s.page, { width }]}>
            <LiveFocusGrid
              members={examMembers}
              me={myGridMe}
              pinnedIds={pinnedIds}
              title={myCategory ? `${myCategory} 리그` : '같은 시험'}
              emptyTitle={
                myOccupation == null
                  ? '준비 시험이 설정되지 않았어요'
                  : '아직 같은 시험 준비생이 없어요'
              }
              emptySub={
                myOccupation == null
                  ? '준비 시험을 설정하면\n같은 시험 준비생들이 여기 보여요.'
                  : '곧 같은 목표의 유저들이\n여기에 모여요.'
              }
            />
          </View>
          <View style={[s.page, { width }]}>
            <LiveFocusGrid
              members={leagueMembers}
              me={myGridMe}
              pinnedIds={pinnedIds}
              title="전체 리그"
              emptyTitle="아직 리그 멤버가 없어요"
              emptySub={'리그에 배정되면 여기서\n같이 공부하는 모습이 보여요.'}
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
          <Text style={s.doneGateTitle}>집중이 끝났어요!</Text>
          <Text style={s.doneGateSub}>
            {mode === 'pomodoro'
              ? `${subjectName} ${pomo.sets}세트를 모두 마쳤어요.`
              : `${subjectName} 집중을 끝까지 해냈어요.`}
          </Text>
          {/* onPress에 finish를 직접 넘기면 제스처 이벤트가 completed 인자로 들어간다 — 래핑 필수 */}
          <PressableScale style={s.doneGateBtn} haptic="light" onPress={() => finish()}>
            <Text style={s.doneGateBtnText}>확인</Text>
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
        <Text style={s.roGoal}>목표 {hms(goal)}</Text>
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
            세트 {session.setIndex} / {pomo.sets}
          </Text>
        </View>
      </View>
      <Text style={s.roSubject} numberOfLines={1}>
        {session.phase === 'focus' ? subjectName : '휴식'}
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
