import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, { cubicBezier } from 'react-native-reanimated';
import { T } from '@/constants/theme';
import { CURRENCY } from '@/constants/currency';
import { PressableScale } from '@/components/PressableScale';
import { STORAGE_KEYS } from '@/types/storage';
import { getFocusPeriodStats, getStreak, getHeatmap, getTodayStats } from '@/services/statsApi';
import type {
  FocusPeriodStatsResponse,
  StreakResponse,
  HeatmapCellResponse,
} from '@/types/dto/stats';
import { localDateStr, todayStr } from '@/utils/localDate';
import type { V2RootStackParamList } from '@/navigation/types';
import { useSubjects } from '@/store/SubjectContext';
import { fmtMinutes, fmtHm, axisCeil, fmtAxis } from '@/utils/timeFormat';
import { hms } from './format';
import { fetchFocusAverage, fetchFriendsAverage } from '@/services/compareAverages';
import { readPendingCelebration, schedulePendingCelebration } from '@/services/goalCelebration';
import { maybeRequestReview } from '@/services/storeReview';
import { WeekStreakModal } from './components/WeekStreakModal';
import { useFocus } from '@/store/FocusContext';
import { useUser } from '@/store/UserContext';
import { subscribeSessionSaveVerdict, getSessionSaveVerdict } from './sessionSaveVerdict';
import {
  logFocusResultCompareAxisChanged,
  logFocusResultComparePeriodChanged,
} from '@/services/analyticsEvents';

// 집중 결과 화면 — Claude Design Gromo.dc.html 14번(첫 집중 완료) 레이아웃 기준.
// GROMO-598: 화면·진입·이번 집중(00:00:00)·과목별 누적(로컬 SubjectContext — 방금 세션 즉시 반영)·CTA. 코인 미표기.
// GROMO-603(집중 완료 통계): 스트릭 채우기(첫 완료 변형에만 — 월~일 출석 체크) + 이번 주 집중시간(요일 막대)
//   + 나 vs 3축(친구/전체/같은 카테고리) 오늘 비교. 축별 독립 로딩 — 카드는 즉시 뜨고 도착한 축부터 채워진다.
// GROMO-755: 3축 모두 평균 집계 API(753) 실데이터 연결 — 전체·같은 카테고리 블러 티저 제거,
//   친구 축은 개별 조회(N+1) 대신 scope=FRIENDS 단일 호출.

const WEEK_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
// 차트 트랙 높이 — 세로축 ⅓ 간격 눈금·라벨이 겹치지 않을 만큼 확보(GROMO-683)
const BAR_H = 72;
// GROMO-682: 스트릭(출석 ✓) 인정 최소 기준 — 하루 누적 10분
const STREAK_MIN_DAILY_MINUTES = 10;
// 진입 시 막대가 바닥부터 자라는 키프레임(GROMO-683) — height 애니메이션은 매 프레임
// 레이아웃 패스를 유발하므로 scaleY 변환 사용(s.bar의 transformOrigin: 'bottom'과 조합).
const growUp = { from: { transform: [{ scaleY: 0 }] } };
// 막대별 진입 애니메이션 — 왼쪽부터 80ms 시차. fillMode backwards로 딜레이 동안
// scaleY 0(접힌 상태)을 유지해 먼저 그려지는 튐 방지. 이징은 목표를 살짝 넘었다가
// 자리 잡는 overshoot 곡선(easeOutBack) — 500ms ease-out은 너무 빨라 체감이 안 됐음.
const barEnterAnim = (index: number) =>
  ({
    animationName: growUp,
    animationDuration: '800ms',
    animationDelay: `${index * 80}ms`,
    animationTimingFunction: cubicBezier(0.34, 1.56, 0.64, 1),
    animationFillMode: 'backwards',
  }) as const;
// 스트릭 ✓ 팝 모션(GROMO-667) — 그날 누적 10분을 처음 채운 결과 화면에서 '오늘 칸'에만 재생.
// 요일 무관 동일 효과 — 일요일이라 주간까지 완성되면 이 팝에 이어 종이폭죽·모달이 붙는다.
const checkPop = {
  animationName: {
    from: { transform: [{ scale: 0 }] },
    '70%': { transform: [{ scale: 1.25 }] },
    to: { transform: [{ scale: 1 }] },
  },
  animationDuration: '600ms',
  animationDelay: '400ms',
  animationTimingFunction: 'ease-out',
  animationFillMode: 'backwards',
} as const;

// 오늘 ✓ 팝을 재생한 마커(프로세스 메모리, 'userId:날짜') — 연속 결과 화면이 AsyncStorage 쓰기
// 완료 전에 영속 마커를 다시 읽는 레이스 방어(코덱스 리뷰). 영속 마커(focusStreakPoppedDate)와
// 이중 가드. 계정을 붙이는 이유: 기기 공용 마커면 같은 날 계정 전환 시 새 계정의 첫 팝이 눌린다.
const poppedMarkersMemory = new Set<string>();

function parsePoppedMarkers(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((value): value is string => typeof value === 'string'));
    }
  } catch {
    // 구버전 단일 'userId:날짜' 값은 아래에서 그대로 마이그레이션한다.
  }
  return new Set([raw]);
}

// 이번 주 월~일 날짜('YYYY-MM-DD') 배열.
function thisWeekDates(): string[] {
  const now = new Date();
  const dow = now.getDay(); // 0=일..6=토
  const toMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + toMonday);
  return Array.from({ length: 7 }, (_, i) =>
    localDateStr(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)),
  );
}

export default function FocusResultScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { params } = useRoute<RouteProp<V2RootStackParamList, 'FocusResult'>>();
  const { focusSeconds, subjectName, completed } = params;
  const { subjects } = useSubjects();
  // 목표 달성 판정용(GROMO-630) — 로컬 누적(오늘 전체)·로컬 목표. 서버 조회가 늦거나 실패해도 판정 가능.
  const { todayFocusSeconds } = useFocus();
  const { goalSeconds: userGoalSeconds, userId } = useUser();

  const [firstTime, setFirstTime] = useState(false);
  const [week, setWeek] = useState<FocusPeriodStatsResponse | null>(null);
  const [streak, setStreak] = useState<StreakResponse | null>(null);
  const [cellByDate, setCellByDate] = useState<Record<string, HeatmapCellResponse>>({});
  // heatmap 도착 여부 — 연출 판정(667)은 주간 데이터가 온 뒤 1회만 수행한다(오판 방지)
  const [cellsLoaded, setCellsLoaded] = useState(false);
  // heatmap 확정 실패 — 별점 요청(980)은 성공/실패가 확정된 뒤에만 발화한다(아래 effect 참고)
  const [cellsFailed, setCellsFailed] = useState(false);
  // 비교 3축(GROMO-755) — 평균 집계 API(753) 단일 호출. 오늘/이번 주 기간 탭(692와 동일 패턴)
  // × 축별 캐시: 탭 왕복 시 재조회 없이 즉시 전환, 축별 독립 도착은 유지.
  // 축 값 undefined = 로딩 중, avg null = 미확보(count 0 = 집계 대상 없음 / -1 = 조회 실패)
  const [comparePeriod, setComparePeriod] = useState<ComparePeriod>('DAY');
  const [compareAvgs, setCompareAvgs] = useState<
    Partial<
      Record<ComparePeriod, { friends?: CompareAvg; total?: CompareAvg; category?: CompareAvg }>
    >
  >({});
  // 기간별 조회 시작 여부 — 도착 여부(compareAvgs)로 가드하면 첫 축 도착 전 재진입 시 중복 조회된다
  const comparePeriodsFetched = useRef(new Set<ComparePeriod>());
  const compareUnmounted = useRef(false);
  useEffect(
    () => () => {
      compareUnmounted.current = true;
    },
    [],
  );
  // 이번 달 내 합계 — 월 탭에서만 쓰므로 월 탭 첫 진입 시 1회 조회(주간과 달리 화면 핵심 지표가 아님)
  const [month, setMonth] = useState<FocusPeriodStatsResponse | null>(null);
  useEffect(() => {
    if (comparePeriodsFetched.current.has(comparePeriod)) return;
    comparePeriodsFetched.current.add(comparePeriod);
    const put =
      (axis: 'friends' | 'total' | 'category') => (v: { avg: number | null; count: number }) => {
        if (compareUnmounted.current) return;
        setCompareAvgs((prev) => ({
          ...prev,
          [comparePeriod]: { ...prev[comparePeriod], [axis]: v },
        }));
      };
    fetchFriendsAverage(comparePeriod).then(put('friends'));
    fetchFocusAverage('TOTAL', comparePeriod).then(put('total'));
    fetchFocusAverage('CATEGORY', comparePeriod).then(put('category'));
    if (comparePeriod === 'MONTH') {
      getFocusPeriodStats('MONTH')
        .then((m) => !compareUnmounted.current && setMonth(m))
        .catch(() => {});
    }
  }, [comparePeriod]);

  // 첫 완료 판별 — 로컬 플래그. 없으면 이번이 첫 완료로 보고 플래그를 남긴다.
  useEffect(() => {
    (async () => {
      const done = await AsyncStorage.getItem(STORAGE_KEYS.focusFirstDone);
      setFirstTime(done == null);
      if (done == null) AsyncStorage.setItem(STORAGE_KEYS.focusFirstDone, '1').catch(() => {});
    })();
  }, []);

  // 집중 완료 통계(GROMO-603) — 세 요청은 각자 도착하는 대로 독립 반영한다. 한 Promise.all로
  // 묶으면 heatmap이 먼저 와도 주간·스트릭 응답(최대 15s)까지 cellsLoaded/cellsFailed 확정이
  // 밀려, 연출·별점 게이트가 무관한 요청에 끌려간다(코드리뷰 반영). 비교 3축도 별도 독립 로딩.
  useEffect(() => {
    let cancelled = false;
    const days = thisWeekDates();
    getFocusPeriodStats('WEEK')
      .catch(() => null)
      .then((w) => {
        if (!cancelled) setWeek(w);
      });
    getStreak()
      .catch(() => null)
      .then((st) => {
        if (!cancelled) setStreak(st);
      });
    getHeatmap(days[0], todayStr())
      .catch(() => null)
      .then((cells) => {
        if (cancelled) return;
        // heatmap 실패는 '로드됨'으로 치지 않는다 — 빈 데이터로 연출을 판정하면 popped 플래그가
        // 선기록돼 그 주의 주간 축하가 유실된다(PR 227 리뷰). 실패 시 다음 진입에서 재판정.
        if (cells) {
          const map: Record<string, HeatmapCellResponse> = {};
          for (const c of cells) map[c.date] = c;
          setCellByDate(map);
          setCellsLoaded(true);
        } else {
          // 확정 실패 — 연출 판정(cellsLoaded 필요)은 재진입까지 없으므로 별점 요청이 대기하지 않게 표시
          setCellsFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 목표 달성 판정(GROMO-630) — 결과 화면은 판정·예약만 하고, 모달은 결과 화면을 닫은 뒤
  // 홈 진입 시 뜬다(오스카 결정). 누적은 로컬(FocusContext — 방금 세션 포함)과 서버 중 큰 값,
  // 목표는 서버 우선·실패 시 로컬 — 방금 세션 업로드가 서버 집계에 늦어도(레이스) 놓치지 않는다.
  // '연속 목표달성'은 일별 달성 플래그(heatmap)를 어제부터 뒤로 세어 오늘을 더한다 —
  // '연속 공부'(하루 10분 스트릭)와 다른 값이므로 getStreak을 쓰지 않는다.
  // 상태를 건드리지 않는 순수 저장 작업이라 언마운트 가드를 두지 않는다 — "홈으로"를 서버
  // 응답보다 빨리 눌러 화면이 닫혀도 예약 저장은 끝까지 수행되고, 저장 완료는
  // goalCelebration 구독으로 홈에 전달돼 이미 홈에 도착한 뒤에도 모달이 뜬다(PR 225 리뷰).
  useEffect(() => {
    (async () => {
      try {
        const today = todayStr();
        if ((await AsyncStorage.getItem(STORAGE_KEYS.focusGoalCelebratedDate)) === today) return;
        // 오늘 예약이 이미 있으면 재판정 불필요
        if ((await readPendingCelebration())?.date === today) return;
        const stats = await getTodayStats().catch(() => null);
        const goalMin = stats ? stats.focus.goalMinutes : Math.round(userGoalSeconds / 60);
        const todayMin = Math.max(
          stats?.focus.todayMinutes ?? 0,
          Math.floor(todayFocusSeconds / 60),
        );
        const achieved =
          goalMin > 0 && ((stats?.focus.goalAchieved ?? false) || todayMin >= goalMin);
        if (!achieved) return;
        // 어제부터 뒤로 60일 단위로 조회 창을 넓혀가며 연속 달성일을 센다 — 고정 60일 창은
        // 장기 스트릭을 최대 61일로 잘라먹는다(PR 225 리뷰). 창 안이 전부 달성이면 다음 창을
        // 이어 조회하고, 빈 날을 만나면 멈춘다. 상한 12창(약 2년) — 과호출 방지.
        let days = 1; // 오늘(방금 달성)
        const cursor = new Date();
        cursor.setDate(cursor.getDate() - 1);
        const CHUNK_DAYS = 60;
        const MAX_CHUNKS = 12;
        for (let chunk = 0; chunk < MAX_CHUNKS; chunk += 1) {
          const to = new Date(cursor);
          const from = new Date(cursor);
          from.setDate(from.getDate() - (CHUNK_DAYS - 1));
          const cells = await getHeatmap(localDateStr(from), localDateStr(to)).catch(
            () => [] as HeatmapCellResponse[],
          );
          const achievedByDate = new Map(cells.map((c) => [c.date, c.focusGoalAchieved]));
          let gapFound = false;
          for (let i = 0; i < CHUNK_DAYS; i += 1) {
            if (!achievedByDate.get(localDateStr(cursor))) {
              gapFound = true;
              break;
            }
            days += 1;
            cursor.setDate(cursor.getDate() - 1);
          }
          if (gapFound) break;
        }
        await schedulePendingCelebration({ date: today, days, goalMinutes: goalMin });
      } catch {
        // 판정 실패 시 축하 생략 — 다음 결과 화면 진입에서 재판정된다
      }
    })();
  }, [todayFocusSeconds, userGoalSeconds]);

  const today = todayStr();
  const days = thisWeekDates();
  // 오늘 ✓ 팝(GROMO-667) — 오늘 스트릭이 '채워지는 순간'의 결과 화면에서만 카드 노출+팝(하루 1회)
  const [todayPop, setTodayPop] = useState(false);
  // 주간 완성 추가 연출 — 축하 모달(종이폭죽은 모달 오버레이 안에서 동시에). ✓ 팝은 todayPop 담당.
  const [weekModalVisible, setWeekModalVisible] = useState(false);
  // 하단 CTA로 화면을 떠나는 중 — fade 전환 동안 두 버튼을 비활성화해 두 번째 탭이
  // 동작 없이 피드백만 내는 것을 막는다(아래 footer 주석 참고).
  const [leaving, setLeaving] = useState(false);
  const celebrationStarted = useRef(false);

  // 별점 요청(GROMO-980) — 집중 세션 '정상 완료'(긍정적 순간)에 조건 충족 시 1회 노출.
  // 중도 이탈(정지·이탈 타임아웃) 세션은 요청하지 않는다 — 부정적 순간에 영구 마커('단 한 번의
  // 기회')가 소모된다(코드리뷰 반영). 주간 스트릭 축하 모달과 겹칠 때도 마찬가지라, heatmap이
  // 성공/실패로 확정된 뒤에만 발화한다 — 고정 폴백 타이머는 API 타임아웃(15s)보다 짧아, 늦게 온
  // 응답이 주간 축하 모달을 열어 별점창과 겹치는 레이스가 있었다(코드리뷰 반영).
  const weekModalVisibleRef = useRef(false);
  weekModalVisibleRef.current = weekModalVisible;
  useEffect(() => {
    if (!completed) return; // 중도 이탈 세션 — 요청 스킵(다음 정상 완료 때 재시도)
    if (!cellsLoaded && !cellsFailed) return; // heatmap 미확정 — 확정 후 재실행
    // 도착 시 축하 판정창은 최대 1.2s(팝 종료) — 그 뒤(1.6s)에 확인. 실패면 연출 자체가 없어 짧게.
    const delay = cellsLoaded ? 1600 : 400;
    const timer = setTimeout(() => {
      if (weekModalVisibleRef.current) return; // 스트릭 축하 노출 중 → 스킵(다음 완료 때 재시도)
      maybeRequestReview();
    }, delay);
    return () => clearTimeout(timer);
  }, [completed, cellsLoaded, cellsFailed]);
  // 세션 저장 응답의 서버 판정 구독(GROMO-807) — 업로드가 fire-and-forget이라 결과 화면 진입
  // 후에 도착할 수 있고, 도착하면 구독으로 재렌더된다. 오늘 날짜 판정만 유효(자정 넘김 방어).
  const rawVerdict = useSyncExternalStore(subscribeSessionSaveVerdict, getSessionSaveVerdict);
  const verdict = rawVerdict?.date === today ? rawVerdict : null;
  // 획득 시간조각(재화) — 세션 저장 응답 기준(GROMO 재화). 목표 보너스(goalRewardCoins>0)도 합산.
  // 응답 도착 전이거나 서버 미지급이면 0 → 배지 미표기.
  const rewardCoins = (verdict?.awardedCoins ?? 0) + Math.max(verdict?.goalRewardCoins ?? 0, 0);
  // 방금 끝낸 세션은 업로드 직후라 서버 집계(week·heatmap)에 아직 없을 수 있다(리뷰 반영).
  // 오늘 값은 max(서버 집계, 방금 세션 분, 저장 응답의 그날 누적)로 바닥을 깔고, 주간 합계에도
  // 그 차이만큼 더해 결과 화면이 0/이전 값으로 보이지 않게 한다(이중 집계 없음 — max라 서버
  // 반영 후엔 그대로). 저장 응답 누적은 서버가 방금 세션까지 확정한 값이라 집계 레이스가 없다.
  const sessionMin = Math.round(focusSeconds / 60);
  const serverToday = cellByDate[today]?.totalFocusMinutes ?? 0;
  const verdictToday = verdict ? Math.floor(verdict.dayTotalFocusSeconds / 60) : 0;
  const adjustedToday = Math.max(serverToday, sessionMin, verdictToday);
  // 스트릭 판정용 오늘 충족 여부(GROMO-682·807) — 서버 확정 판정(streakQualifiedToday)을 우선
  // 사용하되 '상향 전용'으로 합친다: 서버 판정은 오프라인 대기열(614)에 남은 이전 세션을 모를 수
  // 있어, false가 로컬 추정 true를 뒤집으면 실제 10분을 채운 유저가 미충족으로 보인다.
  // 추정 폴백(응답 도착 전·업로드 실패 시)은 기존대로 — 서버와 로컬 하루 누적(FocusContext,
  // 방금 세션 포함) 중 큰 값을 내림으로 판정. 세션 단건만 보면 '서버 5분+이번 6분' 같은 합산
  // 도달을 업로드 레이스에서 놓친다(PR 227 리뷰). 반올림 금지 — 9분 30초가 10분으로 인정되는 문제.
  const todayStreakDone =
    (verdict?.streakQualifiedToday ?? false) ||
    Math.max(serverToday, Math.floor(todayFocusSeconds / 60)) >= STREAK_MIN_DAILY_MINUTES;
  // 주간 스트릭 완성(GROMO-667) — 월~일 7칸 모두 하루 10분 기준 충족.
  // 미래 요일은 셀이 없어 자동으로 false — 사실상 일요일 세션 완료 시에만 참이 된다.
  const weekStreakComplete =
    todayStreakDone &&
    days.every(
      (d) => d === today || (cellByDate[d]?.totalFocusMinutes ?? 0) >= STREAK_MIN_DAILY_MINUTES,
    );

  // 연출 판정(GROMO-667) — heatmap 도착 후 1회: 오늘 ✓가 이날 처음 채워졌으면 카드+팝(하루 1회).
  // 그 팝으로 주간(월~일)까지 완성이면 팝이 끝난 1.2s에 축하 모달+종이폭죽을 주 1회 재생.
  // started ref 가드 — 상태 전이로 effect가 재실행돼도 타이머가 리셋되지 않게 한다.
  const mondayKey = days[0];
  useEffect(() => {
    if (!cellsLoaded || celebrationStarted.current) return;
    if (!todayStreakDone) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    (async () => {
      if (cancelled || celebrationStarted.current) return;
      celebrationStarted.current = true;
      // 오늘 ✓ 팝은 그날 처음 채워진 결과 화면에서만 재생(하루 1회 — '매 세션 노출'에서 재변경,
      // 오스카 요청). 이후 세션의 결과 화면은 팝 없이 정적 ✓로 표시된다. 주간 축하는 팝과
      // 독립 판정 — 이번 주 도장이 없으면 재생하되, 주 1회 가드는 그대로 유지한다.
      const poppedMarkerRaw = await AsyncStorage.getItem(STORAGE_KEYS.focusStreakPoppedDate).catch(
        () => null,
      );
      if (cancelled) return;
      // 마커는 계정별('userId:날짜') 집합 — 같은 날 B 계정이 팝을 재생해도 A 계정의
      // 마커를 덮어쓰지 않아, A로 돌아왔을 때 두 번째 팝이 재생되지 않는다(코덱스 리뷰).
      const todayMarker = `${userId ?? 'guest'}:${today}`;
      const persistedMarkers = parsePoppedMarkers(poppedMarkerRaw);
      const firstPopToday =
        !poppedMarkersMemory.has(todayMarker) && !persistedMarkers.has(todayMarker);
      if (firstPopToday) {
        poppedMarkersMemory.add(todayMarker);
        // 오늘 마커만 유지하면 계정 수만큼으로 크기가 제한되면서 날짜가 바뀐 뒤에는 자연히 정리된다.
        const todayMarkers = [...persistedMarkers].filter((marker) => marker.endsWith(`:${today}`));
        todayMarkers.push(todayMarker);
        AsyncStorage.setItem(
          STORAGE_KEYS.focusStreakPoppedDate,
          JSON.stringify(todayMarkers),
        ).catch(() => {});
        setTodayPop(true);
      }
      if (!weekStreakComplete) return;
      const seenWeek = await AsyncStorage.getItem(STORAGE_KEYS.focusWeekStreakCelebratedWeek).catch(
        () => null,
      );
      if (cancelled || seenWeek === mondayKey) return;
      timers.push(
        setTimeout(
          () => {
            // 주 1회 도장은 모달이 실제로 뜨는 순간 기록 — 딜레이 중 화면을 떠나면(타이머 취소)
            // 다음 결과 진입에서 다시 뜰 수 있다(PR 227 리뷰).
            AsyncStorage.setItem(STORAGE_KEYS.focusWeekStreakCelebratedWeek, mondayKey).catch(
              () => {},
            );
            setWeekModalVisible(true);
          },
          firstPopToday ? 1200 : 400, // 팝이 재생된 경우엔 팝 종료 후(1200ms), 아니면 짧게(400ms)
        ),
      );
    })();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [cellsLoaded, todayStreakDone, weekStreakComplete, mondayKey, today, userId]);
  const weekTotal = (week?.totalFocusMinutes ?? 0) + (adjustedToday - serverToday);
  // 이번 달 합계 — 주간과 동일하게 방금 세션 보정분(adjustedToday - serverToday)을 더한다(월도 오늘 포함)
  const monthTotal = (month?.totalFocusMinutes ?? 0) + (adjustedToday - serverToday);
  const dayMinutes = (d: string) =>
    d === today ? adjustedToday : (cellByDate[d]?.totalFocusMinutes ?? 0);
  // 세로축 상한 — 최대치를 보기 좋은 눈금으로 올림(통계 차트와 동일 규칙, GROMO-683)
  const axisMax = axisCeil(Math.max(...days.map(dayMinutes), 1));
  // 이번 집중 시간 — 세션 타이머와 같은 디지털 표기(00:00:00).
  const focusLabel = hms(focusSeconds);
  // 과목별 누적(로컬) — 방금 세션까지 즉시 반영. 기록 있는 과목만, 많은 순.
  const subjectRows = [...subjects]
    .filter((x) => x.accumulatedSeconds > 0)
    .sort((a, b) => b.accumulatedSeconds - a.accumulatedSeconds);

  return (
    <SafeAreaView testID="focus.result.screen" style={s.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* 헤더 — 축하 문구 */}
        <View style={s.header}>
          <Text style={s.title}>{firstTime ? '첫 집중 완료!' : '집중 완료!'}</Text>
          <Text style={s.sub}>
            {firstTime ? '오늘 첫 걸음을 뗐어요 🎉' : `${subjectName} · 꾸준함이 쌓이고 있어요`}
          </Text>
          {/* 획득 시간조각 — 저장 응답 도착 시 +N ⏳ 팝(스트릭 ✓와 같은 checkPop 재사용) */}
          {rewardCoins > 0 ? (
            <Animated.View style={[s.coinBadge, checkPop]}>
              <Text style={s.coinBadgeText}>
                +{rewardCoins.toLocaleString()} {CURRENCY.icon}
              </Text>
            </Animated.View>
          ) : null}
        </View>

        {/* 이번 집중 — 과목명 큰 글씨 + 00:00:00, 바로 아래 과목별 누적 집중(로컬) */}
        <View style={s.card}>
          <Text style={s.miniLabel}>이번 집중</Text>
          {/* 과목명 + 시간 — 수평 배치(과목이 주인공, 시간은 오른쪽) */}
          <View style={s.focusRow}>
            <Text style={s.bigStat} numberOfLines={1}>
              {subjectName}
            </Text>
            <Text style={s.focusTime}>{focusLabel}</Text>
          </View>

          {subjectRows.length > 0 ? (
            <View style={s.catSection}>
              <Text style={s.catHeading}>과목별 집중 현황</Text>
              {/* 과목 + 시간만 쭉 (드로어 '과목별 집중 현황'과 동일 패턴) */}
              <View style={s.subjectList}>
                {subjectRows.map((x) => (
                  <View key={x.id} style={s.subjectRow}>
                    <View style={[s.subjectDot, { backgroundColor: x.color }]} />
                    <Text style={s.subjectName} numberOfLines={1}>
                      {x.name}
                    </Text>
                    <Text style={s.subjectTime}>{hms(x.accumulatedSeconds)}</Text>
                  </View>
                ))}
              </View>
              {/* 맨 아래 — 전체 대비 과목별 비율 바(flex 세그먼트 분할) */}
              <View style={s.ratioTrack}>
                {subjectRows.map((x) => (
                  <View
                    key={x.id}
                    style={{ flex: x.accumulatedSeconds, backgroundColor: x.color }}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </View>

        {/* 이번 주 스트릭 카드 — 항상 노출(오스카 요청). ✓ 채우기 팝은 todayPop(오늘 10분 충족)일 때만. */}
        <LinearGradient
          colors={[T.accentBg, T.sand]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.streakCard}
        >
          <View style={s.streakHead}>
            <View style={s.streakIcon}>
              <Ionicons name="flame" size={13} color={T.white} />
            </View>
            {/* 오늘 10분 미달이면 '완료'가 판정(빈 ✓·안내 문구)과 모순되므로 제목 분기 */}
            <Text style={s.streakTitle}>
              {todayStreakDone
                ? '이번 주 집중 스트릭 채우기 완료!'
                : '이번 주 집중 스트릭을 채워봐요!'}
            </Text>
            {streak && streak.currentStreak > 0 ? (
              <Text style={s.streakBadge}>{streak.currentStreak}일 연속</Text>
            ) : null}
          </View>
          <View style={s.dotRow}>
            {days.map((date, i) => {
              const cell = cellByDate[date];
              const isToday = date === today;
              // 출석 = 하루 누적 10분 이상(GROMO-682). 오늘은 방금 세션이 서버 집계에
              // 아직 없을 수 있어 보정한 판정값(todayStreakDone)을 쓴다.
              const done = isToday
                ? todayStreakDone
                : cell != null && cell.totalFocusMinutes >= STREAK_MIN_DAILY_MINUTES;
              const future = date > today;
              // 오늘 ✓가 채워지는 날은 즉시 채우지 않고 팝 모션으로 찍는다(지난 요일은 정적)
              const popping = isToday && todayPop;
              return (
                <View key={date} style={s.dotCol}>
                  <View
                    style={[s.dot, done && !popping ? s.dotOn : null, future ? s.dotFuture : null]}
                  >
                    {done && !popping ? (
                      <Ionicons name="checkmark" size={15} color={T.white} />
                    ) : null}
                    {popping ? (
                      <Animated.View style={[s.dotPopFill, checkPop]}>
                        <Ionicons name="checkmark" size={15} color={T.white} />
                      </Animated.View>
                    ) : null}
                  </View>
                  <Text style={[s.dotDay, isToday ? s.dotDayToday : null]}>{WEEK_LABELS[i]}</Text>
                </View>
              );
            })}
          </View>
        </LinearGradient>

        {/* 스트릭 기준 안내(GROMO-682) — 오늘 누적이 10분 미만이면 채워지는 조건을 알려준다 */}
        {!todayStreakDone ? (
          <View style={s.streakNotice}>
            <Ionicons name="flame-outline" size={14} color={T.accentDeep} />
            <Text style={s.streakNoticeText}>하루 10분 이상 집중하면 연속 기록이 채워져요</Text>
          </View>
        ) : null}

        {/* 이번 주 집중시간 — 총합 + 요일 막대(나). 세로축·눈금은 통계 차트 패턴 재사용(GROMO-683) */}
        <View style={s.card}>
          <View style={s.rowBetween}>
            <Text style={s.cardTitle}>이번 주 집중시간</Text>
            <Text style={s.cardValue}>{fmtMinutes(weekTotal)}</Text>
          </View>
          <View style={s.chartPlotRow}>
            {/* 세로축 — 상한·⅔·⅓ 눈금 3줄 (StatsScreen 차트와 동일 패턴) */}
            <View style={s.chartAxisCol}>
              <Text style={[s.chartAxisLabel, s.chartAxisTop]} allowFontScaling={false}>
                {fmtAxis(axisMax)}
              </Text>
              <Text style={[s.chartAxisLabel, s.chartAxisUpper]} allowFontScaling={false}>
                {fmtAxis((axisMax * 2) / 3)}
              </Text>
              <Text style={[s.chartAxisLabel, s.chartAxisLower]} allowFontScaling={false}>
                {fmtAxis(axisMax / 3)}
              </Text>
            </View>
            <View style={s.chartPlot}>
              <View style={[s.chartGridLine, s.chartGridTop]} />
              <View style={[s.chartGridLine, s.chartGridUpper]} />
              <View style={[s.chartGridLine, s.chartGridLower]} />
              <View style={[s.chartGridLine, s.chartGridBottom]} />
              <View style={s.barRow}>
                {days.map((date, i) => {
                  const min = dayMinutes(date);
                  const isToday = date === today;
                  const h = min > 0 ? Math.max((min / axisMax) * BAR_H, 4) : 0;
                  return (
                    <View key={date} style={s.barCol}>
                      <View style={s.barTrack}>
                        <Animated.View
                          style={[
                            s.bar,
                            { height: h, backgroundColor: isToday ? T.accent : T.sand },
                            barEnterAnim(i),
                          ]}
                        />
                      </View>
                      <Text style={[s.barDay, isToday ? s.barDayToday : null]}>
                        {WEEK_LABELS[i]}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        </View>

        {/* 나 vs 3축 비교(오늘/이번 주/이번 달 탭) — 카드는 즉시 뜨고 도착한 축부터 채워진다(GROMO-755).
            내 값: 오늘 = 서버 확정 보정치(adjustedToday), 이번 주 = 위 주간 카드와 동일한 weekTotal,
            이번 달 = 월 합계 + 방금 세션 보정 */}
        <CompareCard
          mine={
            comparePeriod === 'DAY'
              ? adjustedToday
              : comparePeriod === 'WEEK'
                ? weekTotal
                : monthTotal
          }
          period={comparePeriod}
          onPeriodChange={setComparePeriod}
          friends={compareAvgs[comparePeriod]?.friends}
          total={compareAvgs[comparePeriod]?.total}
          category={compareAvgs[comparePeriod]?.category}
        />
      </ScrollView>

      {/* 하단 CTA — 홈으로 / 다시 집중.
          fade 전환 중 더블 탭이 들어오면 스택이 이미 비워져 POP_TO_TOP 미처리 경고가 나서
          canGoBack 가드로 두 번째 탭을 무시한다. 가드만 두면 두 번째 탭이 아무 동작도 없이
          스케일·사운드·햅틱만 내므로(탭바의 '선택된 탭은 무반응' 규칙과 어긋남),
          첫 내비게이션 직후 두 버튼을 disabled로 내려 피드백까지 함께 막는다. */}
      <View style={s.footer}>
        <PressableScale
          testID="focus.result.home"
          style={s.homeBtn}
          haptic="light"
          disabled={leaving}
          onPress={() => {
            if (!navigation.canGoBack()) return;
            setLeaving(true);
            navigation.popToTop();
          }}
        >
          <Text style={s.homeText}>홈으로</Text>
        </PressableScale>
        {/* 스택: Main → FocusCategory → FocusResult(세션을 replace) — 새 화면을 쌓지 않고
            아래 깔린 기존 과목 선택으로 goBack(중복 스택 방지, 리뷰 반영) */}
        <PressableScale
          style={s.againBtn}
          haptic="light"
          disabled={leaving}
          onPress={() => {
            if (!navigation.canGoBack()) return;
            setLeaving(true);
            navigation.goBack();
          }}
        >
          <Text style={s.againText}>다시 집중</Text>
        </PressableScale>
      </View>

      {/* 주간 스트릭 완성 연출(GROMO-667) — ✓ 팝 뒤 축하 모달(종이폭죽은 모달 안에서 동시에) */}
      <WeekStreakModal visible={weekModalVisible} onClose={() => setWeekModalVisible(false)} />
    </SafeAreaView>
  );
}

// 나 vs 비교축 카드 — 3축(친구/전체/같은 카테고리) 셀렉터 + 오늘/이번 주 기간 탭 + 수평 바 2개.
// 미달도 격려체. GROMO-755: 3축 모두 평균 집계 API(753) 실데이터 — 블러 티저 제거.
// count 0(집계 대상 없음)과 -1(조회 실패)로 빈 상태 문구를 나눈다(679 구분 유지).
type CompareAxis = 'friends' | 'all' | 'category';
type ComparePeriod = 'DAY' | 'WEEK' | 'MONTH';
type CompareAvg = { avg: number | null; count: number } | undefined;

const COMPARE_PERIODS: { key: ComparePeriod; label: string }[] = [
  { key: 'DAY', label: '오늘' },
  { key: 'WEEK', label: '이번 주' },
  { key: 'MONTH', label: '이번 달' },
];

// 계측 파라미터 값 — ComparePeriod를 이벤트 공용 소문자 값으로 변환(GROMO-782)
const PERIOD_PARAM: Record<ComparePeriod, 'day' | 'week' | 'month'> = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
};

function CompareCard({
  mine,
  period,
  onPeriodChange,
  friends,
  total,
  category,
}: {
  mine: number;
  period: ComparePeriod;
  onPeriodChange: (period: ComparePeriod) => void;
  friends: CompareAvg;
  total: CompareAvg;
  category: CompareAvg;
}) {
  const [axis, setAxis] = useState<CompareAxis>('friends');
  const when = period === 'DAY' ? '오늘' : period === 'WEEK' ? '이번 주' : '이번 달';
  const meta: Record<
    CompareAxis,
    { chip: string; label: string; avg: number | null; loading: boolean; empty: string }
  > = {
    friends: {
      chip: '친구',
      label: '친구 평균',
      avg: friends?.avg ?? null,
      loading: friends === undefined,
      // count 0 = 친구 없음 또는 친구 전원 무활동(서버 sampleSize가 활동 유저 수라 구분 불가)
      // — 두 경우를 모두 덮는 중립 문구 + 행동 유도.
      empty:
        friends?.count === 0
          ? `${when} 집중한 친구가 아직 없어요. 친구를 추가하고 비교해봐요!`
          : '친구 평균을 불러오지 못했어요',
    },
    all: {
      chip: '전체',
      label: '전체 평균',
      avg: total?.avg ?? null,
      loading: total === undefined,
      empty:
        total?.count === 0
          ? `${when} 집중 기록이 아직 모이지 않았어요`
          : '전체 평균을 불러오지 못했어요',
    },
    category: {
      chip: '같은 카테고리',
      label: '같은 카테고리 평균',
      avg: category?.avg ?? null,
      loading: category === undefined,
      empty:
        category?.count === 0
          ? `${when} 같은 카테고리 기록이 아직 없어요`
          : '같은 카테고리 평균을 불러오지 못했어요',
    },
  };
  const cur = meta[axis];
  const avg = cur.avg;
  const delta = avg != null ? mine - avg : 0;
  const ahead = delta >= 0;
  const max = Math.max(mine, avg ?? 0, 1);
  const w = (v: number) => `${Math.max((v / max) * 100, 2)}%` as const;
  return (
    <View style={s.card}>
      {/* 헤더 — 제목 + 기간 탭(GROMO-692 과목 비교 카드와 동일 패턴) */}
      <View style={s.rowBetween}>
        <Text style={s.cardTitle}>{when} 비교</Text>
        <View style={s.periodRow}>
          {/* 세그먼트 칩은 탭바와 같은 정책 — 이미 선택된 칩은 재탭해도 아무 일이 없으므로
              스케일·사운드를 전부 끈다. 작은 칩이라 스케일은 0.94로 준다. */}
          {COMPARE_PERIODS.map(({ key, label }) => {
            const on = period === key;
            return (
              <PressableScale
                key={key}
                style={[s.axisChip, on ? s.axisChipOn : null]}
                scaleTo={on ? 1 : 0.94}
                sound={!on}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={label}
                onPress={() => {
                  // 같은 탭 재탭은 미계측
                  if (key !== period)
                    logFocusResultComparePeriodChanged({ period: PERIOD_PARAM[key] });
                  onPeriodChange(key);
                }}
              >
                <Text style={[s.axisChipText, on ? s.axisChipTextOn : null]}>{label}</Text>
              </PressableScale>
            );
          })}
        </View>
      </View>
      {/* 축 칩(좌) + 델타 뱃지(우) — 뱃지는 기간 탭에 자리를 내주고 축 줄로 이동 */}
      <View style={s.axisRow}>
        {(['friends', 'all', 'category'] as CompareAxis[]).map((a) => {
          const on = axis === a;
          return (
            <PressableScale
              key={a}
              style={[s.axisChip, on ? s.axisChipOn : null]}
              scaleTo={on ? 1 : 0.94}
              sound={!on}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={meta[a].chip}
              onPress={() => {
                // 같은 칩 재탭은 미계측
                if (a !== axis) logFocusResultCompareAxisChanged({ axis: a });
                setAxis(a);
              }}
            >
              <Text style={[s.axisChipText, on ? s.axisChipTextOn : null]}>{meta[a].chip}</Text>
            </PressableScale>
          );
        })}
        {avg != null ? (
          <View style={[s.deltaBadge, s.deltaBadgeEnd, ahead ? s.deltaBadgeUp : s.deltaBadgeDown]}>
            <Text style={[s.deltaBadgeText, { color: ahead ? T.successInk : T.dangerInk }]}>
              {ahead ? '▲' : '▼'} {fmtHm(Math.abs(delta))}
            </Text>
          </View>
        ) : null}
      </View>
      {avg != null ? (
        <>
          <View style={s.cmpBlock}>
            <View style={s.rowBetween}>
              <Text style={s.cmpLabelMine}>나</Text>
              <Text style={s.cmpValueMine}>{fmtHm(mine)}</Text>
            </View>
            <View style={s.cmpTrack}>
              <View style={[s.cmpFill, { width: w(mine), backgroundColor: T.accent }]} />
            </View>
          </View>
          <View style={s.cmpBlock}>
            <View style={s.rowBetween}>
              <Text style={s.cmpLabel}>{cur.label}</Text>
              <Text style={s.cmpValue}>{fmtHm(avg)}</Text>
            </View>
            <View style={s.cmpTrack}>
              <View style={[s.cmpFill, s.cmpFillAvg, { width: w(avg) }]} />
            </View>
          </View>
          <Text style={s.cmpCaption}>
            {ahead
              ? `${cur.label}보다 ${fmtHm(Math.abs(delta))} 더 집중했어요.`
              : `${cur.label}까지 ${fmtHm(Math.abs(delta))} 남았어요. 오늘도 한 걸음!`}
          </Text>
        </>
      ) : (
        // 로딩·미확보 — 텍스트 안내(GROMO-755: 티저 제거, 3축 모두 실데이터)
        <Text style={s.cmpCaption}>{cur.loading ? '불러오는 중…' : cur.empty}</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  scroll: {
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.lg,
    paddingBottom: T.space.xxl,
    gap: T.space.md,
  },

  header: { gap: T.space.xs, paddingVertical: T.space.xs },
  title: { ...T.text.stat, color: T.ink },
  sub: { ...T.text.label, fontWeight: '500', color: T.inkSub },
  // 획득 시간조각 배지(+N ⏳)
  coinBadge: {
    alignSelf: 'flex-start',
    backgroundColor: T.accentBg,
    borderRadius: 999,
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.xs,
    marginTop: T.space.xs,
  },
  coinBadgeText: { ...T.text.label, fontWeight: '800', color: T.accentDeep },

  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 18,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.lg,
    gap: T.space.sm,
  },
  miniLabel: { ...T.text.caption, fontSize: 11, fontWeight: '500', color: T.inkMuted },
  miniSub: { ...T.text.caption, color: T.inkMuted },
  focusRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: T.space.md,
  },
  bigStat: { ...T.text.display, color: T.ink, flexShrink: 1 },
  focusTime: { ...T.text.stat, color: T.accent, fontVariant: ['tabular-nums'] },

  // 과목별 집중 현황 (이번 집중 카드 하단 — 드로어와 동일 패턴: 행 목록 + 비율 바)
  catSection: {
    marginTop: T.space.md,
    paddingTop: T.space.md,
    borderTopWidth: 1,
    borderTopColor: T.divider,
  },
  catHeading: { ...T.text.caption, fontWeight: '700', color: T.inkSub, marginBottom: T.space.md },
  subjectList: { gap: T.space.md },
  subjectRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  subjectDot: { width: 8, height: 8, borderRadius: 4 },
  subjectName: { flex: 1, ...T.text.caption, color: T.ink },
  subjectTime: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
  },
  ratioTrack: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    backgroundColor: T.caramel,
    overflow: 'hidden',
    marginTop: T.space.md,
  },

  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  cardTitle: { ...T.text.label, fontWeight: '700', color: T.ink },
  cardValue: { ...T.text.subtitle, color: T.accent },

  // 스트릭 채우기 카드
  streakCard: {
    borderRadius: 20,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.lg,
    gap: T.space.lg,
  },
  streakHead: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  streakIcon: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakTitle: { ...T.text.label, fontWeight: '800', color: T.ink, flex: 1 },
  streakBadge: { ...T.text.caption, color: T.accentDeep },
  dotRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dotCol: { alignItems: 'center', gap: T.space.xs },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotOn: { backgroundColor: T.greenDeep, borderColor: T.greenDeep },
  dotFuture: { opacity: 0.4 },
  // 주간 완성 연출 — 오늘(일요일) ✓ 팝 오버레이(GROMO-667)
  dotPopFill: {
    ...StyleSheet.absoluteFill,
    borderRadius: 15,
    backgroundColor: T.greenDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDay: { ...T.text.caption, fontSize: 10, color: T.inkMuted },
  dotDayToday: { color: T.accentDeep, fontWeight: '800' },

  // 스트릭 기준 안내(GROMO-682)
  streakNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.accentBg,
    borderRadius: 12,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.md,
  },
  streakNoticeText: { ...T.text.caption, fontWeight: '500', color: T.accentDeep, flex: 1 },

  // 이번 주 집중시간 막대
  barRow: { flexDirection: 'row', alignItems: 'flex-end', gap: T.space.sm },
  barCol: { flex: 1, alignItems: 'center', gap: T.space.xs },
  barTrack: { height: BAR_H, justifyContent: 'flex-end' },
  bar: { width: 14, borderTopLeftRadius: 5, borderTopRightRadius: 5, transformOrigin: 'bottom' },
  barDay: { ...T.text.caption, fontSize: 10, color: T.inkMuted },
  barDayToday: { color: T.accent, fontWeight: '700' },
  // 세로축·눈금(GROMO-683) — StatsScreen 차트 축 패턴과 동일 구조
  chartPlotRow: { flexDirection: 'row', marginTop: T.space.sm },
  chartAxisCol: { width: 36, height: BAR_H },
  chartAxisLabel: {
    ...T.text.caption,
    position: 'absolute',
    right: 6,
    fontSize: 9,
    color: T.inkMuted,
  },
  chartAxisTop: { top: -5 },
  chartAxisUpper: { top: BAR_H / 3 - 5 },
  chartAxisLower: { top: (BAR_H * 2) / 3 - 5 },
  chartPlot: { flex: 1 },
  chartGridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: T.paperAlt,
  },
  chartGridTop: { top: 0 },
  chartGridUpper: { top: BAR_H / 3 },
  chartGridLower: { top: (BAR_H * 2) / 3 },
  chartGridBottom: { top: BAR_H },

  // 나 vs 비교축(3축 셀렉터 + 기간 탭)
  axisRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm, marginTop: T.space.xs },
  periodRow: { flexDirection: 'row', gap: T.space.sm },
  deltaBadgeEnd: { marginLeft: 'auto' },
  axisChip: {
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.sm,
    borderRadius: 999,
    backgroundColor: T.chipBg,
    borderWidth: 1,
    borderColor: T.chipBorder,
  },
  axisChipOn: { backgroundColor: T.accent, borderColor: T.accent },
  axisChipText: { ...T.text.caption, fontSize: 11, color: T.inkSub },
  axisChipTextOn: { color: T.white, fontWeight: '700' },
  deltaBadge: { borderRadius: 99, paddingHorizontal: T.space.sm, paddingVertical: 3 },
  deltaBadgeUp: { backgroundColor: T.successBg },
  deltaBadgeDown: { backgroundColor: T.dangerBg },
  deltaBadgeText: { ...T.text.caption, fontSize: 11, fontWeight: '700' },
  cmpBlock: { gap: T.space.xs, marginTop: T.space.sm },
  cmpLabelMine: { ...T.text.caption, fontWeight: '700', color: T.ink },
  cmpValueMine: { ...T.text.caption, fontWeight: '800', color: T.accent },
  cmpLabel: { ...T.text.caption, color: T.inkSub },
  cmpValue: { ...T.text.caption, fontWeight: '700', color: T.inkSub },
  cmpTrack: { height: 10, borderRadius: 5, backgroundColor: T.track, overflow: 'hidden' },
  cmpFill: { height: 10, borderRadius: 5 },
  cmpFillAvg: { backgroundColor: T.compare.avg },
  cmpCaption: { ...T.text.caption, fontWeight: '500', color: T.link, marginTop: T.space.md },

  // 하단 CTA
  footer: {
    flexDirection: 'row',
    gap: T.space.md,
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.sm,
    paddingBottom: T.space.md,
  },
  homeBtn: {
    flex: 1,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
    paddingVertical: T.space.lg,
    alignItems: 'center',
  },
  homeText: { ...T.text.subtitle, color: T.inkSub },
  againBtn: {
    flex: 1.4,
    backgroundColor: T.accent,
    borderRadius: 16,
    paddingVertical: T.space.lg,
    alignItems: 'center',
  },
  againText: { ...T.text.subtitle, color: T.white },
});
