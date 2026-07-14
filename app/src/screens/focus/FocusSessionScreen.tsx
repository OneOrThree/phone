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
import { saveFocusSession } from '@/services/focusApi';
import { ensureFocusTagId } from './tagSync';
import { enqueuePendingFocusUpload } from './pendingFocusUploads';
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
import { useFocusFriends } from '@/screens/league/useFocusFriends';
import { useSessionLeagueMembers } from './useSessionLeagueMembers';
import { LiveFocusGrid } from './components/LiveFocusGrid';
import { FocusMenuDrawer } from './components/FocusMenuDrawer';
import {
  logFocusSessionStarted,
  logFocusSessionPaused,
  logFocusSessionResumed,
  logFocusSessionAbandoned,
  logFocusMenuOpened,
  logFocusFriendsViewed,
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
  const { userId } = useUser();
  const { addFocusSeconds } = useFocus();
  const { addCoins } = useCoins();
  const { subjects, addFocusToSubject } = useSubjects();
  // Live Activity 시작 시점에 읽을 과목 목록 — effect 재실행 없이 최신값 참조용
  const subjectsRef = useRef(subjects);
  subjectsRef.current = subjects;

  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 친구 전체 라이브 상태 — 60초 폴링·포그라운드 복귀 갱신 (09 친구 그리드 실데이터)
  const { friends: sessionFriends } = useFocusFriends();
  // 리그(811) 그리드 라이브 멤버 — 내 행 제외(내 모습은 캐릭터 페이지가 담당)
  const { members: leagueMembers } = useSessionLeagueMembers({ excludeUserId: userId });
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
  const finishedRef = useRef(false);
  const startedAtRef = useRef(new Date().toISOString());
  // 서버 업로드 정산 마커 — 이미 정산(로컬·코인·서버 업로드)된 집중초/코인, 미정산 구간 시작 시각.
  // 뽀모도로는 집중 블록마다, 그 외 모드는 종료 시 한 번 정산한다.
  const settledSecondsRef = useRef(0);
  const settledCoinsRef = useRef(0);
  const settleAtRef = useRef(startedAtRef.current);

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
        const others = subjectsRef.current
          .filter((x) => x.id !== subjectId)
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

  // 집중 블록 증분 정산 — 마지막 정산 이후 쌓인 집중초(delta)를 로컬·과목·코인에 적립하고
  // 그 구간[settleAt, now]을 서버에 세션으로 업로드한다. 뽀모도로는 집중 블록 끝마다,
  // 그 외 모드는 finish에서 1회 호출된다. 정산 완료분은 라이브 레코드에서 제거(고아 이중정산 방지).
  const settleFocusBlock = useCallback(() => {
    const elapsed = Math.floor(sessionRef.current.elapsed);
    const delta = elapsed - settledSecondsRef.current;
    if (delta <= 0) return;
    const endedAt = new Date().toISOString();
    const startedAt = settleAtRef.current;
    // 마커·레코드를 적립보다 먼저 갱신 — 적립 후 제거 전에 죽으면 고아 정산이 또 적립한다(원 finish와 동일 순서).
    settledSecondsRef.current = elapsed;
    const totalCoins = Math.floor(elapsed / 10);
    const newCoins = totalCoins - settledCoinsRef.current;
    settledCoinsRef.current = totalCoins;
    settleAtRef.current = endedAt;
    AsyncStorage.removeItem(STORAGE_KEYS.focusLiveSession).catch(() => {});
    // 로컬/과목/코인 적립
    addFocusSeconds(delta);
    addFocusToSubject(subjectId, delta);
    if (newCoins > 0) addCoins(newCoins);
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
        };
        return saveFocusSession(body).catch(() => {
          enqueuePendingFocusUpload(body, userId).catch(() => {});
        });
      })
      .catch(() => {});
  }, [addFocusSeconds, addFocusToSubject, addCoins, subjectId, subjectName, userId]);

  // 정지/완료 — 남은 집중 블록 정산(적립+서버 업로드) 후 홈으로. 한 번만 실행.
  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
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
    } finally {
      // 정산 성공 여부와 무관하게 화면은 반드시 빠져나간다 —
      // 집중 결과 화면(GROMO-598)으로 replace, 길이 무관 항상 결과 화면을 보여준다.
      const focusSeconds = Math.floor(sessionRef.current.elapsed);
      navigation.replace('FocusResult', { focusSeconds, subjectId, subjectName });
    }
  }, [settleFocusBlock, navigation, subjectId, subjectName]);

  // 카운트다운/뽀모도로 완료 시 자동 종료
  useEffect(() => {
    if (session.done) finish();
  }, [session.done, finish]);

  // 뽀모도로 집중 블록 경계 — 집중→휴식 전환 시 완료된 블록을 정산·서버 업로드,
  // 휴식→집중 전환 시엔 다음 블록 시작으로 서버 구간 기준을 옮겨 휴식 시간을 제외한다.
  const prevPhaseRef = useRef(session.phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    const cur = session.phase;
    if (prev === cur) return;
    prevPhaseRef.current = cur;
    if (prev === 'focus' && cur === 'break') {
      settleFocusBlock();
    } else if (prev === 'break' && cur === 'focus') {
      settleAtRef.current = new Date().toISOString();
    }
  }, [session.phase, settleFocusBlock]);

  // 이탈 감지 — background 진입 시각을 기록해두고, 복귀 시 자리 비운 시간으로 판정한다.
  const leftAtRef = useRef<number | null>(null);
  const leftPhaseRef = useRef<'focus' | 'break'>('focus');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      // 나감 — 타이머가 실제 돌고 있을 때만 이탈로 취급(일시정지·완료 중은 무시)
      if (state === 'background') {
        if (sessionRef.current.done || finishedRef.current || pausedRef.current) return;
        leftAtRef.current = Date.now();
        leftPhaseRef.current = sessionRef.current.phase;
        saveLive(sessionRef.current.elapsed); // 여기서 꺼져도 이 시점까지는 정산되게
        // 실드 세션은 나가 있어도 집중 인정이라 이탈 알림 없음(폴백 세션만 경고)
        if (sessionRef.current.phase === 'focus' && !shieldedRef.current) {
          scheduleLeaveNotifications(subjectName, LEAVE_END_S).catch(() => {});
        }
        return;
      }
      if (state !== 'active' || leftAtRef.current == null) return;

      // 복귀 — 자리 비운 시간 계산 + 예약 알림 취소
      const away = Math.round((Date.now() - leftAtRef.current) / 1000);
      leftAtRef.current = null;
      cancelLeaveNotifications().catch(() => {});
      if (__DEV__)
        console.log(`[이탈감지] ${away}초 만에 복귀 (실드 ${shieldedRef.current ? 'ON' : 'OFF'})`);
      if (sessionRef.current.done || finishedRef.current) return;

      if (leftPhaseRef.current === 'focus') {
        if (shieldedRef.current) {
          // 실드 세션 — 딴짓이 차단된 상태였으므로 자리 비운 시간을 집중으로 인정(전진).
          // 전진분은 즉시 저장 — 다음 5초 주기 저장 전에 강제 종료되면
          // 방금 인정한 시간이 고아 정산 대상에서 통째로 빠진다.
          const credit = Math.min(away, AWAY_CREDIT_CAP_S);
          let cur = sessionRef.current;
          for (let i = 0; i < credit && !cur.done; i++) cur = nextTick(cur);
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
  }, [subjectName, finish, pomo.focusMin, saveLive, nextTick]);

  // 일시정지/재개 토글 — 새 상태에 맞춰 계측. 상태 업데이터 안이 아니라 여기서 발행(중복 방지).
  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    setPaused(next);
    if (next) logFocusSessionPaused({ elapsed_seconds: Math.floor(sessionRef.current.elapsed) });
    else logFocusSessionResumed();
  }, []);

  // 정지 버튼(사용자 수동 종료) — 아직 완료되지 않은 세션을 끝내는 것이므로 abandoned 계측 후 종료.
  // 카운트다운/뽀모도로 정상 완료는 done 이펙트가 finish를 부르므로 이 경로를 타지 않는다.
  const stopByUser = useCallback(() => {
    if (!finishedRef.current && !sessionRef.current.done) {
      logFocusSessionAbandoned({
        elapsed_seconds: Math.floor(sessionRef.current.elapsed),
        reason: 'user_exit',
      });
    }
    finish();
  }, [finish]);

  function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    // 친구 그리드(page 1)로 처음 넘어올 때만 노출 계측(왕복 스팸 방지). 데이터 갱신은 훅 폴링이 담당.
    if (next === 1 && page !== 1) logFocusFriendsViewed();
    setPage(next);
  }

  return (
    <View style={s.root}>
      <LinearGradient colors={[T.night.top, T.night.bottom]} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={s.flex1} edges={['top', 'bottom']}>
        {/* 상단바 — 과목 + 햄버거 */}
        <View style={s.topBar}>
          <Text style={s.topSubject}>{subjectName}</Text>
          <TouchableOpacity
            style={s.hamburger}
            activeOpacity={0.8}
            onPress={() => {
              logFocusMenuOpened();
              setDrawerOpen(true);
            }}
          >
            <Ionicons name="menu" size={18} color={T.paperLight} />
          </TouchableOpacity>
        </View>

        {/* 페이저 — [캐릭터] ↔ [친구 그리드(656)] ↔ [내 리그(811)] */}
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
              members={leagueMembers}
              title="내 리그"
              emptyTitle="아직 리그 멤버가 없어요"
              emptySub={'리그에 배정되면 여기서\n같이 공부하는 모습이 보여요.'}
            />
          </View>
        </ScrollView>

        {/* 페이지 인디케이터 */}
        <View style={s.dots}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[s.dot, page === i && s.dotActive]} />
          ))}
        </View>

        {/* 타이머 리드아웃(모드별) */}
        <View style={s.readout}>{renderReadout(mode, session, goal, pomo.sets)}</View>

        {/* 컨트롤 — 일시정지 / 정지 */}
        <View style={s.controls}>
          <TouchableOpacity style={s.ctrlBtn} activeOpacity={0.8} onPress={togglePause}>
            <Ionicons name={paused ? 'play' : 'pause'} size={22} color={T.paperLight} />
          </TouchableOpacity>
          <TouchableOpacity style={[s.ctrlBtn, s.stopBtn]} activeOpacity={0.8} onPress={stopByUser}>
            <Ionicons name="square" size={19} color={T.paperLight} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <FocusMenuDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        liveSubjectId={subjectId}
        liveSeconds={session.elapsed}
      />
    </View>
  );
}

// 모드별 하단 리드아웃(라벨 + 큰 타이머 + 보조표시). 과목명은 상단바에 표시.
function renderReadout(mode: FocusTimerMode, session: SessionState, goal: number, sets: number) {
  if (mode === 'countup') {
    return (
      <>
        <Text style={s.roLabel}>경과 · COUNT UP ↑</Text>
        <Text style={s.bigTime}>{hms(session.display)}</Text>
      </>
    );
  }
  if (mode === 'countdown') {
    return (
      <>
        <Text style={s.roLabel}>남음 · COUNT DOWN ↓</Text>
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
      <Text style={s.roLabel}>{session.phase === 'focus' ? '다음 휴식까지' : '휴식'}</Text>
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
    paddingHorizontal: 22,
    paddingVertical: 6,
    minHeight: 40,
  },
  topSubject: { ...T.text.label, fontWeight: '700', color: T.night.cream },
  hamburger: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: withAlpha(T.white, 0.1),
    alignItems: 'center',
    justifyContent: 'center',
  },

  page: { flex: 1 },
  friendsStudy: { width: '100%', height: 104, marginBottom: 10 },
  characterWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, paddingVertical: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: withAlpha(T.night.cream, 0.3) },
  dotActive: { width: 18, backgroundColor: T.night.gold },

  readout: { alignItems: 'center', paddingBottom: 18, minHeight: 118, justifyContent: 'flex-end' },
  roLabel: {
    ...T.text.label,
    fontWeight: '500',
    letterSpacing: 1,
    color: T.night.muted,
    marginBottom: 6,
  },
  bigTime: {
    ...T.text.timer,
    color: T.paperLight,
    fontVariant: ['tabular-nums'],
    lineHeight: 56,
  },
  roGoal: { ...T.text.label, fontWeight: '500', color: T.night.muted, marginTop: 5 },

  setBadgeRow: { marginBottom: 6 },
  setBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: withAlpha(T.accent, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(T.accent, 0.32),
    borderRadius: 99,
    paddingVertical: 4,
    paddingHorizontal: 11,
  },
  setBadgeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: T.night.gold },
  setBadgeText: { ...T.text.caption, fontWeight: '700', color: T.night.gold },
  setDots: { flexDirection: 'row', gap: 7, marginTop: 10 },
  setDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: withAlpha(T.night.cream, 0.22) },
  setDotOn: { backgroundColor: T.night.gold },

  controls: { flexDirection: 'row', justifyContent: 'center', gap: 18, paddingBottom: 30 },
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
