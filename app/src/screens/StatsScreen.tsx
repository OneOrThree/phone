import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  type ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { T } from '@/constants/theme';
import type { StatsPeriod } from '@/types/dto/stats';
import {
  logStatsViewed,
  logStatsPeriodChanged,
  logStatsCardReordered,
} from '@/services/analyticsEvents';
import { useStatsData } from './stats/useStatsData';
import { ComingSoon } from './stats/ComingSoon';
import { CardOrderEditor } from './stats/CardOrderEditor';
import { SubjectProgressList } from '@/components/SubjectProgressList';
import { STORAGE_KEYS } from '@/types/storage';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
import { useFocus } from '@/store/FocusContext';
import { useSubjects } from '@/store/SubjectContext';
import { fmtMinutes, hms } from '@/utils/timeFormat';
import { PERIOD_TABS, periodKey, heatmapBars, mergeCardOrder } from './stats/format';
import { SectionCard } from './stats/SectionCard';
import { CompareWeek, ComparePeriod } from './stats/Compare';
import { PasserCompareChart } from './stats/PasserCompareChart';
import { LineChart, FirstStartChart } from './stats/charts';
import { MonthWeeklyChart, pickFocus, pickScreenTime } from './stats/MonthWeeklyChart';
import { FocusTimetableCard } from './stats/FocusTimetableCard';
import { WeeklyTimetableCard } from './stats/WeeklyTimetableCard';
import { LongestSessionStat } from './stats/LongestSessionStat';
import { CategoryDonut } from './stats/CategoryDonut';
import { DeltaRow } from './stats/DeltaRow';
import { GoalDayStamps } from './stats/GoalCards';
import { CalendarCard } from './stats/CalendarCard';
import { FOCUS_COLOR, PHONE_COLOR } from './stats/constants';
import { cs } from './stats/cardStyles';

// v2 내 통계 화면(GROMO-604) — 홈 '오늘' 카드의 '자세히'에서 진입.
// 상단 고정 필터(기간 일/주/월) 아래로 ST1~ST8 지표 스크롤.
// 실데이터: 집중시간·폰사용·전대비·캘린더(목표달성+잔디 통합, GROMO-974)·총공부량(나)·과목별(나)·비교(친구/전체/같은 카테고리).
// 준비 중: 합격자 — 소스 미비로 스텁.
// 이 파일은 화면 조립(카드 목록·순서·투어·헤더)만 담당 — 카드 컴포넌트는 stats/ 하위 파일로 분리(GROMO-923).

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

  // 현재 표시 중인 카드 순서 — onReorderCards는 CardOrderEditor의 PanResponder 캐시에 잡혀
  // 스테일 클로저가 될 수 있어, 비교 기준은 ref로 최신값을 읽는다(PR 276 리뷰 반영).
  const displayedKeysRef = useRef<string[]>([]);

  const onReorderCards = (keys: string[]) => {
    // 표시 중인 순서와 달라진 드롭만 계측 — 제자리 드롭에도 onReorder는 불린다(PR 276 리뷰 반영)
    if (displayedKeysRef.current.join() !== keys.join()) {
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
      <View key="total" testID="stats.card.total" ref={totalCardRef} collapsable={false}>
        <SectionCard
          title={
            period === 'DAY'
              ? '오늘 총 집중시간'
              : period === 'WEEK'
                ? '이번 주 총 집중시간'
                : `${month}월 총 집중시간`
          }
        >
          <Text style={cs.bigStat}>
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

  // ST8 목표 달성 — 일=오늘 2목표 스탬프 유지. 주/월은 캘린더로 전환(GROMO-974) — 목표 달성
  // 색 채우기(도트·그리드)와 공부 잔디를 캘린더 하나로 통합(셀 배경=집중 강도, 체크=달성 목표 수).
  // 카드 키는 'goalAchieve' 유지 — 유저가 저장한 카드 순서를 깨지 않기 위함(GROMO-762).
  // 기본 위치: 모든 탭에서 총 집중시간 바로 아래.
  cards.push({
    key: 'goalAchieve',
    node: (
      <View key="goalAchieve" ref={goalCardRef} collapsable={false}>
        <SectionCard
          title={
            period === 'DAY' ? '오늘 목표 달성' : period === 'WEEK' ? '주간 캘린더' : '월간 캘린더'
          }
        >
          {period === 'DAY' ? (
            <GoalDayStamps today={data.today} />
          ) : (
            <CalendarCard
              period={period}
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
          {/* 주 탭(요일별)과 동일한 총계 히어로 — 탭 간 표기 일관(GROMO-849).
              집계 조회 실패(null)면 숨김 — 0으로 그리면 차트와 모순(코덱스 리뷰 반영) */}
          {data.focus != null && (
            <Text style={cs.bigStat}>총 {fmtMinutes(data.focus.totalFocusMinutes)}</Text>
          )}
          <MonthWeeklyChart pick={pickFocus} color={FOCUS_COLOR} />
        </SectionCard>
      ),
    });
    cards.push({
      key: 'monthWeeklyPhone',
      node: (
        <SectionCard
          key="monthWeeklyPhone"
          title={`${month}월 주별 핸드폰 사용량`}
          subtitle="집중시간과 대비돼요. 줄어들면 함께 줄어요."
        >
          {data.screenTime != null && (
            <Text style={[cs.bigStat, { color: PHONE_COLOR }]}>
              총 {fmtMinutes(data.screenTime.currentMinutes)}
            </Text>
          )}
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
          {/* 집계 조회 실패(null)면 히어로 숨김 — 월 탭과 동일(코덱스 리뷰 반영) */}
          {data.focus != null && (
            <Text style={cs.bigStat}>총 {fmtMinutes(data.focus.totalFocusMinutes)}</Text>
          )}
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
        <SectionCard
          key="weekdayPhone"
          title="요일별 핸드폰 사용량"
          subtitle="집중시간과 대비돼요. 줄어들면 함께 줄어요."
        >
          {data.screenTime != null && (
            <Text style={[cs.bigStat, { color: PHONE_COLOR }]}>
              총 {fmtMinutes(data.screenTime.currentMinutes)}
            </Text>
          )}
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

  // (구 ST9 공부 잔디 카드는 GROMO-974에서 주/월 캘린더에 통합·삭제 — 'grass' 저장 키는
  //  mergeCardOrder가 걸러낸다)

  // 저장된 순서 적용 — 저장이 없거나 이후 새 카드가 생겼으면 기본 순서에 병합
  const orderedKeys = mergeCardOrder(
    cards.map((c) => c.key),
    cardOrder[period],
  );
  displayedKeysRef.current = orderedKeys;
  const byKey = new Map(cards.map((c) => [c.key, c]));
  const orderedCards = orderedKeys.flatMap((k) => byKey.get(k) ?? []);

  return (
    <SafeAreaView testID="stats.screen" style={s.root} edges={['top']}>
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
                testID={`stats.tab.${t.key.toLowerCase()}`}
                // 선택 상태를 접근성 트리에 노출 — E2E가 실제 탭 전환을 단언하는 근거(GROMO-947)
                accessibilityState={{ selected: on }}
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

const s = StyleSheet.create({
  // 페이지 배경은 쿨 뉴트럴(T.bg) — 흰 카드가 배경과 구분되게(시안의 배경↔카드 대비, GROMO-849).
  // 알림·친구 화면과 같은 페이지 배경 토큰.
  root: { flex: 1, backgroundColor: T.bg },

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
});
