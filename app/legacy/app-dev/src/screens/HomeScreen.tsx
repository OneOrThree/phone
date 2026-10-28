import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Image,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { useNavigation, useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { ProgressBar } from '@/components/ProgressBar';
import { M, enterUp, staggerDelay } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import { tierByLevel } from '@/constants/tiers';
import { focusGoalReward, screenTimeGoalReward } from '@/utils/currencyRewards';
import { useLeagueRanking } from '@/screens/league/useLeagueRanking';
import { useLeagueMeta } from '@/screens/league/useLeagueMeta';
import type { V2RootStackParamList } from '@/navigation/types';
import { useUser } from '@/store/UserContext';
import { useFocus } from '@/store/FocusContext';
import { useCharacter } from '@/store/CharacterContext';
import { useCoins, useRefreshCoinsOnFocus } from '@/store/CoinContext';
import ScreenTimeReportView from '@/components/ScreenTimeReportView';
import ScreenTimeModule, {
  androidNativeModuleAvailable,
  type AuthorizationStatus,
} from '@/services/ScreenTimeModule';
import { supportsUsageBreakdown } from '@/services/screenTimeCapabilities';
import { updateScreenTimePermission } from '@/services/userApi';
import { AnimatedCharacter } from '@/components/character/AnimatedCharacter';
import { CharacterImage } from '@/components/character/CharacterImage';
import { GoalCelebrationModal } from '@/components/GoalCelebrationModal';
import { ScreenTimeCelebrationModal } from '@/components/ScreenTimeCelebrationModal';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
import { CurrencyIcon } from '@/components/CurrencyIcon';
import { PressableScale } from '@/components/PressableScale';
import { fabWindowRect } from '@/components/TabBar';
import { tabBarSafeBottom } from '@/components/tabBarLayout';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { kstLocalSameDay, todayStr } from '@/utils/localDate';
import { playTapSound } from '@/utils/sound';
import { getTodayStats, getStreak } from '@/services/statsApi';
import { hasUnread, subscribeInbox } from '@/services/notificationInbox';
import {
  celebrationDayKey,
  readPendingCelebration,
  clearPendingCelebration,
  subscribeCelebration,
} from '@/services/goalCelebration';
import {
  readPendingScreenTimeCelebration,
  clearScreenTimeCelebration,
  subscribeScreenTimeCelebration,
} from '@/services/screentimeCelebration';
import type { TodayStatsResponse } from '@/types/dto/stats';
import {
  logHomeViewed,
  logTodaySummaryViewed,
  logHomeButtonTapped,
  logHomeRefreshed,
  logCurrencyRewardShown,
  logCurrencyChipTapped,
} from '@/services/analyticsEvents';

// v2 홈 화면 (GROMO-552) — Claude Design "01 홈" 시안 기반.
// 상단바(닉/순위/티어) + 방+캐릭터 + 오늘 요약 카드. 탭바/FAB는 RootNavigator.
// 데이터 층은 @/store 훅 재사용 — 순위·티어(리그 API)·집중시간(통계)·핸드폰사용(네이티브
// 리포트)·통계 이동까지 실연동 완료.

// 오늘 카드 진행바(GROMO-1381) — 기존 s.track/s.fill의 치수를 그대로 승계한다.
// 값이 달라지면 카드 레이아웃이 미세하게 바뀐다.
const BAR_H = 6;
const BAR_RADIUS = 3;
// 오늘 카드는 진입 stagger의 마지막 칸이다(상단바 0 · 방 1 · 오늘 카드 2).
const CARD_ENTER_INDEX = 2;
// 마지막 칸의 진입이 **끝나는** 시각 = 시차 + 재생 시간. 진입 stagger 총 재생 시간이자,
// 진행바가 차기 시작해야 하는 시점이다.
const ENTER_TOTAL_MS = staggerDelay(CARD_ENTER_INDEX) + M.dur.base;
// 진행바는 카드가 **자리를 잡은 뒤** 찬다(설계 §6). 카드 진입과 같은 시차(120)를 주면 둘이
// 거의 동시에 재생돼 순서가 성립하지 않는다 — 진입 완료 시각에 맞춘다.
const BAR_DELAY = ENTER_TOTAL_MS;

// 캐릭터 크기 — 짧은 세로 화면(iPhone SE 667 등)에선 줄인다(GROMO-1487).
// 216 그대로면 캐릭터 + '캐릭터 변경'(약 46)이 남는 높이를 넘어 버튼이 접히는 선 아래로 내려간다.
// 기준 700은 "SE(667)는 줄이고 그 위(8 Plus 736 이상)는 손대지 않는다" 선이다.
const CHAR_SIZE = 216;
const CHAR_SIZE_SHORT = 176;
const SHORT_SCREEN_H = 700;

// 초 → "N시간 M분" (목표 표시용)
function hm(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h && m) return t('home.duration.hourMinute', { h, m });
  if (h) return t('home.duration.hour', { h });
  return t('home.duration.minute', { m });
}

// 초 → "HH:MM:SS" (집중시간 값 표시용)
function hms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// 오늘 카드 한 줄: 아이콘 + 라벨 + 큰 값 + 목표 진행 바.
// 목표 대비 진행률만큼 바를 채운다. 목표 초과 시 overColor로 경고 표시.
function MetricRow({
  icon,
  iconColor,
  iconBg,
  label,
  value,
  goal,
  overColor,
  divider,
  barTestID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  label: string;
  value: number;
  goal: number;
  overColor?: string;
  divider?: boolean;
  /** 진행바 셀렉터 — 테스트·E2E가 목표 대비 진행률을 읽는 자리. */
  barTestID?: string;
}) {
  // 클램프는 ProgressBar가 한다(0~1 밖은 잘라 낸다) — 여기서 또 자르면 같은 규칙이 두 곳에
  // 생긴다. 목표 초과 색은 클램프 전 원값으로 판정하므로 영향 없다.
  const pct = goal > 0 ? value / goal : 0;
  const fillColor = overColor && value > goal ? overColor : iconColor;
  return (
    <View style={[s.metricRow, divider ? s.metricDivider : null]}>
      <View style={[s.metricIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={17} color={iconColor} />
      </View>
      <View style={s.flex1}>
        {/* allowFontScaling=false: 네이티브 리포트 뷰(고정 크기)와 글씨 크기를 맞춤 */}
        <Text style={s.metricLabel} allowFontScaling={false}>
          {label}
        </Text>
        {/* 값 줄 — 왼쪽 큰 값 + 오른쪽 목표(바 옆이 아니라 값 줄로 올림) */}
        <View style={s.valueRow}>
          <Text style={s.metricValue} allowFontScaling={false}>
            {hms(value)}
          </Text>
          <Text style={s.goalText} allowFontScaling={false} numberOfLines={1}>
            {t('home.today.goal', { duration: hm(goal) })}
          </Text>
        </View>
        {/* 진행 바 — 카드 끝까지 전체 폭 (두 행 모두 전체 폭이라 바 길이도 자연히 동일).
            바 위 여백은 valueRow의 marginBottom이 담당한다(ProgressBar는 style prop이 없고,
            여백만을 위해 래퍼 뷰를 끼우면 E2E testID 트리가 바뀐다). */}
        <ProgressBar
          testID={barTestID}
          progress={pct}
          color={fillColor}
          trackColor={T.caramel}
          height={BAR_H}
          radius={BAR_RADIUS}
          delay={BAR_DELAY}
        />
      </View>
    </View>
  );
}

// 핸드폰 사용 행 — 값+진행 바를 iOS는 네이티브 Home Usage 리포트 뷰가 그린다.
// (실사용시간은 원인 3으로 JS에 못 넘어와, 익스텐션 뷰를 임베드해야만 자정~현재 정확값 표시)
// goalSeconds prop → App Group에 기록 → 익스텐션이 목표 대비 바를 그림.
// 안드로이드(GROMO-994)는 조회값이 JS로 그대로 넘어오므로 usageMinutes로 직접 그린다.
// 그 외(네이티브 뷰·모듈 없음) → placeholder.
// 권한 미허용(notDetermined/denied) 시 리포트가 데이터 없이 '00'으로 그려져 거짓 0분처럼
// 보이므로 숫자+바 대신 권한 켜기 안내로 교체한다(GROMO-986). 분기 기준은 권한 상태 —
// approved 유저의 실제 0분은 정상 00:00 유지. null(조회 전)은 리포트 유지(허용 유저 깜빡임 방지).
function PhoneUsageRow({
  goalSeconds,
  refresh,
  authStatus,
  usageMinutes,
  onPress,
  onEnablePermission,
}: {
  goalSeconds: number;
  refresh: number;
  authStatus: AuthorizationStatus | null;
  usageMinutes: number | null; // 안드로이드 조회값(분) — iOS는 네이티브 뷰가 그려서 미사용
  onPress: () => void;
  onEnablePermission: () => void;
}) {
  // 표시 수단이 있는 플랫폼(iOS 네이티브 뷰·안드로이드 모듈)만 권한 분기 — 그 외는 래퍼가
  // 항상 'denied'를 반환하므로 제외해 기존 placeholder('–')와 행 탭 동작을 유지한다.
  // 구 안드로이드 바이너리(OTA로 새 JS만·모듈 없음)는 CTA를 눌러도 설정을 못 열므로
  // 모듈 가용일 때만 M1 UI를 그린다(코드리뷰 반영).
  const needsPermission =
    (ScreenTimeReportView != null ||
      (Platform.OS === 'android' && androidNativeModuleAvailable())) &&
    (authStatus === 'notDetermined' || authStatus === 'denied');
  // 안드로이드 목표 대비 진행률 — iOS는 네이티브 뷰가 계산해 그린다.
  // 클램프는 ProgressBar가 한다 — MetricRow의 pct와 같은 규칙(중복 클램프 제거).
  const androidPct =
    goalSeconds > 0 && usageMinutes != null ? (usageMinutes * 60) / goalSeconds : 0;
  return (
    <View style={s.metricRow}>
      <View style={[s.metricIcon, { backgroundColor: T.accentBg }]}>
        <Ionicons name="phone-portrait-outline" size={17} color={T.accent} />
      </View>
      <View style={s.flex1}>
        <View style={s.usageLabelRow}>
          <Text style={s.metricLabel} allowFontScaling={false}>
            {t('home.today.phoneUsage')}
          </Text>
          {/* 상세(앱별 사용 시간)가 없는 플랫폼에선 화살표를 뺀다 — 총 사용시간은 이 카드에
              멀쩡히 뜨는데 화살표만 따라가면 '볼 수 없어요' 빈 화면이 나온다(GROMO-1592). */}
          {supportsUsageBreakdown() ? (
            <Ionicons name="chevron-forward" size={12} color={T.inkMuted} />
          ) : null}
        </View>
        {needsPermission ? (
          // 권한 미허용 — 안내 문구 + 권한 켜기 CTA. 탭은 아래 행 전체 오버레이가 받는다.
          <View style={s.permissionWrap}>
            <Text style={s.permissionText} allowFontScaling={false}>
              {t('home.today.permissionNotice')}
            </Text>
            <View style={s.permissionBtn}>
              <Text style={s.permissionBtnText} allowFontScaling={false}>
                {t('home.today.enablePermission')}
              </Text>
            </View>
          </View>
        ) : ScreenTimeReportView ? (
          // key에 goalSeconds+refresh → 목표 변경/홈 포커스 시 리마운트되어 최신값으로 재계산됨
          // (DeviceActivityReport는 prop 변경만으로는 재계산 안 하고, 실시간 갱신도 아니라서)
          <ScreenTimeReportView
            key={`goal-${goalSeconds}-r${refresh}`}
            reportContext="Home Usage"
            goalSeconds={goalSeconds}
            style={s.usageReport}
          />
        ) : Platform.OS === 'android' && androidNativeModuleAvailable() ? (
          // 안드로이드 — 조회값(분)으로 값+목표 진행 바를 직접 그린다(GROMO-994).
          <>
            <View style={s.valueRow}>
              <Text style={s.metricValue} allowFontScaling={false}>
                {usageMinutes == null ? '–' : hm(usageMinutes * 60)}
              </Text>
              <Text style={s.goalText} allowFontScaling={false} numberOfLines={1}>
                {t('home.today.goal', { duration: hm(goalSeconds) })}
              </Text>
            </View>
            <ProgressBar
              testID="home.metric.phone.bar"
              progress={androidPct}
              color={T.accent}
              trackColor={T.caramel}
              height={BAR_H}
              radius={BAR_RADIUS}
              delay={BAR_DELAY}
            />
          </>
        ) : (
          <Text style={s.metricValue}>–</Text>
        )}
      </View>
      {/* 투명 터치 레이어 — 네이티브 뷰 위에서도 탭 감지 → 앱별 상세 오버레이.
          권한 미허용 시엔 행 전체가 권한 요청 탭 타깃이 된다.
          행 계열 규칙대로 스케일 없이 사운드만: transform을 걸면 네이티브 리포트 뷰가
          같이 찌그러지지만, 그건 스케일만 빼야 할 이유지 소리까지 뺄 이유는 아니다. */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={0.6}
        // 권한 요청도 상세 이동도 할 게 없으면 탭 타깃 자체를 끈다 — 누르면 소리가 나고
        // 눌린 티는 나는데 아무 일도 안 일어나는 게 제일 고장처럼 보인다(GROMO-1592).
        disabled={!needsPermission && !supportsUsageBreakdown()}
        onPressIn={playTapSound}
        onPress={needsPermission ? onEnablePermission : onPress}
        accessibilityLabel={
          needsPermission ? t('home.today.enablePermissionA11y') : t('home.today.usageDetailA11y')
        }
      />
    </View>
  );
}

export default function HomeScreen() {
  // 목표는 온보딩값(집중=goalSeconds, 사용시간=screenTimeGoalSeconds).
  const { nickname, userId, goalSeconds, screenTimeGoalSeconds } = useUser();
  // 오늘 공부 집중 = 실제 세션 누적(FocusContext). 집중 세션 정지 시 반영됨.
  const { todayFocusSeconds } = useFocus();
  // 장착 캐릭터 — custom 선택 + 누끼 있으면 그 URI, 아니면 null(기본 정적 에셋).
  const { activeSource } = useCharacter();
  // 시간조각(재화) 잔액 — 오늘 카드 헤더 칩. 홈 포커스 시 서버 잔액 재조회(내기 차감·정산 반영).
  const { coins } = useCoins();
  useRefreshCoinsOnFocus();
  // 캐릭터 호흡 on/off — 훅은 최상위에서 부르고 값만 넘긴다(홈은 탭 네비게이터 안이라 사용 가능)
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  // 홈이 포커스될 때마다 사용량 리포트를 리마운트 → 최신값으로 재계산(묵은 값 방지).
  const [reportRefresh, setReportRefresh] = useState(0);
  // 스크린타임 권한 상태(GROMO-986) — 미허용이면 사용 행을 권한 안내로 교체. null=조회 전.
  const [screenTimeAuth, setScreenTimeAuth] = useState<AuthorizationStatus | null>(null);
  // 안드로이드 오늘 사용시간(분, GROMO-994) — 네이티브 뷰가 없어 모듈 조회값으로 직접 그린다.
  // 홈 포커스·당겨서 새로고침(reportRefresh)마다 재조회. null=조회 전('–' 표시).
  const [androidUsageMinutes, setAndroidUsageMinutes] = useState<number | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'android' || screenTimeAuth !== 'approved') return;
    let cancelled = false;
    ScreenTimeModule.getTodayUsageBucketMinutes()
      .then((m) => !cancelled && setAndroidUsageMinutes(m))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [screenTimeAuth, reportRefresh]);
  // 권한 요청 중복 방지 — 시스템 권한 시트가 떠 있는 동안 재탭 무시(UI 변화 없어 ref면 충분).
  const permissionRequestingRef = useRef(false);
  // 오늘 요약(서버 stats/today). null이면 미조회/게스트/실패 → 로컬 FocusContext 값으로 폴백.
  const [todayStats, setTodayStats] = useState<TodayStatsResponse | null>(null);
  // 연속 공부 일수(하루 10분 스트릭, GROMO-630) — 0이면 칩 생략.
  const [streakDays, setStreakDays] = useState(0);
  // 칩에 실제로 표시하는 스트릭 값 — streakDays보다 **한 커밋 늦게** 따라온다.
  //
  // ⚠️ 왜 나눴나: 칩은 0일이면 숨기므로(`streakDays > 0`), 첫 응답이 오는 순간에야 서브트리가
  //    마운트된다. 그때 AnimatedNumber는 최종값으로 초기화돼(display=displayRef=value) 내부
  //    effect의 from===value 분기로 즉시 끝나 **카운트업이 아예 안 돈다**(codex 리뷰).
  //    마운트되는 프레임에는 0을 넘기고 다음 커밋에 실제 값을 올리면 0 → N으로 세어 올라간다.
  //    (코인 칩은 칩 자체가 항상 떠 있고 CoinContext가 0에서 시작하므로 이 처리가 필요 없다.)
  const [streakShown, setStreakShown] = useState(0);
  useEffect(() => {
    setStreakShown(streakDays);
  }, [streakDays]);
  // 목표 달성 축하(GROMO-630) — 결과 화면이 예약해 둔 축하를 홈 진입 시 노출. null=비노출.
  // date = 달성한 날짜(예약 payload의 date) — 닫을 때 이 날짜로 기록한다.
  const [goalCelebration, setGoalCelebration] = useState<{
    date: string;
    days: number;
    goalMinutes?: number;
  } | null>(null);
  // 스크린타임 목표 달성 축하(GROMO-629) — 어제 달성 시 오늘 첫 홈 진입에 1회 노출. null=비노출.
  const [screenTimeCelebration, setScreenTimeCelebration] = useState<{
    date: string;
    days: number;
    goalMinutes?: number;
  } | null>(null);
  useEffect(() => {
    if (!isFocused || goalCelebration?.goalMinutes == null) return;
    logCurrencyRewardShown({
      surface: 'goal_modal',
      amount: focusGoalReward(goalCelebration.goalMinutes),
      reward_type: 'focus_goal',
    });
  }, [goalCelebration?.goalMinutes, isFocused]);
  useEffect(() => {
    if (!isFocused || screenTimeCelebration?.goalMinutes == null || goalCelebration != null) return;
    logCurrencyRewardShown({
      surface: 'screentime_modal',
      amount: screenTimeGoalReward(screenTimeCelebration.goalMinutes),
      reward_type: 'screentime_goal',
    });
  }, [goalCelebration, screenTimeCelebration?.goalMinutes, isFocused]);
  // 오늘 집중 누적(로컬)을 effect 재실행 없이 최신값으로 읽기 위한 ref(폴백/계측용).
  const todayFocusSecondsRef = useRef(todayFocusSeconds);
  todayFocusSecondsRef.current = todayFocusSeconds;

  // 오늘 요약을 서버(/api/v1/stats/today)에서 조회해 반영. 반환값은 계측용 focus_minutes.
  // 게스트(userId 없음)나 조회 실패 시 서버값 대신 로컬 집중값으로 폴백한다.
  const refetchTodayStats = useCallback(async (): Promise<number> => {
    if (userId) {
      try {
        const data = await getTodayStats();
        setTodayStats(data);
        // 계측도 실제 표시값과 동일 기준 — 서버·로컬 최댓값 병합(아래 focusValueSeconds와 같은
        // 규칙·같은 동축 게이트: 축이 갈린 날은 로컬 누적이 다른 KST 날짜 몫이라 합치지 않는다).
        return kstLocalSameDay()
          ? Math.max(data.focus.todayMinutes, Math.round(todayFocusSecondsRef.current / 60))
          : data.focus.todayMinutes;
      } catch {
        // 네트워크/인증 실패 → 아래 로컬 폴백
      }
    }
    setTodayStats(null);
    return Math.round(todayFocusSecondsRef.current / 60);
  }, [userId]);

  // 목표 달성 축하 예약 확인(GROMO-630) — 오늘 예약이면 모달, 지난 예약이면 정리.
  // 홈 포커스 때 + 예약 저장 완료 구독으로 호출된다. 홈이 화면 앞에 있을 때만 모달을 띄운다
  // (다른 화면 위로 모달이 뜨지 않게).
  const checkGoalCelebration = useCallback(async () => {
    const p = await readPendingCelebration();
    if (!p) return;
    // 예약 date는 결과 화면이 celebrationDayKey(KST — 달성 판정 버킷 축)로 쓴다 — 비교도 같은
    // 키(GROMO-1236 P2 6라운드, 체인 전체 한 축).
    // 아래 스크린타임 축하가 로컬인 것은 오타가 아니다 — 두 축하의 **달성 판정 축이 다르다**:
    // 집중 목표는 서버가 KST 일 버킷으로 판정하고, 스크린타임 목표는 앱이 네이티브 버킷 분값
    // (익스텐션 로컬 하루)으로 판정한다. 가드 키는 판정 축을 따라간다(GROMO-1254 재확인).
    // ⚠️ 다만 "스크린타임 = 전부 로컬"은 아니다 — 그 축하의 **연속 달성일 카운트**는 서버 heatmap
    // 셀을 세는 데이터 결합이라 서버 버킷 축이다(screentimeSync.scheduleYesterdayScreenTimeCelebration).
    if (p.date !== celebrationDayKey()) {
      clearPendingCelebration().catch(() => {});
      return;
    }
    if (navigation.isFocused()) setGoalCelebration(p);
  }, [navigation]);

  // 스크린타임 축하 예약 확인(GROMO-629) — 오늘 예약이면 모달, 지난 예약이면 정리.
  // 축은 로컬(todayStr) — 발행 측(screentimeSync)이 로컬 today로 예약하고 닫기 기록
  // (screentimeLastRewardedDate)도 그 date를 그대로 쓴다. 셋 중 하나만 옮기면 dedup이 깨진다.
  const checkScreenTimeCelebration = useCallback(async () => {
    const p = await readPendingScreenTimeCelebration();
    if (!p) return;
    if (p.date !== todayStr()) {
      clearScreenTimeCelebration().catch(() => {});
      return;
    }
    if (navigation.isFocused()) setScreenTimeCelebration(p);
  }, [navigation]);

  // 예약 저장 완료 구독 — "홈으로"를 서버 판정보다 빨리 눌러 홈 포커스가 예약 저장보다 먼저
  // 지나간 경우에도, 저장이 끝나는 즉시 모달이 뜬다(PR 225 후속 리뷰).
  useEffect(
    () =>
      subscribeCelebration(() => {
        checkGoalCelebration().catch(() => {});
      }),
    [checkGoalCelebration],
  );

  useEffect(
    () =>
      subscribeScreenTimeCelebration(() => {
        checkScreenTimeCelebration().catch(() => {});
      }),
    [checkScreenTimeCelebration],
  );

  // 권한 켜기 CTA(GROMO-986) — 설정앱 이동 없이 시스템 권한창 재요청(971 방식 공유).
  // FamilyControls는 denied 상태여도 requestAuthorization 재호출로 권한 시트가 다시 뜬다.
  // 승인되면 상태 갱신으로 리포트가 새로 마운트되어 숫자+바가 즉시 보인다.
  const requestScreenTimePermission = useCallback(async () => {
    if (permissionRequestingRef.current) return;
    permissionRequestingRef.current = true;
    try {
      const granted = await ScreenTimeModule.requestAuthorization();
      try {
        await updateScreenTimePermission({ granted });
      } catch {
        // 서버 반영 실패는 조용히 무시 — 기기 권한 상태가 진실(설정 화면과 동일).
      }
      setScreenTimeAuth(await ScreenTimeModule.getAuthorizationStatus());
    } catch (e) {
      Alert.alert(t('home.permissionErrorTitle'), e instanceof Error ? e.message : String(e));
    } finally {
      permissionRequestingRef.current = false;
    }
  }, []);

  // 앱 포그라운드 복귀 시 권한 상태 재조회(GROMO-986) — iOS 설정에서 직접 켜고 돌아온 경우
  // 홈 포커스가 유지된 채라 useFocusEffect가 다시 돌지 않으므로 별도로 갱신한다.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      ScreenTimeModule.getAuthorizationStatus()
        .then(setScreenTimeAuth)
        .catch(() => {});
    });
    return () => sub.remove();
  }, []);

  useFocusEffect(
    useCallback(() => {
      setReportRefresh((r) => r + 1);
      // 홈 진입 계측(GROMO-537) — 홈 포커스마다 1회.
      logHomeViewed();
      let cancelled = false;
      // 스크린타임 권한 상태 재조회(GROMO-986) — 다른 화면(설정 등)에서 바뀐 상태를 복귀 시 반영.
      ScreenTimeModule.getAuthorizationStatus()
        .then((st) => !cancelled && setScreenTimeAuth(st))
        .catch(() => {});
      // 오늘 요약 조회 후 실제 표시값 기준으로 노출 계측.
      refetchTodayStats().then((focusMinutes) => {
        if (!cancelled) logTodaySummaryViewed({ focus_minutes: focusMinutes });
      });
      // 연속 공부 일수(GROMO-630) — 홈 포커스마다 최신화(방금 세션 반영).
      getStreak()
        .then((v) => !cancelled && setStreakDays(v.currentStreak))
        .catch(() => {});
      checkGoalCelebration().catch(() => {});
      checkScreenTimeCelebration().catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [refetchTodayStats, checkGoalCelebration, checkScreenTimeCelebration]),
  );

  // 당겨서 새로고침 — 오늘 요약 재조회 + 네이티브 사용량 리포트 리마운트.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    logHomeRefreshed();
    setRefreshing(true);
    setReportRefresh((r) => r + 1);
    // 권한 상태도 같이 재조회한다 — 권한 켜기가 잘못 떠 있을 때 사용자가 가장 먼저 하는 동작이
    // 당겨서 새로고침인데, 여기서 안 읽으면 그 세션 내내 잘못된 상태에 머문다(콜드런치엔
    // AppState 'change' 도 뜨지 않는다).
    ScreenTimeModule.getAuthorizationStatus()
      .then(setScreenTimeAuth)
      .catch(() => {});
    refetchTodayStats().finally(() => setTimeout(() => setRefreshing(false), 600));
  }, [refetchTodayStats]);

  // 순위·티어 = 리그 탭과 동일 원천(useLeagueMeta → GET /league/me/tier, useLeagueRanking).
  // 미배정/게스트/실패 시 tierLevel null → 1단계 기본 배지(리그 화면과 같은 규칙).
  const { tier: leagueTier } = useLeagueMeta();
  const { myLeagueRank } = useLeagueRanking();
  const tier = tierByLevel(leagueTier.tierLevel ?? 1);

  // 종 뱃지(빨간 점) = 보관함의 안 읽은 알림 여부. 최초 확인 + 보관함 변경 구독으로 갱신
  // (알림 화면에서 읽음 처리하거나 포그라운드 푸시가 저장되면 즉시 반영).
  const [hasNotifications, setHasNotifications] = useState(false);
  useEffect(() => {
    const refresh = () => {
      hasUnread().then(setHasNotifications);
    };
    refresh();
    return subscribeInbox(refresh);
  }, []);

  // 공부 집중 값: 방금 끝낸 세션은 업로드가 비동기(실패 시 재시도 큐)라 서버 오늘요약에 아직
  // 없을 수 있고, 서버는 분 내림 집계라 1분 미만 세션은 영영 0이다. 결과 화면과 동일하게
  // max(서버, 로컬 누적)로 바닥을 깔아 홈 복귀 직후에도 방금 세션이 보이게 한다
  // (이중 집계 없음 — max라 서버 반영 후엔 서버값 그대로). 목표는 서버값 우선, 없으면 온보딩 목표.
  // 병합은 동축일 때만(kstLocalSameDay, GROMO-1236 P2 6라운드) — 측정 축은 로컬 소유라 축이
  // 갈린 날의 로컬 누적은 다른 KST 날짜 몫이다. 서버 미확보 시 로컬 폴백은 종전대로(측정 단독 표시).
  const focusValueSeconds = todayStats
    ? kstLocalSameDay()
      ? Math.max(todayStats.focus.todayMinutes * 60, todayFocusSeconds)
      : todayStats.focus.todayMinutes * 60
    : todayFocusSeconds;
  const focusGoalSeconds = todayStats ? todayStats.focus.goalMinutes * 60 : goalSeconds;

  // 축하 모달 닫기 — 축하 완료 기록 + 예약 제거(재노출 방지). 기록 날짜는 닫는 시점이 아니라
  // 달성한 날짜(예약의 date) — 자정 넘겨 닫으면 새 날의 실제 축하까지 눌린다(PR 225 리뷰).
  const closeGoalCelebration = useCallback(() => {
    if (goalCelebration) {
      AsyncStorage.setItem(STORAGE_KEYS.focusGoalCelebratedDate, goalCelebration.date).catch(
        () => {},
      );
    }
    clearPendingCelebration().catch(() => {});
    setGoalCelebration(null);
  }, [goalCelebration]);

  // 스크린타임 축하 모달 닫기(GROMO-629) — 오늘 노출 기록(하루 1회 가드) + 예약 제거.
  const closeScreenTimeCelebration = useCallback(() => {
    if (screenTimeCelebration) {
      AsyncStorage.setItem(
        STORAGE_KEYS.screentimeLastRewardedDate,
        screenTimeCelebration.date,
      ).catch(() => {});
    }
    clearScreenTimeCelebration().catch(() => {});
    setScreenTimeCelebration(null);
  }, [screenTimeCelebration]);

  // 카드 진입 stagger — **첫 마운트에서 한 번만** 재생한다(설계 §6). 탭을 오갈 때마다 다시
  // 재생되면 앱이 느려 보인다.
  //
  // 방식은 "재생이 끝나면 진입 스타일을 트리에서 뺀다"이다. 홈은 탭 화면이라 보통 언마운트되지
  // 않으므로 마운트 여부만으로는 못 막는다 — 탭 전환으로 화면이 네이티브 트리에서 떨어졌다
  // 다시 붙을 때 CSS 애니메이션이 재생될 수 있어서, animationName 자체를 없애 재생될 여지를
  // 지운다. 재생 중에는 홈이 자주 리렌더돼도(코인·스트릭·리포트 갱신) 상태가 유지되므로
  // 애니메이션이 중간에 끊기지 않는다.
  const enterPlayedRef = useRef(false);
  const [entering, setEntering] = useState(true);
  const m = useMotion();
  // ⚠️ **'동작 줄이기'가 확정되기 전에는 타이머를 걸지 않는다.** 미확정 구간에는 m.css()가
  //    진입 스타일을 걷어내 아무것도 재생되지 않는데, 그 사이 470ms가 흘러가 버린다.
  //    조회가 중간에 끝나면 남은 시간만큼만 재생돼 마지막 카드가 잘리고, 470ms보다 늦게 끝나면
  //    entering이 이미 false라 진입이 통째로 사라진다(codex 리뷰).
  //    확정된 뒤에 시작하고, reduce로 확정되면 기다릴 연출이 없으니 즉시 완료 처리한다.
  useEffect(() => {
    if (enterPlayedRef.current || !m.ready) return;
    if (m.reduce) {
      enterPlayedRef.current = true;
      setEntering(false);
      return;
    }
    const timer = setTimeout(() => {
      enterPlayedRef.current = true;
      setEntering(false);
    }, ENTER_TOTAL_MS);
    return () => clearTimeout(timer);
  }, [m.ready, m.reduce]);
  // CSS API에는 reduce-motion 내장 처리가 없다 — 반드시 m.css()를 통과시킨다.
  //
  // ⚠️ 진입 프리셋은 **m.css가 아니라 m.enter**를 통과시킨다. m.css는 미확정 구간의 보수적
  //    reduce=true에 스타일을 통째로 걷어내 상단바·방·오늘 카드를 첫 프레임에 완전히
  //    노출하는데, 이후 false로 확정되면 같은 노드에 enterUp이 붙으며 시작 상태로
  //    사라졌다가 다시 나타난다(codex 리뷰). m.enter는 확정 전 시작 프레임을 유지한다.
  const enter = (index: number) => (entering ? m.enter(enterUp(index)) : undefined);

  // 첫 진입 사용법 안내(GROMO-652) — 캐릭터가 오늘 카드·집중 FAB를 차례로 설명.
  // FAB는 탭바(다른 트리)에 있어 ref 대신 레이아웃 수식(fabWindowRect)으로 스포트라이트.
  const { width: winW, height: winH } = useWindowDimensions();
  const todayCardRef = useRef<View | null>(null);
  const guideSteps: GuideStep[] = [
    {
      text: t('home.guide.intro'),
      character: require('@/assets/character_hi.png'),
    },
    {
      text: t('home.guide.todayCard'),
      character: require('@/assets/character_study.png'),
      anchor: todayCardRef,
    },
    {
      text: t('home.guide.fab'),
      character: require('@/assets/character_study.png'),
      rect: fabWindowRect(winW, winH, insets.bottom),
      round: true,
    },
  ];

  return (
    <SafeAreaView testID="home.screen" style={s.root} edges={['top']}>
      <View style={s.body}>
        {/* 상단바+캐릭터만 스크롤/당김 영역. 오늘 카드(네이티브 리포트)는 스크롤 밖에 고정 —
            바운스에 네이티브 DeviceActivityReport scene이 깨지는 문제 회피. 당기면 리포트는 재계산됨. */}
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.accent} />
          }
        >
          {/* ── 상단바 ── (진입 stagger 0 — 기존 컨테이너를 Animated.View로 바꿨을 뿐,
              래퍼를 새로 끼우지 않는다. 트리가 바뀌면 Maestro testID 셀렉터가 깨진다) */}
          <Animated.View style={[s.topBar, enter(0)]}>
            <View style={s.profileRow}>
              <View style={s.avatar}>
                <CharacterImage size={38} sourceUri={activeSource ?? undefined} />
              </View>
              <View style={s.nameCol}>
                <View style={s.nameRow}>
                  {/* 닉네임은 최대 10자 — 320pt급 폭에선 순위 배지·알림 벨을 밀어낸다.
                      기본 배율에서 줄이는 건 닉네임뿐이고 배지·벨은 그대로 둔다(GROMO-1487).
                      다만 기기 글자 크기를 키우면 배지 안 '12위'까지 같이 커져 닉네임을 0으로
                      줄여도 모자라므로, 배지·티어 줄에도 flexShrink를 뒀다(GROMO-1485). */}
                  <Text style={s.nickname} numberOfLines={1}>
                    {nickname}
                  </Text>
                  {myLeagueRank != null && (
                    <View style={s.rankBadge}>
                      <Ionicons name="trophy" size={9} color={T.blue} />
                      <Text style={s.rankText}>{t('home.rank', { rank: myLeagueRank })}</Text>
                    </View>
                  )}
                </View>
                <View style={s.tierRow}>
                  <Image source={tier.image} style={s.tierImg} />
                  <Text style={s.tierText} numberOfLines={1}>
                    {tier.name}
                  </Text>
                </View>
              </View>
            </View>
            <PressableScale
              style={s.settingsBtn}
              scaleTo={0.92}
              accessibilityLabel={hasNotifications ? t('home.bellA11yUnread') : t('home.bellA11y')}
              onPress={() => {
                logHomeButtonTapped({ button: 'notification_bell', destination: 'Notifications' });
                navigation.navigate('Notifications');
              }}
            >
              <Ionicons name="notifications-outline" size={19} color={T.ink} />
              {hasNotifications && <View style={s.notifDot} />}
            </PressableScale>
          </Animated.View>

          {/* ── 방 + 캐릭터 ── (진입 stagger 1) */}
          <Animated.View style={[s.room, enter(1)]}>
            {/* 메인 캐릭터만 호흡한다(GROMO-1381). s.room은 클리핑이 없어 scaleY 1.025가 잘리지
                않는다 — 위 프로필 아바타(s.avatar, overflow:'hidden' 44px)는 여유가 3px뿐이라
                호흡을 붙이면 머리·발이 잘려 떨리는 것처럼 보인다. 그래서 그쪽은 정적 그대로 둔다.
                reduce 처리는 컴포넌트 안에 있으므로 호출부에서 다시 분기하지 않는다. */}
            <AnimatedCharacter
              testID="home.character"
              size={winH < SHORT_SCREEN_H ? CHAR_SIZE_SHORT : CHAR_SIZE}
              sourceUri={activeSource ?? undefined}
              // 다른 탭으로 가도 홈은 언마운트되지 않는다(MainTabs에 unmountOnBlur 없음) —
              // 보이지도 않는 캐릭터의 무한 호흡이 앱 세션 내내 UI 스레드를 먹는다(codex 리뷰).
              // '화면당 무한 루프 1개' 상한은 **보이는** 화면 기준이므로 포커스에 묶는다.
              active={isFocused}
            />
            {/* 캐릭터 변경 — 알림 벨과 같은 패턴(계측 + navigate). 은은한 pill 스타일 */}
            <PressableScale
              style={s.changeCharBtn}
              scaleTo={0.96}
              onPress={() => {
                logHomeButtonTapped({ button: 'character_change', destination: 'CharacterSelect' });
                navigation.navigate('CharacterSelect');
              }}
            >
              <Ionicons name="brush-outline" size={14} color={T.accent} />
              <Text style={s.changeCharText}>{t('home.changeCharacter')}</Text>
            </PressableScale>
          </Animated.View>
        </ScrollView>

        {/* ── 오늘 요약 카드 (하단 탭바 바로 위 고정, 스크롤 밖) ── (진입 stagger 2) */}
        {/* 아래 여백 = 탭바가 덮는 높이(FAB 솟은 만큼 포함) + 한 칸 — 홈 인디케이터가 없는
            기기(iPhone SE 등)에서 FAB가 카드 아래쪽을 덮던 문제를 막는다(GROMO-1487). */}
        <Animated.View
          testID="home.today.card"
          style={[
            s.card,
            { marginBottom: tabBarSafeBottom(insets.bottom) + T.space.sm },
            enter(CARD_ENTER_INDEX),
          ]}
          ref={todayCardRef}
          collapsable={false}
        >
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>
              {t('home.today.title')} <Text style={s.cardTitleSub}>{t('home.today.titleSub')}</Text>
            </Text>
            <View style={s.cardHeaderRight}>
              {/* 시간조각 잔액 칩 — 폭이 빠듯해 라벨 생략(모래시계 N). 미로드 시에도 '0'을 그대로 보여
                  준다(GROMO-1073): 지갑은 가입 시 함께 생기므로 신규 유저의 정답도 0이고, 여기서
                  '–'는 잔액을 잠금 판정에 쓰지 않는 자리라 정보 없는 기호일 뿐이다. */}
              <TouchableOpacity
                style={s.streakChip}
                activeOpacity={0.75}
                onPress={() => {
                  logCurrencyChipTapped({ location: 'home' });
                  navigation.navigate('CurrencyHistory', { entry: 'home_chip' });
                }}
                accessibilityRole="button"
                accessibilityLabel={t('home.currencyHistoryA11y')}
              >
                <CurrencyIcon size={11} />
                {/* 보간 중인 **소수값**이 format에 들어온다 — 반올림·천단위 구분은 여기서 한다 */}
                <AnimatedNumber
                  testID="home.coins"
                  value={coins}
                  format={(n) => Math.round(n).toLocaleString()}
                  style={s.streakChipText}
                />
              </TouchableOpacity>
              {/* 연속 공부(GROMO-630) — 하루 10분 스트릭. 0일이면 생략 */}
              {streakDays > 0 && (
                <View style={s.streakChip}>
                  <Ionicons name="flame" size={11} color={T.flame} />
                  {/* 세어 올라가는 건 숫자뿐 — '연속 공부'·'일'은 단위 텍스트라 밖에 둔다.
                      칩의 gap(3)이 글자 사이에 끼지 않게 형제가 아니라 Text 안에 중첩한다. */}
                  <Text style={s.streakChipText}>
                    {t('home.streakPrefix')}
                    <AnimatedNumber
                      testID="home.streak"
                      value={streakShown}
                      format={(n) => String(Math.round(n))}
                      style={s.streakChipText}
                    />
                    {t('home.streakSuffix')}
                  </Text>
                </View>
              )}
              <PressableScale
                testID="home.today.detail"
                style={s.moreBtn}
                scaleTo={0.94}
                onPress={() => {
                  logHomeButtonTapped({ button: 'today_summary_detail', destination: 'Stats' });
                  navigation.navigate('Stats');
                }}
              >
                <Text style={s.more}>{t('home.today.detail')}</Text>
                <Ionicons name="chevron-forward" size={11} color={T.accent} />
              </PressableScale>
            </View>
          </View>

          <MetricRow
            divider
            barTestID="home.metric.focus.bar"
            icon="book"
            iconColor={T.greenDeep}
            iconBg={T.greenBg}
            label={t('home.today.focus')}
            value={focusValueSeconds}
            goal={focusGoalSeconds}
          />
          <PhoneUsageRow
            goalSeconds={screenTimeGoalSeconds}
            refresh={reportRefresh}
            authStatus={screenTimeAuth}
            usageMinutes={androidUsageMinutes}
            onPress={() => {
              logHomeButtonTapped({ button: 'phone_usage', destination: 'UsageDetail' });
              navigation.navigate('UsageDetail');
            }}
            onEnablePermission={requestScreenTimePermission}
          />
        </Animated.View>
      </View>

      {/* 목표 달성 축하 모달(GROMO-630) — 결과 화면을 닫고 홈에 오면 노출 */}
      <GoalCelebrationModal
        visible={goalCelebration != null}
        goalStreakDays={goalCelebration?.days ?? 1}
        goalMinutes={goalCelebration?.goalMinutes}
        // 목표 분으로 지급액을 계산해 +N ⏳ 표기(서버 지급과 동일 공식 미러 — utils/currencyRewards)
        rewardCoins={
          goalCelebration?.goalMinutes != null
            ? focusGoalReward(goalCelebration.goalMinutes)
            : undefined
        }
        onClose={closeGoalCelebration}
      />

      {/* 스크린타임 목표 달성 축하 모달(GROMO-629) — 어제 달성 시 오늘 첫 홈 진입에 노출 */}
      {/* 포커스 축하가 떠 있으면 대기 — 두 모달이 겹치지 않게 순차 노출(코드리뷰 P2) */}
      <ScreenTimeCelebrationModal
        visible={screenTimeCelebration != null && goalCelebration == null}
        streakDays={screenTimeCelebration?.days ?? 1}
        goalMinutes={screenTimeCelebration?.goalMinutes}
        // 사용 상한(분)으로 지급액을 계산해 +N ⏳ 표기(서버 지급과 동일 공식 미러)
        rewardCoins={
          screenTimeCelebration?.goalMinutes != null
            ? screenTimeGoalReward(screenTimeCelebration.goalMinutes)
            : undefined
        }
        onClose={closeScreenTimeCelebration}
      />

      {/* 첫 진입 사용법 안내(GROMO-652) — 노출 완료 여부는 컴포넌트가 자체 관리 */}
      <TabGuideOverlay storageKey={STORAGE_KEYS.guideHome} steps={guideSteps} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  body: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  // 상단바
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.sm,
    paddingBottom: T.space.sm,
  },
  // flex:1 — 남는 폭을 다 쓰되, 좁아지면 여기가 줄어 알림 벨(고정 40)이 밀려나지 않는다.
  profileRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: T.space.md },
  nameCol: { flex: 1 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: T.sand,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  nickname: { ...T.text.subtitle, color: T.ink, flexShrink: 1 },
  rankBadge: {
    flexDirection: 'row',
    flexShrink: 1,
    alignItems: 'center',
    gap: 3,
    backgroundColor: T.blueBg,
    borderRadius: 7,
    paddingHorizontal: T.space.sm,
    paddingVertical: 2,
  },
  rankText: { ...T.text.label, color: T.blue, flexShrink: 1 },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.xs,
    marginTop: 2,
    flexShrink: 1,
  },
  tierImg: { width: 18, height: 18, resizeMode: 'contain' },
  tierText: { ...T.text.label, color: T.inkSub, flexShrink: 1 },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifDot: {
    position: 'absolute',
    top: 7,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.accentAlt,
    borderWidth: 1.5,
    borderColor: T.chipBg,
  },

  // 방 + 캐릭터 — 남는 높이를 채워 가운데 정렬하되, **줄어들지는 않는다**(flex:1 아님).
  // flexBasis가 내용 높이라 짧은 세로 화면에선 스크롤이 생길 뿐 캐릭터가 눌리지 않는다
  // (flex:1이면 basis 0이라 남는 높이가 캐릭터보다 작을 때 위아래가 잘렸다, GROMO-1487).
  room: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', marginTop: T.space.xs },
  // 캐릭터 변경 pill — 캐릭터 바로 아래, 은은한 인디고 틴트
  changeCharBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.xs,
    marginTop: T.space.md,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.sm,
    borderRadius: 999,
    backgroundColor: T.accentBg,
  },
  changeCharText: { ...T.text.label, color: T.accent },

  // 오늘 카드
  card: {
    marginHorizontal: T.space.xl,
    marginTop: T.space.sm,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 20,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.md,
    shadowColor: T.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  // 제목 | 칩 묶음 — 한 줄에 다 안 들어가면 칩 묶음이 통째로 아랫줄로 내려간다(잘림 대신 줄바꿈).
  // 오른쪽 정렬은 marginLeft:'auto'가 맡는다 — space-between은 줄바꿈되면 왼쪽으로 붙는다.
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    rowGap: T.space.sm,
    marginBottom: T.space.md,
  },
  cardTitle: { ...T.text.subtitle, color: T.ink },
  cardTitleSub: { color: T.inkFaint, fontWeight: '500' },
  moreBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  more: { ...T.text.label, color: T.accent },
  // 연속 공부 칩(GROMO-630)
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    marginLeft: 'auto',
  },
  streakChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: T.accentBg,
    borderRadius: 999,
    paddingHorizontal: T.space.sm,
    paddingVertical: 3,
  },
  streakChipText: { ...T.text.caption, fontSize: 10, fontWeight: '700', color: T.accentDeep },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    paddingVertical: T.space.sm,
  },
  metricDivider: { borderBottomWidth: 1, borderBottomColor: T.divider, paddingBottom: T.space.lg },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex1: { flex: 1 },
  usageLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metricLabel: { ...T.text.label, color: T.inkMuted },
  // 아래 진행바와의 간격 — 예전에는 s.track의 marginTop이 갖고 있었다. ProgressBar에는
  // style prop이 없고, 여백만을 위해 래퍼 뷰를 끼우면 E2E testID 트리가 바뀌므로 값 줄이 진다.
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: T.space.sm,
    marginTop: 1,
    marginBottom: T.space.sm,
  },
  metricValue: { ...T.text.stat, color: T.ink },
  // 좁은 폭에서 값(고정 폭)과 부딪히면 목표 쪽이 줄어 말줄임된다 — 값이 잘리는 것보다 낫다.
  goalText: { ...T.text.caption, color: T.inkMuted, flexShrink: 1 },
  usageReport: { width: '100%', height: 50, marginTop: 1 },
  // 권한 미허용 안내(GROMO-986) — 리포트(높이 50) 자리를 그대로 차지해 카드 레이아웃 유지
  permissionWrap: {
    minHeight: 50,
    marginTop: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
  },
  permissionText: { ...T.text.caption, color: T.inkSub, flex: 1, lineHeight: 17 },
  permissionBtn: {
    backgroundColor: T.accent,
    borderRadius: 999,
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.sm,
  },
  permissionBtnText: { ...T.text.label, color: T.white },
});
