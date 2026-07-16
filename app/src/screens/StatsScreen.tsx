import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  Platform,
  useWindowDimensions,
  type ScrollView,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Polygon, Polyline } from 'react-native-svg';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { T } from '@/constants/theme';
import type { StatsPeriod, HeatmapCellResponse, TodayStatsResponse } from '@/types/dto/stats';
import {
  logStatsViewed,
  logStatsPeriodChanged,
  logStatsShared,
  logStatsCompareAxisChanged,
  logStatsCardReordered,
  type CompareAxisParam,
} from '@/services/analyticsEvents';
import {
  fetchGlobalAverage,
  fetchCategoryAverage,
  fetchFriendsAverage,
  fetchFocusAverage,
} from '@/services/compareAverages';
import { useStatsData } from './stats/useStatsData';
import { ComingSoon } from './stats/ComingSoon';
import { CardOrderEditor } from './stats/CardOrderEditor';
import { SubjectProgressList } from '@/components/SubjectProgressList';
import { STORAGE_KEYS } from '@/types/storage';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
import { fetchTodayFocusSessions, sessionFocusSeconds } from '@/screens/focus/focusRestore';
import { getAllFocusSessions, getFocusTags } from '@/services/focusApi';
import type { FocusSessionResponse } from '@/types/dto/focus';
import { getHeatmap } from '@/services/statsApi';
import { useFocus } from '@/store/FocusContext';
import { useSubjects } from '@/store/SubjectContext';
import { localDateStr, todayStr } from '@/utils/localDate';
import { fmtMinutes, fmtHm, axisCeil, fmtAxis, hms } from '@/utils/timeFormat';
import {
  PERIOD_TABS,
  periodKey,
  heatmapBars,
  tenMinuteFocusSlots,
  weekdayFocusBlocks,
  grassLevel,
  dailyFirstStartMinutes,
  firstStartPoints,
  mergeCardOrder,
  type FocusSlotSegment,
  type WeekFocusBlock,
  type StatBar,
  type StartTimePoint,
} from './stats/format';

// v2 내 통계 화면(GROMO-604) — 홈 '오늘' 카드의 '자세히'에서 진입.
// 상단 고정 필터(기간 일/주/월) 아래로 ST1~ST9 지표 스크롤.
// 실데이터: 집중시간·폰사용·전대비·목표달성·잔디·총공부량(나)·과목별(나)·비교(친구/전체/같은 카테고리).
// 준비 중: 합격자 — 소스 미비로 스텁.

const CHART_H = 120;
// 잔디 강도 0..4 색(빈 칸 → 진한 초록).
const GRASS = T.grass;
const FOCUS_COLOR = T.greenDeep;
const PHONE_COLOR = T.accent;

// 히트맵 셀 → 지표 추출기 — 렌더마다 재생성되지 않게 모듈 상수(훅 의존성 안정화)
const pickFocus = (c: HeatmapCellResponse) => c.totalFocusMinutes;
const pickScreenTime = (c: HeatmapCellResponse) => c.actualScreenTimeMinutes;

// 달력 일 번호 — UTC 자정으로 정규화해 DST가 있는 시간대에서도 일수 차이가 정확(리뷰 반영)
const dayNumber = (y: number, monthIdx: number, d: number) =>
  Math.floor(Date.UTC(y, monthIdx, d) / 86400e3);

export default function StatsScreen() {
  const navigation = useNavigation();
  const [period, setPeriod] = useState<StatsPeriod>('WEEK');
  const { data, loading } = useStatsData(period);
  // 일 탭 과목별 카드 — 집중 세션 메뉴 드로어와 동일한 로컬 오늘 누적(SubjectContext) 사용
  const { subjects } = useSubjects();
  // 일 탭 총계도 같은 로컬 소스(홈·드로어와 동일) — 서버 집계(data.focus)는 업로드 지연·재시도 중이면
  // 과목별 합보다 낮게 보여 카드끼리 어긋난다(리뷰 반영)
  const { todayFocusSeconds } = useFocus();
  // 카드 순서(탭별, GROMO-762) — AsyncStorage에서 로드, 드래그 확정 시마다 저장.
  // 로드 완료 전에 그리면 기본 순서가 잠깐 보였다 튀므로 플래그로 막는다.
  const [cardOrder, setCardOrder] = useState<Record<string, string[]>>({});
  const [orderLoaded, setOrderLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.statsCardOrder)
      .then((raw) => {
        if (raw) setCardOrder(JSON.parse(raw));
      })
      .catch(() => {}) // 조회·파싱 실패 → 기본 순서
      .finally(() => setOrderLoaded(true));
  }, []);

  const onReorderCards = (keys: string[]) => {
    // 실제로 순서가 바뀐 경우만 계측 — 제자리 드롭에도 onReorder는 불린다
    // (저장된 순서가 없으면 비교 기준이 없어 첫 커스텀으로 간주하고 기록).
    if (cardOrder[period]?.join() !== keys.join()) {
      logStatsCardReordered({ period: periodKey(period), top_card: keys[0] });
    }
    const next = { ...cardOrder, [period]: keys };
    setCardOrder(next);
    AsyncStorage.setItem(STORAGE_KEYS.statsCardOrder, JSON.stringify(next)).catch(() => {});
  };

  // 화면 진입(포커스마다 1회) 로깅.
  useFocusEffect(
    useCallback(() => {
      logStatsViewed();
    }, []),
  );

  const onPeriod = (p: StatsPeriod) => {
    if (p === period) return;
    setPeriod(p);
    logStatsPeriodChanged({ period: periodKey(p) });
  };

  const firstLoad = loading && data.focus === null && data.heatmap.length === 0;

  // 카드 목록(현재 탭) — push 순서가 기본 순서(기존 렌더 순서 그대로). key는 순서 저장(AsyncStorage)에
  // 쓰이므로 바꾸면 유저가 저장한 순서와 어긋난다(GROMO-762).
  const month = new Date().getMonth() + 1;
  const cards: { key: string; node: ReactNode }[] = [];

  // 첫 진입 스포트라이트 투어(GROMO-652) — 총/과목별 카드를 차례로 비추고, 화면 밖이면
  // 스크롤로 끌어와서 보여준 뒤 투어가 끝나면 맨 위로 원위치한다.
  const { height: winH } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const guideScrollY = useRef(0);
  const filtersRef = useRef<View | null>(null);
  const totalCardRef = useRef<View | null>(null);
  const goalCardRef = useRef<View | null>(null);
  const categoryCardRef = useRef<View | null>(null);
  // 앵커가 필터 아래(140)~하단 여유(120) 사이에 오도록 스크롤한 뒤 측정하게 한다
  function scrollCardIntoView(ref: RefObject<View | null>) {
    return new Promise<void>((resolve) => {
      const node = ref.current;
      const scroller = scrollRef.current;
      if (!node || !scroller) {
        resolve();
        return;
      }
      node.measureInWindow((_x, y, _w, h) => {
        let delta = 0;
        if (y + h > winH - 120) delta = y + h - (winH - 120);
        else if (y < 140) delta = y - 140;
        if (delta === 0) {
          resolve();
          return;
        }
        guideScrollY.current = Math.max(0, guideScrollY.current + delta);
        scroller.scrollTo({ y: guideScrollY.current, animated: true });
        setTimeout(resolve, 380); // 스크롤 애니메이션이 끝난 뒤 측정
      });
    });
  }
  const guideSteps: GuideStep[] = [
    {
      text: '여기는 통계야!\n내 공부 기록을 그래프로 한눈에 볼 수 있어.',
      character: require('@/assets/character_hi.png'),
    },
    {
      text: '일·주·월 탭으로 기간을 바꿔서 봐.\n일은 오늘 하루를 자세히, 월은 한 달 흐름을 보여줘!',
      character: require('@/assets/character_study.png'),
      anchor: filtersRef,
    },
    {
      text: '기간 동안의 총 집중시간과 다른 사람들과의 비교를 보여줘.',
      character: require('@/assets/character_study.png'),
      anchor: totalCardRef,
      prepare: () => scrollCardIntoView(totalCardRef),
    },
    {
      text: '집중·사용시간 목표를 지켰는지 확인하는 곳이야.',
      character: require('@/assets/character_happy.png'),
      anchor: goalCardRef,
      prepare: () => scrollCardIntoView(goalCardRef),
    },
    {
      text: '과목별로 얼마나 집중했는지도 여기서 확인할 수 있어.\n아래로 내리면 더 많은 그래프가 기다리고 있어!',
      character: require('@/assets/character_happy.png'),
      anchor: categoryCardRef,
      prepare: () => scrollCardIntoView(categoryCardRef),
    },
  ];
  // 투어 종료 — 투어 중 옮긴 스크롤을 맨 위로 원복
  function finishGuide() {
    guideScrollY.current = 0;
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  // ST1 총 공부량 (나) + 비교 — 주간은 리그 랭킹 기반 실비교(GROMO-761), 일/월은 평균 집계
  // API(753) 기반 실비교(GROMO-833). 제목이 탭별 기간 표기(오늘/이번 주/N월)라 캡션 불필요
  cards.push({
    key: 'total',
    node: (
      <View key="total" ref={totalCardRef} collapsable={false}>
        <SectionCard
          title={
            period === 'DAY'
              ? '오늘 총 집중시간'
              : period === 'WEEK'
                ? '이번 주 총 집중시간'
                : `${month}월 총 집중시간`
          }
        >
          <Text style={s.bigStat}>
            {period === 'DAY'
              ? hms(todayFocusSeconds)
              : fmtMinutes(data.focus?.totalFocusMinutes ?? 0)}
          </Text>
          {period === 'WEEK' ? (
            <CompareWeek myMinutes={data.focus?.totalFocusMinutes ?? 0} />
          ) : (
            // key로 탭 전환 시 리마운트 — 이전 기간 평균이 새 탭 위에 잠깐 보이는 것 방지
            <ComparePeriod
              key={period}
              period={period}
              myMinutes={
                // 내 값은 위 큰 숫자와 동일 소스 — 일=로컬 오늘 누적(초→분), 월=서버 기간 집계
                period === 'DAY'
                  ? Math.round(todayFocusSeconds / 60)
                  : (data.focus?.totalFocusMinutes ?? 0)
              }
            />
          )}
        </SectionCard>
      </View>
    ),
  });

  // ST8 목표 달성(재도입) — 일=오늘 2목표 스탬프, 주=요일별 달성 도트, 월=달력 그리드.
  // 구 'goal' 카드는 2026-07-11 제거됐고 그 저장 키는 mergeCardOrder가 걸러냄 — 새 키 'goalAchieve'라
  // 옛 위치가 되살아나지 않는다. 일=today(오늘 2목표), 주/월=heatmap 달성일 집계.
  // 기본 위치: 모든 탭에서 총 집중시간 바로 아래.
  cards.push({
    key: 'goalAchieve',
    node: (
      <View key="goalAchieve" ref={goalCardRef} collapsable={false}>
        <SectionCard
          title={
            period === 'DAY'
              ? '오늘 목표 달성'
              : period === 'WEEK'
                ? '이번 주 목표 달성'
                : `${month}월 목표 달성`
          }
        >
          {period === 'DAY' ? (
            <GoalDayStamps today={data.today} />
          ) : period === 'WEEK' ? (
            <GoalWeekDots
              cells={data.heatmap}
              today={data.today}
              elapsedDays={data.screenTime?.elapsedDays ?? null}
            />
          ) : (
            <GoalMonthGrid
              cells={data.heatmap}
              today={data.today}
              elapsedDays={data.screenTime?.elapsedDays ?? null}
            />
          )}
        </SectionCard>
      </View>
    ),
  });

  // ST2 과목별 공부량 (나) — 총 공부량 바로 아래. 주/월 탭은 도넛(비중), 일 탭은 집중 세션 메뉴
  // 드로어와 동일한 과목별 현황(로컬 오늘 누적 — 색 점+시간+비율 바, GROMO-762)
  cards.push({
    key: 'category',
    node: (
      <View key="category" ref={categoryCardRef} collapsable={false}>
        <SectionCard
          title={
            period === 'DAY'
              ? '오늘 과목별 집중시간'
              : period === 'WEEK'
                ? '이번 주 과목별 집중시간'
                : `${month}월 과목별 집중시간`
          }
        >
          {period !== 'DAY' ? (
            <CategoryDonut
              items={data.category?.items ?? []}
              total={data.category?.totalFocusMinutes ?? 0}
            />
          ) : (
            <SubjectProgressList rows={subjects} />
          )}
        </SectionCard>
      </View>
    ),
  });

  // 타임테이블(일) — 오늘 세션 실데이터, 과목별 공부량 아래(GROMO-761). 카드 헤더에 공유 버튼(GROMO-762)
  if (period === 'DAY') {
    cards.push({
      key: 'timetable',
      node: <FocusTimetableCard key="timetable" />,
    });
  }

  // 해당월 주별 공부시간·핸드폰 사용량(월) — 과목별 아래. heatmap 주차 합산 실데이터(GROMO-761)
  if (period === 'MONTH') {
    cards.push({
      key: 'monthWeeklyFocus',
      node: (
        <SectionCard key="monthWeeklyFocus" title={`${month}월 주별 집중시간`}>
          <MonthWeeklyChart pick={pickFocus} color={FOCUS_COLOR} />
        </SectionCard>
      ),
    });
    cards.push({
      key: 'monthWeeklyPhone',
      node: (
        <SectionCard key="monthWeeklyPhone" title={`${month}월 주별 핸드폰 사용량`}>
          <MonthWeeklyChart pick={pickScreenTime} color={PHONE_COLOR} />
        </SectionCard>
      ),
    });
  }

  // ST5·ST6 요일별 집중시간·핸드폰 사용량(주) — 일 탭은 타임테이블이, 월 탭은 'N월 주별'이 대체
  if (period === 'WEEK') {
    cards.push({
      key: 'weekdayFocus',
      node: (
        <SectionCard key="weekdayFocus" title="요일별 집중시간">
          <Text style={[s.bigStat, { color: FOCUS_COLOR }]}>
            총 {fmtMinutes(data.focus?.totalFocusMinutes ?? 0)}
          </Text>
          <LineChart
            bars={heatmapBars(period, data.heatmap, (c) => c.totalFocusMinutes)}
            color={FOCUS_COLOR}
          />
        </SectionCard>
      ),
    });
    cards.push({
      key: 'weekdayPhone',
      node: (
        <SectionCard key="weekdayPhone" title="요일별 핸드폰 사용량">
          <Text style={[s.bigStat, { color: PHONE_COLOR }]}>
            총 {fmtMinutes(data.screenTime?.currentMinutes ?? 0)}
          </Text>
          <LineChart
            bars={heatmapBars(period, data.heatmap, (c) => c.actualScreenTimeMinutes)}
            color={PHONE_COLOR}
          />
        </SectionCard>
      ),
    });
  }

  // 주 탭: 요일별 집중 타임라인(GROMO-778) — 기존 '요일별 첫 집중 시작 시각' 차트를 대체.
  //   요일(열)×세로 시간축에 세션을 과목 색 블록으로. 첫 시작 시각은 그날 맨 위 블록 위치로 드러난다.
  // 월 탭: 주별 첫 집중 시작 시각 차트 유지(요일 타임테이블은 주 단위라 월엔 부적합).
  // 카드 키는 'firstStart'로 유지 — 저장된 카드 순서를 깨지 않기 위함.
  if (period !== 'DAY') {
    cards.push({
      key: 'firstStart',
      node:
        period === 'WEEK' ? (
          <WeeklyTimetableCard key="firstStart" />
        ) : (
          <SectionCard key="firstStart" title={`${month}월 주별 첫 집중 시작 시각`}>
            {/* key로 탭 전환 시 리마운트 — 이전 기간 점이 새 라벨 위에 잠깐 보이는 것 방지 */}
            <FirstStartChart key={period} period={period} />
          </SectionCard>
        ),
    });
  }

  // 최장 연속 집중(일·주·월) — 기간 내 최장 세션 기록(GROMO-762). 제목 자체가 탭별 '기간 최고기록'
  cards.push({
    key: 'longest',
    node: (
      <SectionCard
        key="longest"
        title={
          period === 'DAY'
            ? '오늘 최장 연속 집중'
            : period === 'WEEK'
              ? '이번 주 최장 연속 집중'
              : `${month}월 최장 연속 집중`
        }
      >
        <LongestSessionStat key={period} period={period} />
      </SectionCard>
    ),
  });

  // ST3 합격자 비교 — 레이더 티저 + 블러(데이터 준비 중)
  cards.push({
    key: 'passer',
    node: (
      <SectionCard key="passer" title="합격자와 비교">
        <ComingSoon note="합격자 데이터가 쌓이면 보여드릴게요">
          <PasserCompareChart />
        </ComingSoon>
      </SectionCard>
    ),
  });

  // ST7 전(前) 대비 — 제목은 탭별 직전 기간 표기(어제 / 저번주 / N-1월)
  cards.push({
    key: 'delta',
    node: (
      <SectionCard
        key="delta"
        title={
          period === 'DAY'
            ? '어제 대비'
            : period === 'WEEK'
              ? '저번 주 대비'
              : `${month === 1 ? 12 : month - 1}월 대비`
        }
      >
        <DeltaRow
          label="집중"
          delta={data.focus?.deltaMinutes ?? 0}
          base={data.focus?.previousTotalFocusMinutes ?? 0}
          lowerIsBetter={false}
        />
        <DeltaRow
          label="폰 사용"
          delta={data.screenTime?.deltaMinutes ?? 0}
          base={data.screenTime?.previousMinutes ?? 0}
          lowerIsBetter
        />
      </SectionCard>
    ),
  });

  // ST9 공부 잔디 (Streak) — 일 탭에선 숨김(하루 데이터로는 잔디가 무의미)
  if (period !== 'DAY') {
    cards.push({
      key: 'grass',
      node: (
        <SectionCard key="grass" title="공부 잔디">
          <View style={s.streakRow}>
            <View style={s.streakItem}>
              <Text style={s.streakValue}>{data.streak?.currentStreak ?? 0}일</Text>
              <Text style={s.streakLabel}>연속</Text>
            </View>
            <View style={s.streakDivider} />
            <View style={s.streakItem}>
              <Text style={s.streakValue}>{data.streak?.longestStreak ?? 0}일</Text>
              <Text style={s.streakLabel}>최장</Text>
            </View>
          </View>
          {/* 주 탭은 월~일 7칸 한 줄, 월 탭은 해당 월 전체 날짜 7칸씩 그리드 */}
          {period === 'WEEK' ? (
            <WeekGrassRow cells={data.heatmap} />
          ) : (
            <MonthGrassGrid cells={data.heatmap} />
          )}
          <Text style={s.grassHint}>집중시간이 많을수록 칸이 진해져요</Text>
        </SectionCard>
      ),
    });
  }

  // 저장된 순서 적용 — 저장이 없거나 이후 새 카드가 생겼으면 기본 순서에 병합
  const orderedKeys = mergeCardOrder(
    cards.map((c) => c.key),
    cardOrder[period],
  );
  const byKey = new Map(cards.map((c) => [c.key, c]));
  const orderedCards = orderedKeys.flatMap((k) => byKey.get(k) ?? []);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── 헤더 ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={T.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>통계</Text>
        {/* 오른쪽 스페이서 — 편집 토글(연필) 제거 후에도 제목이 가운데 유지되게 백버튼과 같은 폭 */}
        <View style={s.backBtn} />
      </View>

      {/* ── 고정 필터: 기간(일/주/월) — 과목 칩 필터는 제거(과목별 섹션이 전체를 보여줘 중복) ── */}
      <View style={s.filters} ref={filtersRef} collapsable={false}>
        <View style={s.segment}>
          {PERIOD_TABS.map((t) => {
            const on = period === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[s.segBtn, on ? s.segBtnOn : null]}
                onPress={() => onPeriod(t.key)}
                activeOpacity={0.8}
              >
                <Text style={[s.segText, on ? s.segTextOn : null]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {firstLoad || !orderLoaded ? (
        <View style={s.loader}>
          <ActivityIndicator color={T.accent} />
        </View>
      ) : (
        // 카드 목록 — 항상 드래그 가능(GROMO-762 개편). 카드 오른쪽 위 핸들을 잡아 끌면 순서가
        // 바뀌고 놓을 때마다 저장. 탭을 바꾸면 그 탭의 순서를 편집(탭별 저장)
        // scrollViewRef는 첫 진입 투어(GROMO-652)가 카드를 화면 안으로 끌어올 때 쓴다
        <CardOrderEditor
          key={period}
          cards={orderedCards}
          onReorder={onReorderCards}
          scrollViewRef={scrollRef}
        />
      )}

      {/* 첫 진입 스포트라이트 투어(GROMO-652) — 카드가 실제로 렌더된 뒤에만 */}
      {!firstLoad && orderLoaded ? (
        <TabGuideOverlay
          storageKey={STORAGE_KEYS.guideStats}
          steps={guideSteps}
          onFinish={finishGuide}
        />
      ) : null}
    </SafeAreaView>
  );
}

// ── 서브 컴포넌트 ──

function SectionCard({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardTitle}>{title}</Text>
        {caption ? <Text style={s.cardCaption}>{caption}</Text> : null}
      </View>
      {children}
    </View>
  );
}

// ST1 비교(주간 실데이터) — 전체/같은 카테고리는 리그 랭킹(주간 아레나 집계) 평균, 친구는 평균
// 집계 API(compareAverages 공용 헬퍼). 리그가 주간 집계라 '주' 탭에서만 유효 —
// 일/월은 평균 집계 API(753) 기반 ComparePeriod가 담당한다(GROMO-833).
function CompareWeek({ myMinutes }: { myMinutes: number }) {
  const [axis, setAxis] = useState<CompareAxisKey>('ALL');
  const [loaded, setLoaded] = useState(false);
  const [avgs, setAvgs] = useState<{
    global: number | null;
    category: { avg: number | null; label: string | null };
    friends: { avg: number | null; count: number };
  }>({ global: null, category: { avg: null, label: null }, friends: { avg: null, count: 0 } });

  // 화면 재진입마다 재조회 — 리뷰 반영(타임테이블과 동일 패턴)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [global, category, friends] = await Promise.all([
          fetchGlobalAverage(),
          fetchCategoryAverage(),
          fetchFriendsAverage('WEEK'),
        ]);
        if (cancelled) return;
        setAvgs({ global, category, friends });
        setLoaded(true);
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const avg =
    axis === 'ALL' ? avgs.global : axis === 'FRIENDS' ? avgs.friends.avg : avgs.category.avg;
  const avgLabel =
    axis === 'ALL'
      ? '전체 평균'
      : axis === 'FRIENDS'
        ? '친구 평균'
        : `${avgs.category.label ?? '같은 카테고리'} 평균`;
  // 축별 빈 상태 안내 — 친구 없음/준비 시험 미설정은 원인을 알려주고, 그 외엔 조회 실패로 안내.
  const emptyNote =
    axis === 'FRIENDS' && avgs.friends.count === 0
      ? '아직 친구가 없어요'
      : axis === 'CATEGORY' && !avgs.category.label
        ? '준비 시험을 설정하면 비교할 수 있어요'
        : '비교 데이터를 불러오지 못했어요';

  return (
    <View style={s.compare}>
      <CompareChips
        active={axis}
        onSelect={(k) => {
          // 같은 칩 재탭은 미계측 — 이 카드는 주 탭 전용이라 period 고정
          if (k !== axis) logStatsCompareAxisChanged({ axis: axisParam(k), period: 'week' });
          setAxis(k);
        }}
      />
      {!loaded ? (
        <View style={s.compareLoading}>
          <ActivityIndicator color={T.accent} size="small" />
        </View>
      ) : avg == null ? (
        <Text style={s.emptyText}>{emptyNote}</Text>
      ) : (
        <CompareBars myMinutes={myMinutes} avg={avg} avgLabel={avgLabel} />
      )}
    </View>
  );
}

// ST1 비교(일/월, GROMO-833) — 3축(친구/전체/같은 카테고리) 모두 평균 집계 API(753)로 조회.
// 그룹 값은 합계가 아니라 활동 유저 1인당 평균 — 내 값과 1:1 비교(티켓 833 용어 기준).
// 주 탭(CompareWeek)의 리그 랭킹 기반 방식은 그대로 유지(755에서 범위 외로 결정).
// count 0(집계 대상 없음)·-1(조회 실패)로 빈 문구를 나눈다(679 구분, 집중 결과 카드와 동일).
type CompareAxisKey = 'FRIENDS' | 'ALL' | 'CATEGORY';
type CompareAvg = { avg: number | null; count: number };

const COMPARE_AXES: { key: CompareAxisKey; chip: string; label: string }[] = [
  { key: 'FRIENDS', chip: '친구', label: '친구 평균' },
  { key: 'ALL', chip: '전체', label: '전체 평균' },
  { key: 'CATEGORY', chip: '같은 카테고리', label: '같은 카테고리 평균' },
];

// 계측 파라미터 값 — CompareAxisKey를 이벤트 공용 소문자 값으로 변환(GROMO-782)
const axisParam = (k: CompareAxisKey): CompareAxisParam =>
  k === 'FRIENDS' ? 'friends' : k === 'ALL' ? 'all' : 'category';

function ComparePeriod({ period, myMinutes }: { period: StatsPeriod; myMinutes: number }) {
  const [axis, setAxis] = useState<CompareAxisKey>('ALL');
  // 축별 도착 상태 — undefined=로딩. 도착한 축부터 채워 축 전환 시 기다림을 줄인다(755 패턴)
  const [avgs, setAvgs] = useState<Partial<Record<CompareAxisKey, CompareAvg>>>({});
  // 준비 시험(카테고리)명 — 서버는 미설정도 sampleSize 0으로 응답해 응답만으론 '표본 없음'과
  // 구분이 안 된다. CompareWeek처럼 로컬 값으로 미설정 문구를 분기한다(PR 254 리뷰 반영)
  const [categoryLabel, setCategoryLabel] = useState<string | null>(null);

  // 화면 재진입마다 재조회 — CompareWeek와 동일 패턴
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const put = (k: CompareAxisKey) => (v: CompareAvg) => {
        if (!cancelled) setAvgs((prev) => ({ ...prev, [k]: v }));
      };
      fetchFriendsAverage(period).then(put('FRIENDS'));
      fetchFocusAverage('TOTAL', period).then(put('ALL'));
      fetchFocusAverage('CATEGORY', period).then(put('CATEGORY'));
      AsyncStorage.getItem(STORAGE_KEYS.focusCategory)
        .then((v) => !cancelled && setCategoryLabel(v))
        .catch(() => {}); // 조회 실패 → 미설정과 동일 취급(설정 유도 문구)
      return () => {
        cancelled = true;
      };
    }, [period]),
  );

  const when = period === 'DAY' ? '오늘' : '이번 달';
  // 축별 빈 상태 안내 — count 0은 집계 대상 없음(원인 안내), 그 외(-1)는 조회 실패.
  // 카테고리 미설정은 기다려도 안 바뀌므로 설정 유도 문구로 분리(CompareWeek와 동일)
  const emptyNote = (k: CompareAxisKey, count: number): string => {
    if (count !== 0) return '비교 데이터를 불러오지 못했어요';
    if (k === 'FRIENDS') return `${when} 집중한 친구가 아직 없어요`;
    if (k === 'CATEGORY')
      return categoryLabel
        ? `${when} 같은 카테고리 기록이 아직 없어요`
        : '준비 시험을 설정하면 비교할 수 있어요';
    return `${when} 집중 기록이 아직 모이지 않았어요`;
  };
  const cur = avgs[axis];
  // 평균 라벨 — 카테고리 축은 주 탭(CompareWeek)처럼 실제 카테고리명으로 표기
  const avgLabel =
    axis === 'CATEGORY'
      ? `${categoryLabel ?? '같은 카테고리'} 평균`
      : (COMPARE_AXES.find((a) => a.key === axis) ?? COMPARE_AXES[1]).label;

  return (
    <View style={s.compare}>
      <CompareChips
        active={axis}
        onSelect={(k) => {
          // 같은 칩 재탭은 미계측
          if (k !== axis)
            logStatsCompareAxisChanged({ axis: axisParam(k), period: periodKey(period) });
          setAxis(k);
        }}
      />
      {cur === undefined ? (
        <View style={s.compareLoading}>
          <ActivityIndicator color={T.accent} size="small" />
        </View>
      ) : cur.avg == null ? (
        <Text style={s.emptyText}>{emptyNote(axis, cur.count)}</Text>
      ) : (
        <CompareBars myMinutes={myMinutes} avg={cur.avg} avgLabel={avgLabel} />
      )}
    </View>
  );
}

// 비교축 칩 한 줄(친구/전체/같은 카테고리) — CompareWeek(주)·ComparePeriod(일/월) 공용
function CompareChips({
  active,
  onSelect,
}: {
  active: CompareAxisKey;
  onSelect: (k: CompareAxisKey) => void;
}) {
  return (
    <View style={s.compareChips}>
      {COMPARE_AXES.map((a) => (
        <TouchableOpacity
          key={a.key}
          style={[s.compareChip, active === a.key ? s.compareChipOn : null]}
          onPress={() => onSelect(a.key)}
          activeOpacity={0.8}
        >
          <Text style={[s.compareChipText, active === a.key ? s.compareChipTextOn : null]}>
            {a.chip}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// 나 vs 평균 수평 바 2개 — CompareWeek(주)·ComparePeriod(일/월) 공용
function CompareBars({
  myMinutes,
  avg,
  avgLabel,
}: {
  myMinutes: number;
  avg: number;
  avgLabel: string;
}) {
  const denom = Math.max(myMinutes, avg, 1);
  return (
    <View style={s.teaserPad}>
      <View style={s.teaserRowHead}>
        <Text style={s.teaserLabelMine}>나</Text>
        <Text style={s.teaserValueMine}>{fmtMinutes(myMinutes)}</Text>
      </View>
      <View style={s.teaserTrack}>
        <View
          style={[s.teaserFill, s.teaserFillMine, { width: `${(myMinutes / denom) * 100}%` }]}
        />
      </View>
      <View style={[s.teaserRowHead, s.teaserRowGap]}>
        <Text style={s.teaserLabel}>{avgLabel}</Text>
        <Text style={s.teaserValue}>{fmtMinutes(avg)}</Text>
      </View>
      <View style={s.teaserTrack}>
        <View style={[s.teaserFill, s.teaserFillAvg, { width: `${(avg / denom) * 100}%` }]} />
      </View>
    </View>
  );
}

// ST3 티저 — 과목별 나 vs 합격자 이중 수평 바(시안 레이아웃). 데이터는 표시용 고정값.
// ST3 티저 — 과목별 나 vs 합격자 평균 레이더 차트(표시용 고정값, ComingSoon 블러 아래에 깔림).
const RADAR_AXES = [
  { name: '노동법', mine: 0.78, passer: 0.92 },
  { name: '민법', mine: 0.5, passer: 0.75 },
  { name: '행정쟁송법', mine: 0.55, passer: 0.7 },
  { name: '사회보험법', mine: 0.4, passer: 0.62 },
  { name: '경영학', mine: 0.65, passer: 0.6 },
];
const RADAR_SIZE = 210;
const RADAR_R = 72;

// 축 i의 반지름 비율 frac(0~1) 지점 좌표 — 12시 방향부터 시계 방향 균등 분할
function radarPoint(i: number, frac: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / RADAR_AXES.length;
  return {
    x: RADAR_SIZE / 2 + RADAR_R * frac * Math.cos(angle),
    y: RADAR_SIZE / 2 + RADAR_R * frac * Math.sin(angle),
  };
}

function radarPolygon(fracs: number[]): string {
  return fracs
    .map((f, i) => {
      const p = radarPoint(i, f);
      return `${p.x},${p.y}`;
    })
    .join(' ');
}

function PasserCompareChart() {
  return (
    <View style={s.radarWrap}>
      <View style={s.radarCanvas}>
        <Svg width={RADAR_SIZE} height={RADAR_SIZE}>
          {/* 배경 격자 — ⅓·⅔·1 폴리곤 + 중심에서 꼭짓점으로 축선 */}
          {[1 / 3, 2 / 3, 1].map((lv) => (
            <Polygon
              key={lv}
              points={radarPolygon(RADAR_AXES.map(() => lv))}
              fill="none"
              stroke={T.paperAlt}
              strokeWidth={1}
            />
          ))}
          {RADAR_AXES.map((_, i) => {
            const p = radarPoint(i, 1);
            return (
              <Line
                key={i}
                x1={RADAR_SIZE / 2}
                y1={RADAR_SIZE / 2}
                x2={p.x}
                y2={p.y}
                stroke={T.paperAlt}
                strokeWidth={1}
              />
            );
          })}
          {/* 합격자 평균 → 나 순서로 겹쳐 그림 */}
          <Polygon
            points={radarPolygon(RADAR_AXES.map((a) => a.passer))}
            fill={T.compare.theirs}
            fillOpacity={0.18}
            stroke={T.compare.theirs}
            strokeWidth={1.5}
          />
          <Polygon
            points={radarPolygon(RADAR_AXES.map((a) => a.mine))}
            fill={T.accent}
            fillOpacity={0.25}
            stroke={T.accent}
            strokeWidth={2}
          />
        </Svg>
        {/* 축 라벨 — 꼭짓점 바깥에 절대 배치 */}
        {RADAR_AXES.map((a, i) => {
          const p = radarPoint(i, 1.28);
          return (
            <Text
              key={a.name}
              style={[s.radarLabel, { left: p.x - 40, top: p.y - 8 }]}
              allowFontScaling={false}
            >
              {a.name}
            </Text>
          );
        })}
      </View>
      <View style={s.teaserLegend}>
        <View style={s.teaserLegendItem}>
          <View style={[s.teaserDot, { backgroundColor: T.accent }]} />
          <Text style={s.teaserLegendText}>나</Text>
        </View>
        <View style={s.teaserLegendItem}>
          <View style={[s.teaserDot, s.teaserDotPasser]} />
          <Text style={s.teaserLegendText}>합격자 평균</Text>
        </View>
      </View>
    </View>
  );
}

// 해당월 주별 차트(월 탭) — 이달 1일이 낀 주(월~일)의 월요일부터 heatmap을 달력 주 단위로 합산,
// 가로축은 실제 날짜 구간(예: 6/29~7/5)·해당월 전체 주 미리 기재·미래 주는 선 미표시. 전용 집계 API
// 없이 파생 계산(GROMO-761). 지표(pick)·색만 바꿔 공부시간/핸드폰 사용량이 공유한다.
// (하루 평균 전환을 검토했다가 주별 합계 유지로 결정 — 2026-07-11 결정기록 참고)
function MonthWeeklyChart({
  pick,
  color,
}: {
  pick: (c: HeatmapCellResponse) => number;
  color: string;
}) {
  const [bars, setBars] = useState<StatBar[] | null>(null);

  // 화면 재진입마다 재조회 — 세션 종료 후 돌아와도 최신 반영(리뷰 반영, useStatsData와 동일 패턴)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const now = new Date();
        const monthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
        // 이달 1일이 속한 주의 월요일 — 첫 주가 전월에 걸치면 전월 날짜부터 시작(예: 7월 첫 주 = 6/29~7/5)
        const dow = monthFirst.getDay(); // 0=일..6=토
        const weekStart0 = new Date(monthFirst);
        weekStart0.setDate(monthFirst.getDate() - (dow === 0 ? 6 : dow - 1));
        const cells = await getHeatmap(localDateStr(weekStart0), todayStr()).catch(
          () => [] as HeatmapCellResponse[],
        );
        if (cancelled) return;
        // 주차 인덱스는 달력 일수 차이 기준 — 경과 ms 나눗셈은 DST 전환일에 하루가 23/25시간이라 어긋난다(리뷰 반영)
        const startDay = dayNumber(
          weekStart0.getFullYear(),
          weekStart0.getMonth(),
          weekStart0.getDate(),
        );
        // 해당 월의 모든 주를 미리 기재 — 말일이 낀 주까지 포함(아직 안 온 주는 0으로 빈 막대)
        const monthLast = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const weekCount =
          Math.floor(
            (dayNumber(monthLast.getFullYear(), monthLast.getMonth(), monthLast.getDate()) -
              startDay) /
              7,
          ) + 1;
        const thisWeekIdx = Math.floor(
          (dayNumber(now.getFullYear(), now.getMonth(), now.getDate()) - startDay) / 7,
        );
        const sums: number[] = new Array(weekCount).fill(0);
        for (const c of cells) {
          const [y, m, d] = c.date.split('-').map(Number);
          const idx = Math.floor((dayNumber(y, m - 1, d) - startDay) / 7);
          if (idx >= 0 && idx < weekCount) sums[idx] += pick(c);
        }
        setBars(
          sums.map((v, i) => {
            const ws = new Date(weekStart0);
            ws.setDate(weekStart0.getDate() + i * 7);
            const we = new Date(ws);
            we.setDate(ws.getDate() + 6);
            // 달이 바뀌는 주만 월 표기(6/29~7/5), 같은 달 안의 주는 날짜만(6~12)
            const label =
              ws.getMonth() === we.getMonth()
                ? `${ws.getDate()}~${we.getDate()}`
                : `${ws.getMonth() + 1}/${ws.getDate()}~${we.getMonth() + 1}/${we.getDate()}`;
            return { label, value: v, current: i === thisWeekIdx, future: i > thisWeekIdx };
          }),
        );
      })();
      return () => {
        cancelled = true;
      };
    }, [pick]),
  );

  if (bars === null) {
    return (
      <View style={s.compareLoading}>
        <ActivityIndicator color={T.accent} size="small" />
      </View>
    );
  }
  return <LineChart bars={bars} color={color} />;
}

// ST4(일) 시간대별 집중 타임테이블 — 스터디 플래너식 격자. 한 줄 = 1시간(칸 6개 × 10분),
// 첫 줄 오전 6시 → 다음날 새벽 5시까지 24줄. 격자는 항상 그려지고, 오늘 세션(GET /focus-session)이
// 겹친 슬롯만 칠해진다(칠 농도 = 슬롯 내 집중 비율). 서버 집계 없이 세션 구간만으로 계산(GROMO-761).
const TIMETABLE_HOURS = Array.from({ length: 24 }, (_, i) => (i + 6) % 24);

// 타임테이블 카드(일) — 헤더에 공유 버튼. 카드 내용(범례+격자)을 이미지로 캡처해
// iOS 공유 시트로 내보낸다(react-native-view-shot, GROMO-762).
function FocusTimetableCard() {
  const shotRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  const onShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(shotRef, {
        format: 'png',
        quality: 1,
        // 공유 파일명 — 예: 260711_타임테이블.png (사진 저장 시엔 이름이 남지 않음)
        fileName: `${todayStr().slice(2).replace(/-/g, '')}_타임테이블`,
      });
      // Android Share는 url을 무시하고 message 기반이라 플랫폼별 페이로드(현재 iOS 전용 앱이지만 방어, 리뷰 반영)
      const result = await Share.share(Platform.OS === 'ios' ? { url: uri } : { message: uri });
      // 시트만 열고 닫으면 completed=false — 탭 대비 실공유 전환을 구분(GROMO-782)
      logStatsShared({ card: 'timetable', completed: result.action === Share.sharedAction });
    } catch {
      // 캡처 실패·공유 취소 — 무시
    } finally {
      setSharing(false);
    }
  };

  return (
    <SectionCard title="오늘 타임테이블">
      {/* 캡처 범위 — 배경을 칠해 PNG가 투명해지지 않게 */}
      <View ref={shotRef} collapsable={false} style={s.ttShot}>
        <FocusTimetable />
      </View>
      {/* 공유하기 — 카드 하단 오른쪽. 헤더(우측 상단)에 두면 순서 편집 드래그 핸들과 겹친다.
          shotRef 밖이라 캡처 이미지에는 안 담긴다 */}
      <TouchableOpacity
        style={s.shareBtn}
        onPress={onShare}
        hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
        activeOpacity={0.7}
        disabled={sharing}
      >
        <Text style={s.shareBtnText}>공유하기</Text>
        <Ionicons name="share-outline" size={15} color={T.inkSub} />
      </TouchableOpacity>
    </SectionCard>
  );
}

function FocusTimetable() {
  const { subjects } = useSubjects();
  const [slots, setSlots] = useState<FocusSlotSegment[][] | null>(null);
  // 서버 tagId → 태그명 (과목 색 매칭용). 로컬 과목 id는 서버 tagId와 다를 수 있어 이름으로 잇는다.
  const [tagNames, setTagNames] = useState<Map<string, string>>(new Map());

  // 화면 재진입마다 재조회 — 세션 종료 후 돌아와도 방금 세션이 타임테이블에 반영(리뷰 반영)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [sessions, tags] = await Promise.all([
          fetchTodayFocusSessions().catch(() => []),
          getFocusTags().catch(() => []),
        ]);
        if (cancelled) return;
        setTagNames(new Map(tags.map((t) => [t.tagId, t.name])));
        setSlots(tenMinuteFocusSlots(sessions));
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  if (slots === null) {
    return (
      <View style={s.compareLoading}>
        <ActivityIndicator color={T.accent} size="small" />
      </View>
    );
  }

  // 구간의 과목 색 — tagId → 태그명 → 로컬 과목 색. 미분류·매칭 실패는 기본 집중색.
  const colorForTag = (tagId: string | null): string => {
    const name = tagId ? tagNames.get(tagId) : undefined;
    const subject = name ? subjects.find((x) => x.name === name) : undefined;
    return subject?.color ?? FOCUS_COLOR;
  };

  // 왼쪽 범례 — 오늘 타임테이블에 등장한 과목만, 과목 순서대로. 텍스트를 형광펜처럼 과목 색으로 칠한다.
  const usedNames = new Set(
    slots
      .flat()
      .map((seg) => (seg.tagId ? tagNames.get(seg.tagId) : undefined))
      .filter((name): name is string => name != null),
  );
  const legendSubjects = subjects.filter((x) => usedNames.has(x.name));

  return (
    <View>
      <View style={s.ttLayout}>
        {/* 범례 칼럼은 비어도 자리를 유지 — 격자 크기가 범례 유무와 무관하게 고정되도록 */}
        <View style={s.ttLegendCol}>
          {legendSubjects.map((sub) => (
            <View key={sub.id} style={s.ttLegendRow}>
              <View style={[s.ttLegendDot, { backgroundColor: sub.color }]} />
              <Text style={s.ttLegendText} numberOfLines={1} allowFontScaling={false}>
                {sub.name}
              </Text>
            </View>
          ))}
        </View>
        <View style={s.ttGrid}>
          {TIMETABLE_HOURS.map((hour) => (
            <View key={hour} style={s.ttRow}>
              <Text style={s.ttHourLabel} allowFontScaling={false}>
                {hour}
              </Text>
              {Array.from({ length: 6 }, (_, i) => {
                const segments = slots[hour * 6 + i];
                return (
                  <View key={i} style={s.ttCell}>
                    {/* 슬롯 내 실제 집중 위치 그대로 칠함 — 3:35~3:45 집중이면 3:30 칸 오른쪽 절반 */}
                    {segments.map((seg, j) => (
                      <View
                        key={j}
                        style={[
                          s.ttCellFill,
                          {
                            backgroundColor: colorForTag(seg.tagId),
                            left: `${seg.start * 100}%`,
                            width: `${(seg.end - seg.start) * 100}%`,
                          },
                        ]}
                      />
                    ))}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </View>
      <Text style={s.grassHint}>한 칸 = 10분 · 집중한 과목 색으로 칠해져요</Text>
    </View>
  );
}

// 주간 타임라인 카드 — '오늘 타임테이블'(FocusTimetableCard)과 동일하게 공유하기(캡처→Share) 버튼 제공(GROMO-778).
function WeeklyTimetableCard() {
  const shotRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  const onShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(shotRef, {
        format: 'png',
        quality: 1,
        // 공유 파일명 — 예: 260716_주간타임라인.png (사진 저장 시엔 이름이 남지 않음)
        fileName: `${todayStr().slice(2).replace(/-/g, '')}_주간타임라인`,
      });
      // Android Share는 url을 무시하고 message 기반이라 플랫폼별 페이로드(현재 iOS 전용 앱이지만 방어)
      const result = await Share.share(Platform.OS === 'ios' ? { url: uri } : { message: uri });
      // 시트만 열고 닫으면 completed=false — 탭 대비 실공유 전환을 구분(GROMO-782)
      logStatsShared({ card: 'weekly_timeline', completed: result.action === Share.sharedAction });
    } catch {
      // 캡처 실패·공유 취소 — 무시
    } finally {
      setSharing(false);
    }
  };

  return (
    <SectionCard title="요일별 집중 타임라인">
      {/* 캡처 범위 — 배경을 칠해 PNG가 투명해지지 않게 */}
      <View ref={shotRef} collapsable={false} style={s.ttShot}>
        <WeeklyTimetable />
      </View>
      {/* 공유하기 — 카드 하단 오른쪽('오늘 타임테이블'과 동일). 헤더에 두면 상시 드래그 핸들과 겹친다.
          shotRef 밖이라 캡처 이미지에는 안 담긴다 */}
      <TouchableOpacity
        style={s.shareBtn}
        onPress={onShare}
        hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
        activeOpacity={0.7}
        disabled={sharing}
      >
        <Text style={s.shareBtnText}>공유하기</Text>
        <Ionicons name="share-outline" size={15} color={T.inkSub} />
      </TouchableOpacity>
    </SectionCard>
  );
}

// 주 탭 요일별 집중 타임라인(GROMO-778) — 요일(열)×세로 시간축. 세션을 날짜별로 분할해 해당 요일
// 칼럼에 과목 색 블록으로 그린다. 색 매핑(tagId→태그명→과목색)·조회 패턴은 '오늘 타임테이블'(FocusTimetable)과 동일.
const WTT_BODY_H = 220; // 트랙 세로 픽셀
const WTT_MIN_BLOCK = 3; // 아주 짧은 세션도 보이도록 최소 블록 높이
const WEEK_DOWS = ['월', '화', '수', '목', '금', '토', '일'];

function WeeklyTimetable() {
  const { subjects } = useSubjects();
  const [blocks, setBlocks] = useState<WeekFocusBlock[] | null>(null);
  // 서버 tagId → 태그명(과목 색 매칭용). 로컬 과목 id는 서버 tagId와 달라 이름으로 잇는다(FocusTimetable과 동일).
  const [tagNames, setTagNames] = useState<Map<string, string>>(new Map());
  // 플롯 실폭 — 칼럼 x좌표·세로 점선 격자 계산용(LineChart의 plotW 패턴)
  const [plotW, setPlotW] = useState(0);

  // 화면 재진입마다 재조회 — 세션 종료 후 돌아와도 방금 세션이 반영(FirstStartChart와 동일 패턴)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        // 이번 주 월요일 00:00(로컬)부터 지금까지. 전주 일요일에서 자정을 넘어온 세션의 월요일 몫도
        // 담기 위해 하루 전부터 받고(LongestSessionStat과 동일 방식), 주 시작 이전 조각은 헬퍼가 버린다.
        const now = new Date();
        const dow = now.getDay(); // 0=일..6=토
        const monday = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + (dow === 0 ? -6 : 1 - dow),
        );
        monday.setHours(0, 0, 0, 0);
        const from = new Date(monday);
        from.setDate(from.getDate() - 1);
        const [sessions, tags] = await Promise.all([
          getAllFocusSessions(from.toISOString(), now.toISOString()).catch(
            () => [] as FocusSessionResponse[],
          ),
          getFocusTags().catch(() => []),
        ]);
        if (cancelled) return;
        setTagNames(new Map(tags.map((t) => [t.tagId, t.name])));
        setBlocks(weekdayFocusBlocks(sessions, monday.getTime()));
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  if (blocks === null) {
    return (
      <View style={s.compareLoading}>
        <ActivityIndicator color={T.accent} size="small" />
      </View>
    );
  }
  if (blocks.length === 0) {
    return <Text style={s.emptyText}>아직 기록이 없어요</Text>;
  }

  // 구간의 과목 색 — tagId → 태그명 → 로컬 과목 색. 미분류·매칭 실패는 기본 집중색(FocusTimetable과 동일).
  const colorForTag = (tagId: string | null): string => {
    const name = tagId ? tagNames.get(tagId) : undefined;
    const subject = name ? subjects.find((x) => x.name === name) : undefined;
    return subject?.color ?? FOCUS_COLOR;
  };

  // 세로축 범위 — 데이터 최소~최대 시각을 3시간 배수로 맞춰 눈금이 정시가 되게(FirstStartChart와 동일 취지).
  const minH = Math.min(...blocks.map((b) => b.startMin)) / 60;
  const maxH = Math.max(...blocks.map((b) => b.endMin)) / 60;
  let startH = Math.max(0, Math.floor(minH / 3) * 3);
  let endH = Math.min(24, Math.ceil(maxH / 3) * 3);
  if (endH - startH < 6) {
    endH = Math.min(24, startH + 6);
    startH = Math.max(0, endH - 6);
  }
  const span = endH - startH;
  const px = WTT_BODY_H / span;
  const topOf = (hourFloat: number) => (hourFloat - startH) * px;

  const ticks: number[] = [];
  for (let h = startH; h <= endH; h += 3) ticks.push(h);

  // 오늘 칼럼(월=0..일=6) + 칼럼 폭
  const nowDow = new Date().getDay();
  const todayCol = nowDow === 0 ? 6 : nowDow - 1;
  const colW = plotW / 7;

  // 범례 — 타임라인에 등장한 과목만, 과목 순서대로(FocusTimetable과 동일)
  const usedNames = new Set(
    blocks
      .map((b) => (b.tagId ? tagNames.get(b.tagId) : undefined))
      .filter((n): n is string => n != null),
  );
  const legendSubjects = subjects.filter((x) => usedNames.has(x.name));

  return (
    <View>
      {/* 요일 헤더 */}
      <View style={s.wttHeadRow}>
        <View style={s.wttGutter} />
        {WEEK_DOWS.map((d, i) => (
          <Text
            key={i}
            style={[
              s.wttDayLabel,
              i === 5 ? s.wttSat : i === 6 ? s.wttSun : null,
              i === todayCol ? s.wttTodayLabel : null,
            ]}
            allowFontScaling={false}
          >
            {d}
          </Text>
        ))}
      </View>
      {/* 시간축 + 플롯(수면 차트식) — 칼럼 배경 트랙 없이 가로 실선(3시간)·칼럼 사이 세로 점선만.
          빈 요일은 문구 없이 빈 공간 그대로 둔다 */}
      <View style={s.wttBodyRow}>
        <View style={[s.wttGutter, { height: WTT_BODY_H }]}>
          {ticks.map((h) => (
            <Text key={h} style={[s.wttTick, { top: topOf(h) - 6 }]} allowFontScaling={false}>
              {h}
            </Text>
          ))}
        </View>
        <View
          style={[s.wttPlot, { height: WTT_BODY_H }]}
          onLayout={(e) => setPlotW(e.nativeEvent.layout.width)}
        >
          {plotW > 0 && (
            <>
              <Svg width={plotW} height={WTT_BODY_H} style={StyleSheet.absoluteFill}>
                {ticks.map((h) => (
                  <Line
                    key={`h${h}`}
                    x1={0}
                    y1={topOf(h)}
                    x2={plotW}
                    y2={topOf(h)}
                    stroke={T.divider}
                    strokeWidth={1}
                  />
                ))}
                {Array.from({ length: 6 }, (_, i) => (
                  <Line
                    key={`v${i}`}
                    x1={colW * (i + 1)}
                    y1={0}
                    x2={colW * (i + 1)}
                    y2={WTT_BODY_H}
                    stroke={T.chipBorder}
                    strokeWidth={1}
                    strokeDasharray="2 4"
                  />
                ))}
              </Svg>
              {/* 세션 블록 — 과목색 각진 사각형(라운드 없음), 휴식 틈은 그대로 빈 공간 */}
              {blocks.map((b, j) => (
                <View
                  key={j}
                  style={[
                    s.wttBlock,
                    {
                      left: b.col * colW + 3,
                      width: colW - 6,
                      top: topOf(b.startMin / 60),
                      height: Math.max(WTT_MIN_BLOCK, ((b.endMin - b.startMin) / 60) * px),
                      backgroundColor: colorForTag(b.tagId),
                    },
                  ]}
                />
              ))}
            </>
          )}
        </View>
      </View>
      {/* 범례 */}
      {legendSubjects.length > 0 && (
        <View style={s.wttLegend}>
          {legendSubjects.map((sub) => (
            <View key={sub.id} style={s.wttLegendItem}>
              <View style={[s.wttLegendDot, { backgroundColor: sub.color }]} />
              <Text style={s.wttLegendText} numberOfLines={1} allowFontScaling={false}>
                {sub.name}
              </Text>
            </View>
          ))}
        </View>
      )}
      <Text style={s.grassHint}>요일별 집중 시간대 · 집중한 과목 색으로 칠해져요</Text>
    </View>
  );
}

// 선그래프 — BarChart와 같은 데이터(StatBar[])·세로축 구조를 쓰되 값을 점+꺾은선으로 잇는다(주 탭, GROMO-761).
// 점의 x좌표는 아래 라벨 칼럼(flex 균등 분할)의 중앙과 일치. 직선·원은 SVG가 필요해 react-native-svg 사용.
const DOT_PAD = 6; // 점(최대 r 4.5)이 캔버스 경계에서 잘리지 않게 사방 여유
function LineChart({ bars, color }: { bars: StatBar[]; color: string }) {
  const [plotW, setPlotW] = useState(0);
  if (bars.length === 0) {
    return <Text style={s.emptyText}>아직 기록이 없어요</Text>;
  }
  const axisMax = axisCeil(Math.max(...bars.map((b) => b.value), 1));
  const step = plotW / bars.length;
  // 아직 오지 않은 구간(future)은 라벨만 남기고 선·점에서 제외 — x좌표는 원래 칼럼 위치 유지
  const pts = bars
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => !b.future)
    .map(({ b, i }) => ({
      x: step * (i + 0.5),
      y: CHART_H - (b.value / axisMax) * CHART_H,
      current: b.current,
    }));
  return (
    <View style={s.chartPlotRow}>
      {/* 세로축 — 상한·⅔·⅓ 눈금 3줄 (막대 차트와 동일) */}
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
      <View style={s.chartPlot} onLayout={(e) => setPlotW(e.nativeEvent.layout.width)}>
        <View style={[s.chartGridLine, s.chartGridTop]} />
        <View style={[s.chartGridLine, s.chartGridUpper]} />
        <View style={[s.chartGridLine, s.chartGridLower]} />
        <View style={[s.chartGridLine, s.chartGridBottom]} />
        {plotW > 0 && (
          // 캔버스를 점 반지름만큼 사방으로 키우고 음수 마진으로 되돌림 — 상단(최댓값)·바닥(0)의
          // 점이 캔버스 경계에서 잘리지 않게 (SVG는 자기 영역 밖을 클리핑)
          <Svg width={plotW + DOT_PAD * 2} height={CHART_H + DOT_PAD * 2} style={s.lineSvg}>
            <Polyline
              points={pts.map((p) => `${p.x + DOT_PAD},${p.y + DOT_PAD}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={2}
            />
            {pts.map((p, i) => (
              <Circle
                key={i}
                cx={p.x + DOT_PAD}
                cy={p.y + DOT_PAD}
                r={p.current ? 4.5 : 3}
                fill={color}
              />
            ))}
          </Svg>
        )}
        <View style={s.lineLabelRow}>
          {bars.map((b, i) => (
            <Text
              key={`${b.label}-${i}`}
              style={[s.lineLabel, b.current ? [s.lineLabelCur, { color }] : null]}
              allowFontScaling={false}
            >
              {b.label}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

// 첫 시작 시각 추이(주·월) — 일별 첫 세션 startedAt을 점으로만 찍는다(선 연결 없음, GROMO-762).
// 세로축은 시각이라 LineChart(0부터 시작하는 분량 축)를 못 쓰고 전용 축을 그린다. 시간표처럼
// 이른 시각이 위 — 시작이 빨라지면 점이 올라간다. 주=요일별, 월=주별 평균. 서버 집계 없이 세션 조회만으로 계산.
function FirstStartChart({ period }: { period: StatsPeriod }) {
  const [points, setPoints] = useState<StartTimePoint[] | null>(null);
  const [plotW, setPlotW] = useState(0);

  // 화면 재진입마다 재조회 — 세션 종료 후 돌아와도 방금 세션이 반영(타임테이블과 동일 패턴)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        // 조회 시작점: 주=이번 주 월요일, 월=이달 1일이 낀 주의 월요일('N월 주별' 차트와 동일 구간).
        // 서버 /focus-session은 startedAt 필터라 '그날 시작한 세션'과 정확히 일치한다.
        const now = new Date();
        const from = new Date(
          period === 'WEEK' ? now : new Date(now.getFullYear(), now.getMonth(), 1),
        );
        const dow = from.getDay(); // 0=일..6=토
        from.setDate(from.getDate() - (dow === 0 ? 6 : dow - 1));
        from.setHours(0, 0, 0, 0);
        // 조회 실패 → 빈 차트("아직 기록이 없어요")로 표시
        const all = await getAllFocusSessions(from.toISOString(), new Date().toISOString()).catch(
          () => [] as FocusSessionResponse[],
        );
        if (cancelled) return;
        setPoints(firstStartPoints(period, dailyFirstStartMinutes(all)));
      })();
      return () => {
        cancelled = true;
      };
    }, [period]),
  );

  if (points === null) {
    return (
      <View style={s.compareLoading}>
        <ActivityIndicator color={T.accent} size="small" />
      </View>
    );
  }

  const vals = points.filter((p) => !p.future && p.minutes != null).map((p) => p.minutes as number);
  if (vals.length === 0) {
    return <Text style={s.emptyText}>아직 기록이 없어요</Text>;
  }

  // 세로축 경계 — 정시로 내리고 폭을 3시간 배수로 맞춰 ⅓·⅔ 눈금도 정시가 되게 한다
  let axisMin = Math.floor(Math.min(...vals) / 60) * 60;
  const span = Math.max(180, Math.ceil((Math.max(...vals) - axisMin) / 180) * 180);
  let axisMax = axisMin + span;
  if (axisMax > 1440) {
    // 심야 시작이면 축이 24시를 넘지 않게 아래로 내림
    axisMax = 1440;
    axisMin = 1440 - span;
  }
  const fmtClock = (m: number) => `${Math.floor(m / 60)}시`;
  const step = plotW / points.length;
  // 미래 구간·기록 없는 날은 라벨만 남기고 점에서 제외(0으로 찍으면 '자정 시작'으로 왜곡)
  const pts = points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.future && p.minutes != null)
    .map(({ p, i }) => ({
      x: step * (i + 0.5),
      y: (((p.minutes as number) - axisMin) / (axisMax - axisMin)) * CHART_H,
    }));
  return (
    <View>
      <View style={s.chartPlotRow}>
        {/* 세로축 — 위가 이른 시각. 분량 축과 달리 바닥이 0이 아니라 4눈금 모두 라벨 */}
        <View style={s.chartAxisCol}>
          <Text style={[s.chartAxisLabel, s.chartAxisTop]} allowFontScaling={false}>
            {fmtClock(axisMin)}
          </Text>
          <Text style={[s.chartAxisLabel, s.chartAxisUpper]} allowFontScaling={false}>
            {fmtClock(axisMin + span / 3)}
          </Text>
          <Text style={[s.chartAxisLabel, s.chartAxisLower]} allowFontScaling={false}>
            {fmtClock(axisMin + (span * 2) / 3)}
          </Text>
          <Text style={[s.chartAxisLabel, s.chartAxisBottom]} allowFontScaling={false}>
            {fmtClock(axisMax)}
          </Text>
        </View>
        <View style={s.chartPlot} onLayout={(e) => setPlotW(e.nativeEvent.layout.width)}>
          <View style={[s.chartGridLine, s.chartGridTop]} />
          <View style={[s.chartGridLine, s.chartGridUpper]} />
          <View style={[s.chartGridLine, s.chartGridLower]} />
          <View style={[s.chartGridLine, s.chartGridBottom]} />
          {plotW > 0 && (
            <Svg width={plotW + DOT_PAD * 2} height={CHART_H + DOT_PAD * 2} style={s.lineSvg}>
              {/* 선 없이 점만이라 크게(r 5, DOT_PAD 안) — 오늘 강조는 크기 대신 라벨 볼드만 */}
              {pts.map((p, i) => (
                <Circle key={i} cx={p.x + DOT_PAD} cy={p.y + DOT_PAD} r={5} fill={FOCUS_COLOR} />
              ))}
            </Svg>
          )}
          <View style={s.lineLabelRow}>
            {points.map((p, i) => (
              <Text
                key={`${p.label}-${i}`}
                style={[s.lineLabel, p.current ? [s.lineLabelCur, { color: FOCUS_COLOR }] : null]}
                allowFontScaling={false}
              >
                {p.label}
              </Text>
            ))}
          </View>
        </View>
      </View>
      <Text style={s.grassHint}>그날 처음 집중을 시작한 시각 · 위로 갈수록 이른 시각이에요</Text>
    </View>
  );
}

// 최장 연속 집중(일·주·월) — 기간 내 가장 긴 세션(endedAt−startedAt, 방해시간 미차감)을 HH:MM:SS로.
// 기간 귀속은 앱의 '오늘' 규칙(홈 정산·타임테이블)과 동일하게 종료 시점 기준 — 기간 시작 하루 전부터
// 받아 endedAt으로 거른다. 월은 이달 1일부터('N월 주별'류의 주 정렬과 달리 달 자체의 기록이라 1일 기준).
function LongestSessionStat({ period }: { period: StatsPeriod }) {
  const [seconds, setSeconds] = useState<number | null>(null); // null=로딩 · 0=기록 없음

  // 화면 재진입마다 재조회 — 세션 종료 후 돌아와도 방금 세션이 반영(타임테이블과 동일 패턴)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        let sessions: FocusSessionResponse[];
        if (period === 'DAY') {
          sessions = await fetchTodayFocusSessions().catch(() => []);
        } else {
          // 기간 시작(로컬 자정): 주=이번 주 월요일, 월=이달 1일
          const now = new Date();
          const dow = now.getDay(); // 0=일..6=토
          const start =
            period === 'WEEK'
              ? new Date(
                  now.getFullYear(),
                  now.getMonth(),
                  now.getDate() + (dow === 0 ? -6 : 1 - dow),
                )
              : new Date(now.getFullYear(), now.getMonth(), 1);
          // 자정 걸친 세션 포함 위해 하루 전부터 받아 endedAt으로 거른다(fetchTodayFocusSessions와 동일 방식)
          const from = new Date(start);
          from.setDate(from.getDate() - 1);
          const all = await getAllFocusSessions(from.toISOString(), now.toISOString()).catch(
            () => [] as FocusSessionResponse[],
          );
          sessions = all.filter((x) => Date.parse(x.endedAt) >= start.getTime());
        }
        if (cancelled) return;
        setSeconds(sessions.reduce((mx, x) => Math.max(mx, sessionFocusSeconds(x)), 0));
      })();
      return () => {
        cancelled = true;
      };
    }, [period]),
  );

  if (seconds === null) {
    return (
      <View style={s.compareLoading}>
        <ActivityIndicator color={T.accent} size="small" />
      </View>
    );
  }
  if (seconds <= 0) {
    return <Text style={s.emptyText}>아직 기록이 없어요</Text>;
  }
  return (
    <View>
      <Text style={[s.bigStat, { color: FOCUS_COLOR }]}>{hms(seconds)}</Text>
      <Text style={s.grassHint}>한 번에 가장 오래 이어간 집중 세션이에요</Text>
    </View>
  );
}

// ST2(주) 과목별 공부량 도넛 — 과목별 비중을 링 구간(strokeDasharray)으로 그리고 가운데에 총합,
// 우측 범례에 과목·비중을 표시(GROMO-761). 색은 CategoryBars와 동일하게 팔레트 순서 배정.
const DONUT_SIZE = 132;
const DONUT_STROKE = 20;

function CategoryDonut({
  items,
  total,
}: {
  items: { tagId: string | null; tagName: string | null; totalFocusMinutes: number }[];
  total: number;
}) {
  if (items.length === 0) {
    return <Text style={s.emptyText}>아직 기록이 없어요</Text>;
  }
  const denom = total || 1;
  const half = DONUT_SIZE / 2;
  const r = (DONUT_SIZE - DONUT_STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  let acc = 0;
  const segs = items.map((it, i) => {
    const seg = {
      frac: it.totalFocusMinutes / denom,
      minutes: it.totalFocusMinutes,
      offset: acc,
      color: T.subjectPalette[i % T.subjectPalette.length],
      name: it.tagName ?? '미분류',
    };
    acc += seg.frac;
    return seg;
  });
  return (
    <View style={s.donutRow}>
      <View style={s.donutWrap}>
        <Svg width={DONUT_SIZE} height={DONUT_SIZE}>
          <Circle
            cx={half}
            cy={half}
            r={r}
            stroke={T.track}
            strokeWidth={DONUT_STROKE}
            fill="none"
          />
          {segs.map((sg, i) => (
            <Circle
              key={i}
              cx={half}
              cy={half}
              r={r}
              stroke={sg.color}
              strokeWidth={DONUT_STROKE}
              fill="none"
              strokeDasharray={`${sg.frac * circumference} ${circumference}`}
              strokeDashoffset={-sg.offset * circumference}
              transform={`rotate(-90 ${half} ${half})`}
            />
          ))}
        </Svg>
        {/* 가운데 총합 — 12시 방향부터 시계 방향으로 구간이 채워진다 */}
        <View style={s.donutCenter}>
          <Text style={s.donutCenterValue} allowFontScaling={false}>
            {fmtMinutes(total)}
          </Text>
          <Text style={s.donutCenterLabel}>총 공부</Text>
        </View>
      </View>
      <View style={s.donutLegend}>
        {segs.map((sg, i) => (
          <View key={i} style={s.donutLegendRow}>
            <View style={[s.donutLegendDot, { backgroundColor: sg.color }]} />
            <Text style={s.donutLegendName} numberOfLines={1}>
              {sg.name}
            </Text>
            <Text style={s.donutLegendTime} allowFontScaling={false}>
              {fmtMinutes(sg.minutes)}
            </Text>
            <Text style={s.donutLegendPct} allowFontScaling={false}>
              {Math.round(sg.frac * 100)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function DeltaRow({
  label,
  delta,
  base,
  lowerIsBetter,
}: {
  label: string;
  delta: number;
  base: number;
  lowerIsBetter: boolean;
}) {
  const pct = base > 0 ? Math.round((Math.abs(delta) / base) * 100) : null;
  const up = delta > 0;
  const flat = delta === 0;
  const good = flat ? false : lowerIsBetter ? !up : up;
  const arrow = flat ? '–' : up ? '▲' : '▼';
  const color = flat ? T.inkMuted : good ? T.successInk : T.dangerInk;
  return (
    <View style={s.deltaRow}>
      <Text style={s.deltaLabel}>{label}</Text>
      <View style={s.deltaValueWrap}>
        <Text style={[s.deltaArrow, { color }]}>{arrow}</Text>
        <Text style={[s.deltaPct, { color }]}>{pct === null ? '–' : `${pct}%`}</Text>
        <Text style={s.deltaMin}>{flat ? '변화 없어요' : `${fmtMinutes(Math.abs(delta))}`}</Text>
      </View>
    </View>
  );
}

// ── 목표 달성(ST8 재도입) ──
// 일: 오늘 집중·폰 사용 목표 2개를 스탬프로. 집중=정한 시간 '채우기'(달성 체크),
// 폰 사용=제한 '이내 유지'(초과 시 실패, 이내면 목표까지 남은 사용 시간 표시).
// 주/월: heatmap의 focusGoalAchieved·screenTimeGoalAchieved로 달성한 '날 수'를 집계.

// 일 탭 — 오늘 2목표 스탬프. 집중 현재값은 홈·타임테이블과 같은 로컬 오늘 누적(서버 today.focus는
// 업로드 지연이 있어 총계 카드와 어긋난다) + 목표는 서버값. 폰 사용은 서버 today.screenTime.
function GoalDayStamps({ today }: { today: TodayStatsResponse | null }) {
  const { todayFocusSeconds } = useFocus();
  if (today === null) {
    return <Text style={s.emptyText}>목표 정보를 불러오지 못했어요</Text>;
  }
  return (
    <View style={s.stampRow}>
      {/* floor — 반올림하면 59분 31초가 60분이 돼 목표 도달 전에 '달성'이 뜬다(PR 리뷰 반영) */}
      <FocusStamp cur={Math.floor(todayFocusSeconds / 60)} goal={today.focus.goalMinutes} />
      <PhoneStamp cur={today.screenTime.todayMinutes} goal={today.screenTime.goalMinutes} />
    </View>
  );
}

function StampIcon({
  bg,
  name,
  color,
}: {
  bg: string;
  name: keyof typeof Ionicons.glyphMap;
  color: string;
}) {
  return (
    <View style={[s.stampIc, { backgroundColor: bg }]}>
      <Ionicons name={name} size={22} color={color} />
    </View>
  );
}

// 집중 목표 — 정한 시간을 채우면 달성. 미설정(0)·진행 중·달성 3상태.
function FocusStamp({ cur, goal }: { cur: number; goal: number }) {
  if (goal <= 0) {
    return (
      <View style={s.stamp}>
        <StampIcon bg={T.track} name="book-outline" color={T.inkMuted} />
        <Text style={[s.stampTitle, { color: T.inkMuted }]}>목표 미설정</Text>
        <Text style={s.stampSub}>설정에서 집중 목표를 정해요</Text>
      </View>
    );
  }
  if (cur >= goal) {
    return (
      <View style={[s.stamp, s.stampOn]}>
        <StampIcon bg={T.green} name="checkmark" color={T.white} />
        <Text style={[s.stampTitle, { color: FOCUS_COLOR }]}>집중 달성</Text>
        <Text style={[s.stampSub, { color: T.successInk }]}>
          {cur}분 · 목표 {goal}분
        </Text>
      </View>
    );
  }
  return (
    <View style={s.stamp}>
      <StampIcon bg={T.greenBg} name="book-outline" color={FOCUS_COLOR} />
      <Text style={[s.stampTitle, { color: FOCUS_COLOR }]}>
        집중 {cur}/{goal}분
      </Text>
      <Text style={s.stampSub}>목표까지 {goal - cur}분</Text>
    </View>
  );
}

// 폰 사용 목표 — 제한 이내로 유지가 목표. 미설정(0)·초과(실패)·이내(남은 시간) 3상태.
function PhoneStamp({ cur, goal }: { cur: number; goal: number }) {
  if (goal <= 0) {
    return (
      <View style={s.stamp}>
        <StampIcon bg={T.track} name="phone-portrait-outline" color={T.inkMuted} />
        <Text style={[s.stampTitle, { color: T.inkMuted }]}>목표 미설정</Text>
        <Text style={s.stampSub}>설정에서 폰 사용 목표를 정해요</Text>
      </View>
    );
  }
  if (cur > goal) {
    return (
      <View style={[s.stamp, s.stampFail]}>
        <StampIcon bg={T.accentAlt} name="close" color={T.white} />
        <Text style={[s.stampTitle, { color: T.dangerInk }]}>목표 달성 실패!</Text>
        <Text style={s.stampSub}>
          폰 사용 {fmtHm(cur)} · 목표 {fmtHm(goal)}
        </Text>
      </View>
    );
  }
  return (
    <View style={[s.stamp, s.stampProgress]}>
      <StampIcon bg={T.white} name="time-outline" color={T.accentDeep} />
      <Text style={[s.stampTitle, { color: T.accentDeep }]}>{fmtHm(goal - cur)} 남음</Text>
      <Text style={s.stampSub}>
        폰 사용 {fmtHm(cur)} · 목표 {fmtHm(goal)}
      </Text>
    </View>
  );
}

type GoalDotState = 'on' | 'miss' | 'future';

// 주 탭 — 집중·폰 사용 각각 월~일 7칸 도트. 달성=색, 미달=빨강 틴트, 미래·판정 전·가입 전=회색.
// 오늘은 heatmap 플래그 대신 라이브 판정(PR 리뷰 반영) — 폰 사용 플래그는 다음날 마감까지 항상
// false라 그대로 쓰면 아직 목표 이내인 오늘이 하루 종일 '미달'로 칠해진다. 집중=달성 즉시 확정(on),
// 폰=초과만 확정(miss), 그 외는 진행 중(중립). 가입 전 요일은 서버가 가입일로 클램프한
// elapsedDays(스크린타임 기간 통계)로 역산해 중립 처리(신규 유저가 미달로 보이지 않게).
function GoalWeekDots({
  cells,
  today,
  elapsedDays,
}: {
  cells: HeatmapCellResponse[];
  today: TodayStatsResponse | null;
  elapsedDays: number | null;
}) {
  const now = new Date();
  const dow = now.getDay(); // 0=일..6=토
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + (dow === 0 ? -6 : 1 - dow),
  );
  const todayKey = todayStr();
  const byDate = new Map(cells.map((c) => [c.date, c]));
  const todayCol = dow === 0 ? 6 : dow - 1;
  // 이번 주 앞쪽에서 가입 전인 요일 수 — 지난 요일 수(todayCol+1)가 경과일보다 크면 그 차이만큼
  const preJoinCols = elapsedDays != null ? Math.max(0, todayCol + 1 - elapsedDays) : 0;

  // 오늘 라이브 판정 — today 조회 실패 시 집중은 heatmap 플래그(달성 즉시 반영), 폰은 중립.
  const todayFocus: GoalDotState | null = today
    ? today.focus.goalAchieved
      ? 'on'
      : 'future'
    : null;
  const todayPhone: GoalDotState =
    today &&
    today.screenTime.goalMinutes > 0 &&
    today.screenTime.todayMinutes > today.screenTime.goalMinutes
      ? 'miss'
      : 'future';

  // 목표 미설정(goalMinutes 0) — 플래그가 항상 false라 매일 '미달'로 보인다(PR 리뷰 반영).
  // 해당 지표 줄은 중립 도트 + '목표 미설정' 라벨. today 조회 실패 시엔 설정된 것으로 간주(기존 동작).
  const focusGoalSet = today == null || today.focus.goalMinutes > 0;
  const phoneGoalSet = today == null || today.screenTime.goalMinutes > 0;

  const stateFor = (
    offset: number,
    achieved: (c: HeatmapCellResponse | undefined) => boolean,
    todayState: GoalDotState | null, // null = heatmap 판정 그대로 사용
  ): GoalDotState => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + offset);
    const key = localDateStr(d);
    if (key > todayKey) return 'future'; // 'YYYY-MM-DD' 문자열 비교 = 날짜 비교
    if (offset < preJoinCols) return 'future'; // 가입 전 — 판정 없음
    if (key === todayKey && todayState != null) return todayState;
    return achieved(byDate.get(key)) ? 'on' : 'miss';
  };
  // 집중: 플래그 그대로(기록 없는 날 = 0분 = 미달). 폰: 플래그 또는 0분이면 달성 — 서버 기간
  // 통계의 'row 없는 날 = 0분 = 달성'과 의미 일치(PR 리뷰 반영). heatmap은 빈 날을 false
  // 플래그·0분 셀로 채우므로 플래그만 보면 미동기화 날이 전부 미달로 보인다.
  const focusStates = WEEK_DAYS.map((_, i) =>
    focusGoalSet
      ? stateFor(i, (c) => c?.focusGoalAchieved ?? false, todayFocus)
      : ('future' as GoalDotState),
  );
  const phoneStates = WEEK_DAYS.map((_, i) =>
    phoneGoalSet
      ? stateFor(
          i,
          (c) => c != null && (c.screenTimeGoalAchieved || c.actualScreenTimeMinutes === 0),
          todayPhone,
        )
      : ('future' as GoalDotState),
  );
  return (
    <View style={s.goalWeekWrap}>
      <GoalDotRow label="집중" color={FOCUS_COLOR} states={focusStates} unset={!focusGoalSet} />
      <GoalDotRow label="폰 사용" color={PHONE_COLOR} states={phoneStates} unset={!phoneGoalSet} />
    </View>
  );
}

function GoalDotRow({
  label,
  color,
  states,
  unset,
}: {
  label: string;
  color: string;
  states: GoalDotState[];
  unset?: boolean; // 목표 미설정 — 도트는 전부 중립으로 오고, 카운트 자리에 안내만
}) {
  const count = states.filter((x) => x === 'on').length;
  return (
    <View>
      <View style={s.goalDotHead}>
        <Text style={[s.goalDotLabel, { color }]}>{label}</Text>
        <Text style={[s.goalDotCount, { color: unset ? T.inkMuted : color }]}>
          {unset ? '목표 미설정' : `${count}일 달성`}
        </Text>
      </View>
      <View style={s.goalDotRow}>
        {WEEK_DAYS.map((d, i) => {
          const st = states[i];
          const bg = st === 'on' ? color : st === 'miss' ? T.dangerBg : T.track;
          const fg = st === 'on' ? T.white : st === 'miss' ? T.dangerInk : T.inkFaint;
          return (
            <View key={d} style={[s.goalDot, { backgroundColor: bg }]}>
              <Text style={[s.goalDotDay, { color: fg }]} allowFontScaling={false}>
                {d}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// 월 탭 — 해당 월 달력. 하루에 둘 다 달성=진한 초록, 하나만=연초록, 못함=빈칸, 미래·판정 전·가입 전=회색.
// 오늘·가입 전 처리는 GoalWeekDots와 동일한 이유(PR 리뷰 반영) — 오늘은 라이브 판정(집중 달성만
// 확정 연초록, 폰은 다음날 마감 전이라 미판정), 가입 전 날짜는 elapsedDays 역산으로 중립 처리.
function GoalMonthGrid({
  cells,
  today,
  elapsedDays,
}: {
  cells: HeatmapCellResponse[];
  today: TodayStatsResponse | null;
  elapsedDays: number | null;
}) {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const todayKey = todayStr();
  const byDate = new Map(cells.map((c) => [c.date, c]));
  const dayOf = (date: string) => Number(date.slice(8, 10));
  // 이달 앞쪽에서 가입 전인 날 수 — 오늘 일자가 경과일보다 크면 그 차이만큼
  const preJoinDays = elapsedDays != null ? Math.max(0, now.getDate() - elapsedDays) : 0;
  // 목표 미설정·폰 0분 달성 판정은 GoalWeekDots와 동일한 이유(PR 리뷰 반영).
  const focusGoalSet = today == null || today.focus.goalMinutes > 0;
  const phoneGoalSet = today == null || today.screenTime.goalMinutes > 0;
  const todayFocusOn = focusGoalSet && (today?.focus.goalAchieved ?? false);
  // 폰 과거일 달성 — 플래그 또는 0분(미동기화 날 포함): 서버 'row 없는 날 = 0분 = 달성'과 일치
  const phoneAchieved = (c: HeatmapCellResponse | undefined) =>
    c != null && (c.screenTimeGoalAchieved || c.actualScreenTimeMinutes === 0);

  let focusDays = todayFocusOn ? 1 : 0; // 오늘 몫은 라이브 판정으로만 계상(폰·둘 다는 다음날 확정)
  let phoneDays = 0;
  let bothDays = 0;
  for (const c of cells) {
    if (c.date >= todayKey) continue; // 오늘은 위에서 라이브로, 미래는 제외
    if (dayOf(c.date) <= preJoinDays) continue; // 가입 전 — 판정 없음
    const f = focusGoalSet && c.focusGoalAchieved;
    const p = phoneGoalSet && phoneAchieved(c);
    if (f) focusDays += 1;
    if (p) phoneDays += 1;
    if (f && p) bothDays += 1;
  }
  const days = Array.from({ length: lastDay }, (_, i) =>
    localDateStr(new Date(now.getFullYear(), now.getMonth(), i + 1)),
  );
  const rows: string[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
  const colorFor = (date: string): string => {
    if (date > todayKey) return T.track;
    if (dayOf(date) <= preJoinDays) return T.track; // 가입 전 — 판정 없음
    if (date === todayKey) return todayFocusOn ? GRASS[2] : T.track; // 오늘 — 집중 달성만 확정
    const c = byDate.get(date);
    const n =
      (focusGoalSet && c?.focusGoalAchieved ? 1 : 0) + (phoneGoalSet && phoneAchieved(c) ? 1 : 0);
    return n === 2 ? GRASS[4] : n === 1 ? GRASS[2] : GRASS[0];
  };
  return (
    <View>
      <View style={s.goalMonthHead}>
        <Text style={[s.goalMonthStat, { color: FOCUS_COLOR }]}>
          집중 {focusGoalSet ? `${focusDays}일` : '미설정'}
        </Text>
        <Text style={[s.goalMonthStat, { color: PHONE_COLOR }]}>
          폰 사용 {phoneGoalSet ? `${phoneDays}일` : '미설정'}
        </Text>
        {/* 한쪽이라도 미설정이면 '둘 다'는 성립 불가 — 숨김 */}
        {focusGoalSet && phoneGoalSet && (
          <Text style={[s.goalMonthStat, { color: T.successInk }]}>둘 다 {bothDays}일</Text>
        )}
      </View>
      <View style={s.monthGrass}>
        {rows.map((row, ri) => (
          <View key={ri} style={s.monthGrassRow}>
            {row.map((date) => (
              <View key={date} style={[s.monthGrassCell, { backgroundColor: colorFor(date) }]} />
            ))}
          </View>
        ))}
      </View>
      <View style={s.goalLegend}>
        <GoalLegendDot color={GRASS[4]} label="둘 다" />
        <GoalLegendDot color={GRASS[2]} label="하나" />
        <GoalLegendDot color={GRASS[0]} label="못함" />
      </View>
    </View>
  );
}

function GoalLegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={s.goalLegendItem}>
      <View style={[s.goalLegendSwatch, { backgroundColor: color }]} />
      <Text style={s.goalLegendText}>{label}</Text>
    </View>
  );
}

// ST9(주) 공부 잔디 한 줄 — 월~일 7칸 정사각형 고정, 공부량이 많을수록 진해진다(GROMO-761).
// 아직 안 온 요일은 빈 칸(레벨 0)으로 자리만 유지.
const WEEK_DAYS = ['월', '화', '수', '목', '금', '토', '일'];

function WeekGrassRow({ cells }: { cells: HeatmapCellResponse[] }) {
  const minutesByDay = [0, 0, 0, 0, 0, 0, 0];
  for (const c of cells) {
    const [y, m, d] = c.date.split('-').map(Number);
    const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0=월..6=일
    minutesByDay[dow] = c.totalFocusMinutes;
  }
  return (
    <View style={s.weekGrassRow}>
      {WEEK_DAYS.map((d, i) => (
        <View key={d} style={s.weekGrassCol}>
          <View
            style={[s.weekGrassCell, { backgroundColor: GRASS[grassLevel(minutesByDay[i])] }]}
          />
          <Text style={s.weekGrassLabel} allowFontScaling={false}>
            {d}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ST9(월) 공부 잔디 — 해당 월 전체 날짜(말일까지)를 한 줄 7칸씩 정사각형으로 미리 그림(GROMO-761).
// 아직 안 온 날짜는 빈 칸(레벨 0)으로 자리만 유지.
function MonthGrassGrid({ cells }: { cells: HeatmapCellResponse[] }) {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const minutesByDate = new Map(cells.map((c) => [c.date, c.totalFocusMinutes]));
  const days = Array.from({ length: lastDay }, (_, i) =>
    localDateStr(new Date(now.getFullYear(), now.getMonth(), i + 1)),
  );
  const rows: string[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
  return (
    <View style={s.monthGrass}>
      {rows.map((row, ri) => (
        <View key={ri} style={s.monthGrassRow}>
          {row.map((date) => (
            <View
              key={date}
              style={[
                s.monthGrassCell,
                { backgroundColor: GRASS[grassLevel(minutesByDate.get(date) ?? 0)] },
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.space.md,
    paddingTop: T.space.xs,
    paddingBottom: T.space.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...T.text.subtitle, color: T.ink },

  // 고정 필터
  filters: { paddingHorizontal: T.space.xl, paddingBottom: T.space.md, gap: T.space.md },
  segment: {
    flexDirection: 'row',
    backgroundColor: T.sandLight,
    borderRadius: 12,
    padding: 3,
  },
  segBtn: { flex: 1, paddingVertical: T.space.sm, borderRadius: 9, alignItems: 'center' },
  segBtnOn: {
    backgroundColor: T.white,
    shadowColor: T.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segText: { ...T.text.label, color: T.inkMuted },
  segTextOn: { color: T.ink },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // 카드 공통
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 18,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.lg,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: T.space.md,
  },
  cardTitle: { ...T.text.heading, color: T.ink },
  cardCaption: { ...T.text.caption, color: T.inkMuted },
  // 공유하기 — 타임테이블 카드 하단 오른쪽(헤더에 두면 순서 편집 핸들과 겹침)
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.xs,
    alignSelf: 'flex-end',
    marginTop: T.space.md,
  },
  shareBtnText: { ...T.text.caption, color: T.inkMuted },
  bigStat: { ...T.text.title, color: T.ink },
  emptyText: { ...T.text.body, color: T.inkMuted, paddingVertical: T.space.sm },

  // ST1 비교
  compare: { marginTop: T.space.lg, gap: T.space.sm },
  compareLoading: { paddingVertical: T.space.xl, alignItems: 'center' },
  // 나 vs 평균 바(CompareBars) + 합격자 티저 공용 스타일
  teaserPad: { paddingVertical: T.space.xs },
  teaserRowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: T.space.xs,
  },
  teaserRowGap: { marginTop: T.space.md },
  teaserLabelMine: { ...T.text.caption, fontWeight: '700', color: T.ink },
  teaserValueMine: { ...T.text.caption, fontWeight: '800', color: T.accent },
  teaserLabel: { ...T.text.caption, fontWeight: '600', color: T.inkSub },
  teaserValue: { ...T.text.caption, fontWeight: '700', color: T.inkSub },
  teaserTrack: { height: 10, borderRadius: 5, backgroundColor: T.sandLight, overflow: 'hidden' },
  teaserFill: { height: 10, borderRadius: 5 },
  teaserFillMine: { width: '86%', backgroundColor: T.accent },
  teaserFillAvg: { width: '62%', backgroundColor: T.compare.avg },
  teaserDotPasser: { backgroundColor: T.compare.theirs },
  // 합격자 레이더 티저 — 라벨은 꼭짓점 바깥 절대 배치
  radarWrap: { alignItems: 'center', paddingVertical: T.space.xs },
  radarCanvas: { width: RADAR_SIZE, height: RADAR_SIZE },
  radarLabel: {
    ...T.text.caption,
    position: 'absolute',
    width: 80,
    textAlign: 'center',
    fontSize: 10,
    color: T.inkSub,
  },
  teaserLegend: { flexDirection: 'row', gap: T.space.lg, marginTop: T.space.md },
  teaserLegendItem: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  teaserDot: { width: 9, height: 9, borderRadius: 2 },
  teaserLegendText: { ...T.text.caption, fontSize: 11, color: T.inkSub },

  compareChips: { flexDirection: 'row', gap: T.space.sm },
  compareChip: {
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.sm,
    borderRadius: 999,
    backgroundColor: T.sandLight,
  },
  compareChipText: { ...T.text.caption, color: T.inkMuted },
  compareChipOn: { backgroundColor: T.accent },
  compareChipTextOn: { color: T.white, fontWeight: '700' },
  compareNote: { ...T.text.caption, color: T.inkFaint },

  // 준비중 스텁 카드
  stubCard: { gap: T.space.sm },
  stubBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.xs,
    borderRadius: 999,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
  },
  stubBadgeText: { ...T.text.caption, color: T.accentDeep },
  stubNote: { ...T.text.body, color: T.inkMuted },

  // 막대 차트
  chartPlotRow: { flexDirection: 'row', marginTop: T.space.lg },
  // 과목별 도넛 — 링 + 가운데 총합 + 우측 범례
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.lg, marginTop: T.space.sm },
  donutWrap: {
    width: DONUT_SIZE,
    height: DONUT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutCenter: { position: 'absolute', alignItems: 'center' },
  donutCenterValue: { ...T.text.label, fontWeight: '800', color: T.ink },
  donutCenterLabel: { ...T.text.caption, fontSize: 10, color: T.inkSub, marginTop: 2 },
  donutLegend: { flex: 1, gap: T.space.sm },
  donutLegendRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  donutLegendDot: { width: 10, height: 10, borderRadius: 3 },
  donutLegendName: { ...T.text.caption, color: T.ink, flex: 1 },
  donutLegendTime: { ...T.text.caption, color: T.inkSub, fontVariant: ['tabular-nums'] },
  donutLegendPct: { ...T.text.caption, fontWeight: '700', color: T.inkSub },
  // 선그래프 — 확장 캔버스를 음수 마진으로 되돌려 레이아웃(격자 정렬)은 그대로 유지
  lineSvg: {
    marginTop: -DOT_PAD,
    marginBottom: -DOT_PAD,
    marginLeft: -DOT_PAD,
    marginRight: -DOT_PAD,
  },
  // 선그래프 라벨 — 점 x좌표(칼럼 중앙)와 정렬되도록 균등 분할
  lineLabelRow: { flexDirection: 'row', marginTop: T.space.sm },
  lineLabel: { ...T.text.caption, fontSize: 10, color: T.inkMuted, flex: 1, textAlign: 'center' },
  lineLabelCur: { fontWeight: '800' },
  chartAxisCol: { width: 36, height: CHART_H },
  chartAxisLabel: {
    ...T.text.caption,
    position: 'absolute',
    right: 6,
    fontSize: 9,
    color: T.inkMuted,
  },
  chartAxisTop: { top: -5 },
  chartAxisUpper: { top: CHART_H / 3 - 5 },
  chartAxisLower: { top: (CHART_H * 2) / 3 - 5 },
  chartAxisBottom: { top: CHART_H - 5 }, // 시각 축(첫 시작 시각) 전용 — 바닥이 0이 아니라 라벨 필요
  chartPlot: { flex: 1 },
  chartGridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: T.paperAlt,
  },
  chartGridTop: { top: 0 },
  chartGridUpper: { top: CHART_H / 3 },
  chartGridLower: { top: (CHART_H * 2) / 3 },
  chartGridBottom: { top: CHART_H },
  // 시간대별 타임테이블 — 왼쪽 과목 범례(형광펜 하이라이트) + 격자(한 줄 1시간 = 10분×6칸)
  // 캡처 이미지 배경(투명 PNG 방지) + 좌우 여백 — 음수 마진으로 상쇄해 화면 레이아웃은 그대로,
  // 저장되는 이미지에만 여백이 생긴다(LineChart의 DOT_PAD 확장과 같은 기법)
  ttShot: { backgroundColor: T.white, paddingHorizontal: T.space.lg, marginHorizontal: -16 },
  ttLayout: { flexDirection: 'row', gap: T.space.md, marginTop: T.space.lg },
  ttLegendCol: { width: 76, gap: T.space.sm, paddingTop: 2, alignItems: 'flex-start' },
  // 범례 — 글자 배경칠 대신 왼쪽 원형 점으로 과목 색 표시
  ttLegendRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs, maxWidth: '100%' },
  ttLegendDot: { width: 8, height: 8, borderRadius: 4 },
  ttLegendText: { ...T.text.caption, fontSize: 11, color: T.ink, flexShrink: 1 },
  ttGrid: { flex: 1, gap: 3 },
  ttRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ttHourLabel: { ...T.text.caption, fontSize: 9, color: T.inkMuted, width: 18, textAlign: 'right' },
  ttCell: {
    flex: 1,
    height: 14,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: T.paperAlt,
    backgroundColor: T.white,
    overflow: 'hidden',
  },
  ttCellFill: { position: 'absolute', top: 0, bottom: 0, backgroundColor: FOCUS_COLOR },

  // 주 탭 요일별 집중 타임라인(GROMO-778)
  // 헤더·바디는 gap 없이 거터+균등분할 — 라벨 중심과 플롯 칼럼(plotW/7) x좌표가 일치해야 한다
  wttHeadRow: { flexDirection: 'row', marginTop: T.space.sm, marginBottom: T.space.xs },
  wttBodyRow: { flexDirection: 'row' },
  wttGutter: { width: 18, position: 'relative' }, // 시간축 눈금 칼럼
  wttTick: {
    position: 'absolute',
    right: 3,
    ...T.text.caption,
    fontSize: 9,
    color: T.inkMuted,
  },
  wttDayLabel: {
    flex: 1,
    textAlign: 'center',
    ...T.text.caption,
    fontSize: 12,
    fontWeight: '800',
    color: T.ink,
  },
  wttSat: { color: T.blue },
  wttSun: { color: T.accentAlt },
  wttTodayLabel: { color: T.accent },
  wttPlot: { flex: 1, position: 'relative' },
  wttBlock: { position: 'absolute' }, // 과목색 세션 블록 — 각진 모서리(라운드 금지)
  wttLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: T.space.sm,
    marginTop: T.space.md,
  },
  wttLegendItem: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  wttLegendDot: { width: 8, height: 8, borderRadius: 4 },
  wttLegendText: { ...T.text.caption, fontSize: 11, color: T.ink },

  // 전 대비
  deltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: T.space.sm,
  },
  deltaLabel: { ...T.text.label, color: T.inkSub },
  deltaValueWrap: { flexDirection: 'row', alignItems: 'baseline', gap: T.space.sm },
  deltaArrow: { ...T.text.label },
  deltaPct: { ...T.text.subtitle },
  deltaMin: { ...T.text.caption, color: T.inkMuted },

  // 목표 달성 — 일 스탬프
  stampRow: { flexDirection: 'row', gap: T.space.md },
  stamp: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: T.border,
    paddingVertical: T.space.lg,
    paddingHorizontal: T.space.sm,
  },
  stampOn: { borderColor: T.successBorder, backgroundColor: T.successBg },
  stampFail: { borderColor: T.dangerBorder, backgroundColor: T.dangerBg },
  stampProgress: { borderColor: T.noteBorder, backgroundColor: T.noteBg },
  stampIc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: T.space.sm,
  },
  stampTitle: { ...T.text.label, fontWeight: '800', textAlign: 'center' },
  stampSub: { ...T.text.caption, color: T.inkSub, textAlign: 'center', marginTop: 2 },

  // 목표 달성 — 주 도트(집중·폰 사용 각 7칸)
  goalWeekWrap: { gap: T.space.lg },
  goalDotHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: T.space.sm,
  },
  goalDotLabel: { ...T.text.label, fontWeight: '800' },
  goalDotCount: { ...T.text.label, fontWeight: '800' },
  goalDotRow: { flexDirection: 'row', gap: T.space.sm },
  goalDot: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalDotDay: { ...T.text.caption, fontSize: 10, fontWeight: '800' },

  // 목표 달성 — 월 달력
  goalMonthHead: { flexDirection: 'row', gap: T.space.lg, marginBottom: T.space.md },
  goalMonthStat: { ...T.text.label, fontWeight: '800' },
  goalLegend: { flexDirection: 'row', gap: T.space.lg, marginTop: T.space.md, alignSelf: 'center' },
  goalLegendItem: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  goalLegendSwatch: { width: 12, height: 12, borderRadius: 4 },
  goalLegendText: { ...T.text.caption, color: T.inkSub },

  // 스트릭 + 잔디
  streakRow: { flexDirection: 'row', alignItems: 'center', marginBottom: T.space.lg },
  streakItem: { flex: 1, alignItems: 'center', gap: 2 },
  streakDivider: { width: 1, height: 28, backgroundColor: T.divider },
  streakValue: { ...T.text.stat, color: T.ink },
  streakLabel: { ...T.text.caption, color: T.inkMuted },
  // 월 탭 잔디 — 해당 월 전체 날짜, 한 줄 7칸(작은 정사각형), 블록 가운데 정렬
  monthGrass: { gap: T.space.sm, marginTop: T.space.xs, alignSelf: 'center' },
  monthGrassRow: { flexDirection: 'row', gap: T.space.sm },
  monthGrassCell: { width: 24, height: 24, borderRadius: 6 },
  // 주 탭 잔디 한 줄 — 월 탭과 같은 24px 정사각형 + 요일 라벨, 블록 가운데 정렬
  weekGrassRow: {
    flexDirection: 'row',
    gap: T.space.sm,
    marginTop: T.space.xs,
    alignSelf: 'center',
  },
  weekGrassCol: { alignItems: 'center', gap: T.space.xs },
  weekGrassCell: { width: 24, height: 24, borderRadius: 6 },
  weekGrassLabel: { ...T.text.caption, fontSize: 10, color: T.inkMuted },
  grassHint: { ...T.text.caption, color: T.inkMuted, marginTop: T.space.md },
});
