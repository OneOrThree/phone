import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Character2D } from '@/components/character/Character2D';
import { T } from '@/v2/constants/theme';
import { api } from '@/services/api';
import { useFocus } from '@/store/FocusContext';
import { useCoins } from '@/store/CoinContext';
import { useSubjects } from '@/store/SubjectContext';
import type { V2RootStackParamList } from '@/v2/navigation/types';
import type { FocusTimerMode } from './types';
import { hms } from './format';
import { EXAMPLE_FRIENDS } from './data';
import { FriendGrid } from './components/FriendGrid';
import { FocusMenuDrawer } from './components/FocusMenuDrawer';

// 06/07/08 집중 세션(세로) + 09 친구 그리드(좌우 페이저) + 10/11 메뉴 드로어.
// 타이머는 실제로 tick하고, 정지 시 집중시간·코인·세션 POST를 반영한다(구 FocusMode 로직 이식).
// 다크 화면 색은 T.night 팔레트 사용.

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
  const { addFocusSeconds } = useFocus();
  const { addCoins } = useCoins();
  const { addFocusToSubject } = useSubjects();

  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
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

  // 정지/완료 — 집중시간·코인 적립 + 세션 저장 후 홈으로. 한 번만 실행.
  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const focused = Math.floor(sessionRef.current.elapsed);
    if (focused > 0) {
      addFocusSeconds(focused);
      addFocusToSubject(subjectId, focused);
      const coins = Math.floor(focused / 10);
      if (coins > 0) addCoins(coins);
      api
        .post('/api/v1/focus-session', {
          focusTagId: null,
          subject: subjectName,
          startedAt: startedAtRef.current,
          endedAt: new Date().toISOString(),
          distractionCount: 0,
          totalDistractionSeconds: 0,
        })
        .catch(() => {});
    }
    navigation.popToTop();
  }, [addFocusSeconds, addCoins, addFocusToSubject, subjectId, subjectName, navigation]);

  // 카운트다운/뽀모도로 완료 시 자동 종료
  useEffect(() => {
    if (session.done) finish();
  }, [session.done, finish]);

  function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
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
            onPress={() => setDrawerOpen(true)}
          >
            <Ionicons name="menu" size={18} color={T.paperLight} />
          </TouchableOpacity>
        </View>

        {/* 페이저 — [캐릭터] ↔ [친구 그리드] */}
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          style={s.flex1}
        >
          <View style={[s.page, { width }]}>
            <View style={s.characterWrap}>
              <Character2D size={200} variant="focus" />
            </View>
          </View>
          <View style={[s.page, { width }]}>
            <FriendGrid friends={EXAMPLE_FRIENDS} />
          </View>
        </ScrollView>

        {/* 페이지 인디케이터 */}
        <View style={s.dots}>
          <View style={[s.dot, page === 0 && s.dotActive]} />
          <View style={[s.dot, page === 1 && s.dotActive]} />
        </View>

        {/* 타이머 리드아웃(모드별) */}
        <View style={s.readout}>{renderReadout(mode, session, goal, pomo.sets)}</View>

        {/* 컨트롤 — 일시정지 / 정지 */}
        <View style={s.controls}>
          <TouchableOpacity
            style={s.ctrlBtn}
            activeOpacity={0.8}
            onPress={() => setPaused((p) => !p)}
          >
            <Ionicons name={paused ? 'play' : 'pause'} size={22} color={T.paperLight} />
          </TouchableOpacity>
          <TouchableOpacity style={[s.ctrlBtn, s.stopBtn]} activeOpacity={0.8} onPress={finish}>
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
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  page: { flex: 1 },
  characterWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, paddingVertical: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(246,241,233,0.3)' },
  dotActive: { width: 18, backgroundColor: T.night.gold },

  readout: { alignItems: 'center', paddingBottom: 18, minHeight: 118, justifyContent: 'flex-end' },
  roLabel: {
    ...T.text.caption,
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
  roGoal: { ...T.text.caption, fontWeight: '500', color: T.night.muted, marginTop: 5 },

  setBadgeRow: { marginBottom: 6 },
  setBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(200,137,63,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(200,137,63,0.32)',
    borderRadius: 99,
    paddingVertical: 4,
    paddingHorizontal: 11,
  },
  setBadgeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: T.night.gold },
  setBadgeText: { ...T.text.caption, fontWeight: '700', color: T.night.gold },
  setDots: { flexDirection: 'row', gap: 7, marginTop: 10 },
  setDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: 'rgba(246,241,233,0.22)' },
  setDotOn: { backgroundColor: T.night.gold },

  controls: { flexDirection: 'row', justifyContent: 'center', gap: 18, paddingBottom: 30 },
  ctrlBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBtn: { backgroundColor: T.accentAlt },
});
