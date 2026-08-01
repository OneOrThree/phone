import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureRef } from 'react-native-view-shot';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T, withAlpha } from '@/constants/theme';
import { saveFocusSession, startFocusSession, cancelFocusSession } from '@/services/focusApi';
import type { FocusType } from '@/types/dto/focus';
import { ensureFocusTagId } from './tagSync';
import { enqueuePendingFocusUpload } from './pendingFocusUploads';
import { publishSessionSaveVerdict } from './sessionSaveVerdict';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { useFocus } from '@/store/FocusContext';
import { useCoins } from '@/store/CoinContext';
import { useSubjects } from '@/store/SubjectContext';
import { useUser } from '@/store/UserContext';
import { STORAGE_KEYS } from '@/types/storage';
import type { V2RootStackParamList } from '@/navigation/types';
import type { FocusTimerMode, LiveFocusSession } from './types';
import { hms } from './format';
import { scheduleLeaveNotifications, cancelLeaveNotifications } from './leaveNotifications';
import { todayStr, localDateStr } from '@/utils/localDate';
import { useFocusFriends } from '@/screens/league/useFocusFriends';
import { useFocusCategory } from '@/hooks/useFocusCategory';
import { occupationForCategory } from '@/constants/focusCategories';
import { useSessionLeagueMembers } from './useSessionLeagueMembers';
import { LiveFocusGrid } from './components/LiveFocusGrid';
import { FocusMenuDrawer } from './components/FocusMenuDrawer';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
import {
  logFocusSessionStarted,
  logFocusSessionPaused,
  logFocusSessionResumed,
  logFocusSessionAbandoned,
  logFocusMenuOpened,
  logFocusViewChanged,
  type FocusViewName,
} from '@/services/analyticsEvents';

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
const PAGE_VIEWS: FocusViewName[] = ['character', 'friends', 'my_league', 'all_league'];

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
  const goal = params.goalSeconds ?? 25 * 60;
  const pomo = params.pomodoro ?? { focusMin: 25, breakMin: 5, sets: 4 };

  const { width } = useWindowDimensions();
  const { userId, nickname } = useUser();
  const { addFocusSeconds, todayFocusSeconds } = useFocus();
  const { addCoins } = useCoins();
  const { subjects, addFocusToSubject } = useSubjects();
  // Live Activity 시작 시점에 읽을 과목 목록 — effect 재실행 없이 최신값 참조용
  const subjectsRef = useRef(subjects);
  subjectsRef.current = subjects;

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
      view: PAGE_VIEWS[pageRef.current] ?? 'character',
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
        if (dwellLeftAtRef.current == null) dwellLeftAtRef.current = Date.now();
      } else if (state === 'active' && dwellLeftAtRef.current != null) {
        dwellAwayMsRef.current += Date.now() - dwellLeftAtRef.current;
        dwellLeftAtRef.current = null;
      }
    });
    return () => sub.remove();
  }, []);
  const finishedRef = useRef(false);
  const startedAtRef = useRef(new Date().toISOString());
  // 서버 업로드 정산 마커 — 이미 정산(로컬·코인·서버 업로드)된 집중초/코인, 미정산 구간 시작 시각.
  // 뽀모도로는 집중 블록마다, 그 외 모드는 종료 시 한 번 정산한다.
  const settledSecondsRef = useRef(0);
  const settledCoinsRef = useRef(0);
  const settleAtRef = useRef(startedAtRef.current);
  // 서버 라이브 마커 세션(GROMO-873) — 시작 시 진행 중(endedAt NULL) 레코드를 만들어 친구/리그에
  // '집중 중'으로 뜨게 한다. 표시용 마커일 뿐 시간 저장·통계는 기존 완주 저장(POST, settleFocusBlock)이
  // 담당하고, 마커는 블록 정산·세션 종료 시 취소(통계 미귀속)로 닫는다 — 이중 집계 없음. liveIdRef는
  // 라이브 레코드 저장용 스냅샷, liveStartPromiseRef는 시작 응답 시퀀싱용 — 응답 전에 취소가 걸려도
  // 순서대로 처리된다.
  const liveIdRef = useRef<string | null>(null);
  const liveStartPromiseRef = useRef<Promise<string | null>>(Promise.resolve(null));
  // 취소 실패한 마커 id 보관 — 회전 중 버리면 옛 마커가 열린 채 남아 친구 화면에 옛 블록
  // 시작부터의 '집중 중'으로 되살아난다(코덱스 리뷰). 새 마커 시작·앱 복귀·종료 시 재시도하고,
  // 그래도 남으면 서버 고아 스윕(12h)이 최후 보루.
  const pendingCancelIdsRef = useRef<Set<string>>(new Set());
  const flushPendingCancels = useCallback(() => {
    for (const sessionId of [...pendingCancelIdsRef.current]) {
      cancelFocusSession({ sessionId })
        .then(() => pendingCancelIdsRef.current.delete(sessionId))
        .catch(() => {});
    }
  }, []);
  // 휴식 만료 복귀가 다음 블록을 일시정지 대기로 만든 경우 — 마커 오픈을 재개 시점까지 유예(코덱스 리뷰)
  const markerDeferredRef = useRef(false);

  // 집중 세션 시작 계측(GROMO-537) — 실제 세션 화면 진입 시 1회.
  // has_tag: 과목 부착 여부(현재 v2는 과목 선택이 필수라 항상 true지만, 계약상 명시). mode: 타이머 모드.
  // 완료(focus_session_completed)는 서버 검증 이벤트[S]라 클라에서 발행하지 않는다.
  useEffect(() => {
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
    });
  }, [subjectId, mode, goal, pomo.focusMin, pomo.sets]);

  // 서버에 라이브 마커 시작을 등록 — 등록돼야 친구/리그 화면에 '집중 중'(과목명 포함)으로 보인다.
  // 태그를 해석해 실어 보내되, 실패(오프라인 등)해도 세션·시간 저장은 영향 없다(마커는 표시용).
  // sessionId는 promise로 전달 — 취소가 시작 응답보다 먼저 걸려도 순서대로 처리된다.
  const startLiveSession = useCallback(
    (startedAt: string) => {
      // 회전 시점 = 연결이 살아있을 가능성이 큰 시점 — 밀린 취소부터 재시도(코덱스 리뷰)
      flushPendingCancels();
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
          () => null,
        );
      liveStartPromiseRef.current = promise;
      return promise;
    },
    [subjectName, userId, mode, flushPendingCancels],
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
      setSession((prev) => (prev.done ? prev : nextTick(prev)));
    }, 1000);
    return () => clearInterval(id);
  }, [nextTick]);

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
  // settleFocusBlock의 완주 저장(POST)이 별도로 담당하므로 취소해도 기록은 잃지 않는다.
  // 실패(오프라인 등)해도 서버 고아 스윕이 정리하므로 fire-and-forget.
  const cancelLiveSession = useCallback(() => {
    const livePromise = liveStartPromiseRef.current;
    liveIdRef.current = null;
    liveStartPromiseRef.current = Promise.resolve(null);
    livePromise
      .then((sessionId) => {
        if (sessionId == null) return;
        // 취소 실패 시 id를 버리지 않고 보관 — 재시도(flushPendingCancels)로 닫는다(코덱스 리뷰)
        return cancelFocusSession({ sessionId }).catch(() => {
          pendingCancelIdsRef.current.add(sessionId);
        });
      })
      // 이 취소의 성패가 확정된 뒤 밀린 취소를 재시도 — finish의 flush가 진행 중이던 마지막
      // 취소보다 먼저 돌아 실패분을 놓치는 순서 경합 방지(코덱스 리뷰). 체인은 언마운트 후에도
      // 살아 있어 정지 직후 화면을 떠나도 재시도가 한 번은 돈다.
      .then(() => {
        if (pendingCancelIdsRef.current.size > 0) flushPendingCancels();
      })
      .catch(() => {});
  }, [flushPendingCancels]);

  // finish를 거치지 않는 언마운트(안드로이드 시스템 back 등)에서도 마커를 닫는다 — 안 닫으면
  // 서버 스윕(12h)까지 친구 화면에 '집중 중'으로 남는다(코덱스 리뷰). 정상 종료는 finish/완료
  // 게이트가 이미 취소했으므로 no-op(라이브 참조가 비어 있음). 마지막 뷰 체류도 같은 조건으로
  // flush — finish 경로는 이미 발행했으므로 여기서 또 발행하면 이중 계측이다(GROMO-987).
  useEffect(
    () => () => {
      if (!finishedRef.current) {
        cancelLiveSession();
        if (!dwellDoneRef.current) flushViewDwell();
      }
    },
    [cancelLiveSession, flushViewDwell],
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
      const endedAt = endedAtOverride ?? new Date().toISOString();
      const startedAt = settleAtRef.current;
      // 마커·레코드를 적립보다 먼저 갱신 — 적립 후 제거 전에 죽으면 고아 정산이 또 적립한다(원 finish와 동일 순서).
      settledSecondsRef.current = elapsed;
      const totalCoins = Math.floor(elapsed / 10);
      const newCoins = totalCoins - settledCoinsRef.current;
      settledCoinsRef.current = totalCoins;
      settleAtRef.current = endedAt;
      AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession).catch(() => {});
      // 로컬/과목 적립 — 둘 다 '오늘' 기준 스토어라, 리플레이가 자정을 넘겨 정산하는 어제
      // 블록(endedAt이 오늘 아님)은 반영하지 않는다(고아 정산과 동일 규칙, 코덱스 리뷰).
      // 코인은 all-time이라 항상 반영.
      if (localDateStr(new Date(endedAt)) === todayStr()) {
        addFocusSeconds(delta);
        addFocusToSubject(subjectId, delta);
      }
      if (newCoins > 0) addCoins(newCoins);
      // 마커 회전(코덱스 리뷰) — 정산된 블록은 서버 누적(base)에 들어가는데 마커를 그대로 두면
      // 친구 화면 라이브 합산(base + (now − focusStartedAt))에 같은 구간이 두 번 잡힌다.
      // 블록을 정산하는 즉시 마커를 닫고, 다음 집중 블록 시작(break→focus)에서 새로 연다.
      cancelLiveSession();
      // 서버 업로드 — 이번 집중 블록 구간만. 과목명을 서버 태그로 매칭/생성해 tagId를 실어 보낸다
      // (과목별 통계 집계용 — 매칭 실패 시 null = 미분류). 업로드 실패 시 대기열에 남겨
      // 재시도(GROMO-614) — 로컬 적립은 이미 반영돼 그냥 버리면 서버와 불일치. 대기열 바디에도
      // 해석된 tagId를 실어 재시도 시 과목이 유지되게 한다.
      ensureFocusTagId(subjectName, userId)
        .catch(() => null)
        .then((focusTagId) => {
          const body = {
            focusTagId,
            subject: subjectName,
            startedAt,
            endedAt,
            distractionCount: 0,
            totalDistractionSeconds: 0,
            // 완주 저장에도 세션 유형을 전파 — 마커(취소됨)에만 실으면 RANGE/POMODORO가
            // 전부 INFINITE(서버 기본)로 저장돼 유형별 통계가 오염된다(코덱스 리뷰).
            focusType: FOCUS_TYPE_BY_MODE[mode],
          };
          // onRejected 2인자 형태 — .then().catch() 체인이면 발행(구독 콜백) 중 예외까지 실패
          // 핸들러로 새서, 이미 서버에 저장된 세션이 대기열에 재적재돼 중복 업로드된다(PR 250 리뷰).
          return saveFocusSession(body).then(
            // 저장 성공 — 서버 스트릭 판정을 결과 화면에 전달(GROMO-807). 결과 화면이 먼저 떠 있어도
            // 구독으로 갱신된다.
            (res) => {
              // 리플레이가 자정을 넘겨 어제 날짜(endedAt)의 블록을 저장한 응답이면 발행하지
              // 않는다 — 판정의 '그날 누적'이 어제 기준이라 오늘 판정을 오염시키고, 단조증가
              // 가드에 걸려 오늘의 진짜 판정까지 막는다(대기열 flush 미발행과 같은 규칙, 코덱스 리뷰).
              if (localDateStr(new Date(endedAt)) === todayStr()) publishSessionSaveVerdict(res);
            },
            // 저장 실패 — 대기열행(발행 없음). 결과 화면은 기존 추정 판정으로 폴백.
            () => {
              enqueuePendingFocusUpload(body, userId).catch(() => {});
            },
          );
        })
        .catch(() => {});
    },
    [
      addFocusSeconds,
      addFocusToSubject,
      addCoins,
      cancelLiveSession,
      subjectId,
      subjectName,
      userId,
      mode,
    ],
  );

  // 정지/완료 — 남은 집중 블록 정산(적립+서버 업로드) 후 홈으로. 한 번만 실행.
  // completed: 정상 완료 여부(기본 = 세션 done). 결과 화면이 별점 요청(GROMO-980) 게이트로 쓴다 —
  // 중도 이탈(정지·이탈 타임아웃) 세션에 별점창을 띄우면 부정적 순간에 1회 기회가 소모된다(코드리뷰 반영).
  const finish = useCallback(
    async (completed = sessionRef.current.done) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      // 세션 종료(완료/취소 공통 경로) — 보고 있던 뷰의 마지막 체류 flush(GROMO-987).
      // 완료 게이트가 이미 발행했다면 건너뛴다 — 게이트를 열어둔 시간이 직전 뷰의 체류로
      // 다시 계상되는 이중 발행 방지(코덱스 리뷰).
      if (!dwellDoneRef.current) flushViewDwell();
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
        flushPendingCancels();
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
      flushPendingCancels,
      flushViewDwell,
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
    // 마지막 뷰 체류도 게이트가 화면을 덮는 지금 발행 — 확인을 누를 때까지 열어둔 시간은
    // 가려진 뷰를 보는 게 아니므로 체류에서 제외한다(코덱스 리뷰). finish의 flush는 스킵됨.
    dwellDoneRef.current = true;
    flushViewDwell();
    Vibration.vibrate(DOUBLE_VIBRATE_PATTERN);
  }, [session.done, doneGate, settleFocusBlock, cancelLiveSession, flushViewDwell]);

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
      settleAtRef.current = new Date().toISOString();
      if (pausedRef.current) {
        // 휴식 만료 복귀가 다음 블록을 일시정지 대기로 만든 경우 — 지금 열면 대기 내내
        // 친구 화면에 '집중 중'이 흐른다. 마커는 재개 시점에 연다(코덱스 리뷰).
        markerDeferredRef.current = true;
      } else {
        // 다음 집중 블록의 마커를 새로 연다(마커 회전) — 휴식 동안은 미집중으로 보인다.
        startLiveSession(settleAtRef.current);
      }
    }
  }, [session.phase, settleFocusBlock, startLiveSession]);

  // 이탈 감지 — background 진입 시각을 기록해두고, 복귀 시 자리 비운 시간으로 판정한다.
  const leftAtRef = useRef<number | null>(null);
  const leftPhaseRef = useRef<'focus' | 'break'>('focus');
  // 이탈 시점 세션 스냅샷 — 서스펜드 전에 1초 tick이 몇 번 더 돌면 sessionRef가 leftAt보다
  // 앞서 있어, 복귀 리플레이의 경계 시각(leftAt + i초)이 그만큼 당겨진다(코덱스 리뷰).
  // 리플레이는 이 스냅샷에서 시작하고, 복귀 시 setSession이 전진분을 통째로 덮어쓴다.
  const leftSessionRef = useRef<SessionState | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      // 나감 — 타이머가 실제 돌고 있을 때만 이탈로 취급(일시정지·완료 중은 무시)
      if (state === 'background') {
        if (sessionRef.current.done || finishedRef.current || pausedRef.current) return;
        leftAtRef.current = Date.now();
        leftPhaseRef.current = sessionRef.current.phase;
        leftSessionRef.current = sessionRef.current; // 리플레이 기준 스냅샷(leftAt과 짝)
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
      const away = Math.round((Date.now() - leftAtMs) / 1000);
      leftAtRef.current = null;
      cancelLeaveNotifications().catch(() => {});
      // 복귀 = 연결이 돌아왔을 가능성이 큰 시점 — 회전 중 실패한 마커 취소 재시도(코덱스 리뷰)
      flushPendingCancels();
      if (__DEV__)
        console.log(`[이탈감지] ${away}초 만에 복귀 (실드 ${shieldedRef.current ? 'ON' : 'OFF'})`);
      if (sessionRef.current.done || finishedRef.current) return;

      if (leftPhaseRef.current === 'focus') {
        if (shieldedRef.current) {
          // 실드 세션 — 딴짓이 차단된 상태였으므로 자리 비운 시간을 집중으로 인정(전진).
          // 전진분은 즉시 저장 — 다음 5초 주기 저장 전에 강제 종료되면
          // 방금 인정한 시간이 고아 정산 대상에서 통째로 빠진다.
          const credit = Math.min(away, AWAY_CREDIT_CAP_S);
          // 리플레이는 이탈 시점 스냅샷에서 시작 — 서스펜드 전에 더 돈 tick으로 sessionRef가
          // 앞서 있어도 경계 시각(leftAt + i초)과 어긋나지 않는다. 그 tick 전진분은 아래
          // setSession(cur)이 덮어써 이중 계상 없음(settledSecondsRef 단조 가드도 동일 방어).
          let cur = leftSessionRef.current ?? sessionRef.current;
          leftSessionRef.current = null;
          let crossed = false;
          for (let i = 0; i < credit && !cur.done; i++) {
            const next = nextTick(cur);
            // 빨리감기가 지나치는 페이즈 경계도 실시간과 동일하게 정산·마커 회전 — 최종 페이즈만
            // 비교하면 집중→휴식→집중 한 바퀴(같은 페이즈 복귀)가 경계 없음으로 보여 옛 마커가
            // 휴식 시간까지 계속 흐른다(코덱스 리뷰).
            // 경계 시각은 '지금'이 아니라 실제 지난 벽시계로 복원한다 — 실드 전진은 자리 비운
            // 1초당 1 tick이라 i번째 tick 종료 = leftAt + (i+1)초(코덱스 리뷰).
            const boundaryAt = new Date(leftAtMs + (i + 1) * 1000).toISOString();
            if (cur.phase === 'focus' && next.done) {
              // 마지막 블록 완료(카운트다운·뽀모도로 마지막 세트)를 백그라운드에서 넘긴 경우 —
              // 완료 경계 시각으로 정산해 완료~복귀 공백이 집중으로 계상되지 않게 한다(코덱스
              // 리뷰). 뒤따르는 done 이펙트의 정산은 delta 0 no-op, 마커도 여기서 이미 닫힌다.
              sessionRef.current = next;
              settleFocusBlock(boundaryAt);
            } else if (cur.phase === 'focus' && next.phase === 'break') {
              crossed = true;
              sessionRef.current = next; // 정산이 경계 시점의 경과초를 읽도록 먼저 반영
              settleFocusBlock(boundaryAt);
            } else if (cur.phase === 'break' && next.phase === 'focus') {
              crossed = true;
              settleAtRef.current = boundaryAt;
              startLiveSession(boundaryAt);
            }
            cur = next;
          }
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
            settleAtRef.current = new Date().toISOString();
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
    flushPendingCancels,
  ]);

  // 일시정지/재개 토글 — 새 상태에 맞춰 계측. 상태 업데이터 안이 아니라 여기서 발행(중복 방지).
  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    setPaused(next);
    if (next) {
      logFocusSessionPaused({ elapsed_seconds: Math.floor(sessionRef.current.elapsed) });
    } else {
      // 일시정지 대기로 유예해둔 다음 블록 마커 — 실제 집중이 시작되는 재개 시점부터 연다.
      // 정산 기준(settleAt)도 재개 시점으로 — 대기 동안은 경과초가 멈춰 있어 안전(코덱스 리뷰).
      if (markerDeferredRef.current) {
        markerDeferredRef.current = false;
        settleAtRef.current = new Date().toISOString();
        startLiveSession(settleAtRef.current);
      }
      logFocusSessionResumed();
    }
  }, [startLiveSession]);

  // 정지 버튼(사용자 수동 종료) — 아직 완료되지 않은 세션을 끝내는 것이므로 abandoned 계측 후 종료.
  // 카운트다운/뽀모도로 정상 완료는 done 이펙트가 finish를 부르므로 이 경로를 타지 않는다.
  const stopByUser = useCallback(() => {
    if (!finishedRef.current && !sessionRef.current.done) {
      logFocusSessionAbandoned({
        elapsed_seconds: Math.floor(sessionRef.current.elapsed),
        reason: 'user_exit',
      });
    }
    // countup은 done이 없어 정지가 유일한 정상 종료 경로 — 완료로 취급한다(별점 게이트용).
    finish(sessionRef.current.done || mode === 'countup');
  }, [finish, mode]);

  function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    // 페이지 전환 시 직전 뷰의 체류를 발행(GROMO-987). 같은 페이지로 되돌아온 스크롤은 미계측.
    if (next !== page) flushViewDwell();
    setPage(next);
  }

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
      text: '화면을 옆으로 넘겨봐 —\n친구·같은 시험 준비생·전체 리그가 공부하는 모습을 볼 수 있어.',
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

  // 내 그리드 셀(GROMO-932) — 오늘 총 집중 = 정산 누적(todayFocusSeconds) + 진행 세션 미정산 경과.
  // settleFocusBlock이 두 값을 같은 호출에서 함께 옮기므로 합은 연속이고, 자정 넘긴 블록은
  // 오늘 누적에 안 들어간다(정산 규칙 그대로). 타이머 틱(setSession)마다 리렌더돼 초 단위로 오른다.
  //
  // 자정 경계(코덱스 리뷰) — todayFocusSeconds는 FocusProvider 마운트 시에만 날짜를 확인해
  // 세션이 자정을 넘기면 어제 누적이 그대로 남는다. 날짜가 바뀌는 순간의 값을 스냅샷해 두고
  // 이후 증가분만 오늘 몫으로 계상한다. 진행 중 세션의 미정산 경과는 통째로 오늘 몫 —
  // 블록은 endedAt 날짜에 귀속된다는 정산 규칙과 같은 기준이다(이 블록의 정산도 오늘로 잡힌다).
  const gridDayRef = useRef(todayStr());
  const gridStaleBaseRef = useRef(0);
  if (todayStr() !== gridDayRef.current) {
    gridDayRef.current = todayStr();
    gridStaleBaseRef.current = todayFocusSeconds;
  }
  const myGridMe = {
    nickname: nickname || '나',
    // 일시정지·뽀모도로 휴식·완료 게이트에선 비집중 표시 — 그리드의 초록은 isFocusing 의미(코덱스 리뷰)
    isFocusing: !paused && session.phase === 'focus' && !session.done,
    totalSeconds:
      Math.max(0, todayFocusSeconds - gridStaleBaseRef.current) +
      Math.max(0, Math.floor(session.elapsed) - settledSecondsRef.current),
    tagName: subjectName,
  };

  return (
    <View testID="focus.session.screen" style={s.root}>
      <LinearGradient colors={[T.night.top, T.night.bottom]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={s.flex1} edges={['top', 'bottom']}>
        {/* 상단바 — 햄버거만(과목명은 타이머 위 리드아웃으로 이동, 빈 View는 우측 정렬 유지용) */}
        <View style={s.topBar}>
          <View />
          <TouchableOpacity
            style={s.hamburger}
            activeOpacity={0.8}
            ref={hamburgerRef}
            onPress={() => {
              logFocusMenuOpened();
              setDrawerOpen(true);
            }}
          >
            <Ionicons name="menu" size={18} color={T.paperLight} />
          </TouchableOpacity>
        </View>

        {/* 페이저 — [캐릭터] ↔ [내 친구(656)] ↔ [내 리그=같은 시험(812)] ↔ [전체 리그(811)] (순서 변경: 985)
            순서를 바꾸면 상단 PAGE_VIEWS(뷰 체류 계측, GROMO-987)도 반드시 같이 고칠 것 */}
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          style={s.flex1}
        >
          <View style={[s.page, { width }]}>
            <View style={s.characterWrap}>
              {/* 스냅샷 캡처 범위 — Live Activity·가림막에 들어갈 캐릭터(공부 집중 = study 캐릭터) */}
              <View ref={charShotRef} collapsable={false}>
                <CharacterImage size={230} variant="study" />
              </View>
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
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[s.dot, page === i && s.dotActive]} />
          ))}
        </View>

        {/* 타이머 리드아웃(모드별) */}
        <View style={s.readout}>{renderReadout(mode, session, goal, pomo.sets, subjectName)}</View>

        {/* 컨트롤 — 일시정지 / 정지 */}
        <View style={s.controls} ref={controlsRef} collapsable={false}>
          <TouchableOpacity
            testID="focus.pause"
            style={s.ctrlBtn}
            activeOpacity={0.8}
            onPress={togglePause}
          >
            <Ionicons name={paused ? 'play' : 'pause'} size={22} color={T.paperLight} />
          </TouchableOpacity>
          <TouchableOpacity
            testID="focus.stop"
            style={[s.ctrlBtn, s.stopBtn]}
            activeOpacity={0.8}
            onPress={stopByUser}
          >
            <Ionicons name="square" size={19} color={T.paperLight} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* 첫 세션 사용법 안내(GROMO-652) */}
      <TabGuideOverlay storageKey={STORAGE_KEYS.guideFocusSession} steps={guideSteps} />

      <FocusMenuDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        liveSubjectId={subjectId}
        liveSeconds={session.elapsed}
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
          <TouchableOpacity style={s.doneGateBtn} activeOpacity={0.8} onPress={() => finish()}>
            <Text style={s.doneGateBtnText}>확인</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// 모드별 하단 리드아웃(라벨 + 큰 타이머 + 보조표시).
// 타이머 바로 위엔 모드 안내 문구 대신 집중 중인 과목명을 보여준다(GROMO-848).
// 뽀모도로 휴식 페이즈만 예외로 '휴식' — 과목명이 뜨면 집중 중으로 오해할 수 있어서.
function renderReadout(
  mode: FocusTimerMode,
  session: SessionState,
  goal: number,
  sets: number,
  subjectName: string,
) {
  if (mode === 'countup') {
    return (
      <>
        <Text style={s.roSubject}>{subjectName}</Text>
        <Text style={s.bigTime}>{hms(session.display)}</Text>
      </>
    );
  }
  if (mode === 'countdown') {
    return (
      <>
        <Text style={s.roSubject}>{subjectName}</Text>
        <Text style={s.bigTime}>{hms(session.display)}</Text>
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
            세트 {session.setIndex} / {sets}
          </Text>
        </View>
      </View>
      <Text style={s.roSubject}>{session.phase === 'focus' ? subjectName : '휴식'}</Text>
      <Text style={s.bigTime}>{hms(session.display)}</Text>
      <View style={s.setDots}>
        {Array.from({ length: sets }).map((_, i) => (
          <View key={i} style={[s.setDot, i < session.setIndex && s.setDotOn]} />
        ))}
      </View>
    </>
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
