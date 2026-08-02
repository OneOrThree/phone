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
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { tierByLevel } from '@/constants/tiers';
import { useLeagueRanking } from '@/screens/league/useLeagueRanking';
import { useLeagueMeta } from '@/screens/league/useLeagueMeta';
import type { V2RootStackParamList } from '@/navigation/types';
import { useUser } from '@/store/UserContext';
import { useFocus } from '@/store/FocusContext';
import { useCharacter } from '@/store/CharacterContext';
import ScreenTimeReportView from '@/components/ScreenTimeReportView';
import ScreenTimeModule, {
  androidNativeModuleAvailable,
  type AuthorizationStatus,
} from '@/services/ScreenTimeModule';
import { updateScreenTimePermission } from '@/services/userApi';
import { CharacterImage } from '@/components/character/CharacterImage';
import { GoalCelebrationModal } from '@/components/GoalCelebrationModal';
import { ScreenTimeCelebrationModal } from '@/components/ScreenTimeCelebrationModal';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
import { PressableScale } from '@/components/PressableScale';
import { fabWindowRect } from '@/components/TabBar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { todayStr } from '@/utils/localDate';
import { playTapSound } from '@/utils/sound';
import { getTodayStats, getStreak } from '@/services/statsApi';
import { hasUnread, subscribeInbox } from '@/services/notificationInbox';
import {
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
} from '@/services/analyticsEvents';

// v2 홈 화면 (GROMO-552) — Claude Design "01 홈" 시안 기반.
// 상단바(닉/순위/티어) + 방+캐릭터 + 오늘 요약 카드. 탭바/FAB는 RootNavigator.
// 데이터 층은 @/store 훅 재사용 — 순위·티어(리그 API)·집중시간(통계)·핸드폰사용(네이티브
// 리포트)·통계 이동까지 실연동 완료.

// 초 → "N시간 M분" (목표 표시용)
function hm(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
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
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  label: string;
  value: number;
  goal: number;
  overColor?: string;
  divider?: boolean;
}) {
  const pct = goal > 0 ? Math.min(value / goal, 1) : 0;
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
            목표 {hm(goal)}
          </Text>
        </View>
        {/* 진행 바 — 카드 끝까지 전체 폭 (두 행 모두 전체 폭이라 바 길이도 자연히 동일) */}
        <View style={s.track}>
          <View style={[s.fill, { width: `${pct * 100}%`, backgroundColor: fillColor }]} />
        </View>
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
  const androidPct =
    goalSeconds > 0 && usageMinutes != null ? Math.min((usageMinutes * 60) / goalSeconds, 1) : 0;
  return (
    <View style={s.metricRow}>
      <View style={[s.metricIcon, { backgroundColor: T.accentBg }]}>
        <Ionicons name="phone-portrait-outline" size={17} color={T.accent} />
      </View>
      <View style={s.flex1}>
        <View style={s.usageLabelRow}>
          <Text style={s.metricLabel} allowFontScaling={false}>
            핸드폰 사용
          </Text>
          <Ionicons name="chevron-forward" size={12} color={T.inkMuted} />
        </View>
        {needsPermission ? (
          // 권한 미허용 — 안내 문구 + 권한 켜기 CTA. 탭은 아래 행 전체 오버레이가 받는다.
          <View style={s.permissionWrap}>
            <Text style={s.permissionText} allowFontScaling={false}>
              스크린타임 권한을 켜면{'\n'}오늘 사용시간을 볼 수 있어요.
            </Text>
            <View style={s.permissionBtn}>
              <Text style={s.permissionBtnText} allowFontScaling={false}>
                권한 켜기
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
                목표 {hm(goalSeconds)}
              </Text>
            </View>
            <View style={s.track}>
              <View
                style={[s.fill, { width: `${androidPct * 100}%`, backgroundColor: T.accent }]}
              />
            </View>
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
        onPressIn={playTapSound}
        onPress={needsPermission ? onEnablePermission : onPress}
        accessibilityLabel={needsPermission ? '스크린타임 권한 켜기' : '핸드폰 앱별 사용시간 보기'}
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
        // 계측도 실제 표시값과 동일 기준 — 서버·로컬 최댓값 병합(아래 focusValueSeconds와 같은 규칙).
        return Math.max(data.focus.todayMinutes, Math.round(todayFocusSecondsRef.current / 60));
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
    if (p.date !== todayStr()) {
      clearPendingCelebration().catch(() => {});
      return;
    }
    if (navigation.isFocused()) setGoalCelebration(p);
  }, [navigation]);

  // 스크린타임 축하 예약 확인(GROMO-629) — 오늘 예약이면 모달, 지난 예약이면 정리.
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
      Alert.alert('권한 처리 실패', e instanceof Error ? e.message : String(e));
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
  const focusValueSeconds = todayStats
    ? Math.max(todayStats.focus.todayMinutes * 60, todayFocusSeconds)
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

  // 첫 진입 사용법 안내(GROMO-652) — 캐릭터가 오늘 카드·집중 FAB를 차례로 설명.
  // FAB는 탭바(다른 트리)에 있어 ref 대신 레이아웃 수식(fabWindowRect)으로 스포트라이트.
  const { width: winW, height: winH } = useWindowDimensions();
  const todayCardRef = useRef<View | null>(null);
  const guideSteps: GuideStep[] = [
    {
      text: '안녕! 나는 그로모야.\n홈에서는 나와 함께 오늘의 공부 현황을 볼 수 있어.',
      character: require('@/assets/character_hi.png'),
    },
    {
      text: '오늘의 공부 집중과 핸드폰 사용 시간을 여기서 한눈에 볼 수 있어.\n‘자세히’를 누르면 통계로 이동해.',
      character: require('@/assets/character_study.png'),
      anchor: todayCardRef,
    },
    {
      text: '준비됐으면 이 버튼을 눌러서 바로 집중을 시작해보자!',
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
          {/* ── 상단바 ── */}
          <View style={s.topBar}>
            <View style={s.profileRow}>
              <View style={s.avatar}>
                <CharacterImage size={38} sourceUri={activeSource ?? undefined} />
              </View>
              <View>
                <View style={s.nameRow}>
                  <Text style={s.nickname}>{nickname}</Text>
                  {myLeagueRank != null && (
                    <View style={s.rankBadge}>
                      <Ionicons name="trophy" size={9} color={T.blue} />
                      <Text style={s.rankText}>{myLeagueRank}위</Text>
                    </View>
                  )}
                </View>
                <View style={s.tierRow}>
                  <Image source={tier.image} style={s.tierImg} />
                  <Text style={s.tierText}>{tier.name}</Text>
                </View>
              </View>
            </View>
            <PressableScale
              style={s.settingsBtn}
              scaleTo={0.92}
              onPress={() => {
                logHomeButtonTapped({ button: 'notification_bell', destination: 'Notifications' });
                navigation.navigate('Notifications');
              }}
            >
              <Ionicons name="notifications-outline" size={19} color={T.ink} />
              {hasNotifications && <View style={s.notifDot} />}
            </PressableScale>
          </View>

          {/* ── 방 + 캐릭터 ── */}
          <View style={s.room}>
            <CharacterImage size={216} sourceUri={activeSource ?? undefined} />
            {/* 캐릭터 바꾸기 — 알림 벨과 같은 패턴(계측 + navigate). 은은한 pill 스타일 */}
            <PressableScale
              style={s.changeCharBtn}
              scaleTo={0.96}
              onPress={() => {
                logHomeButtonTapped({ button: 'character_change', destination: 'CharacterSelect' });
                navigation.navigate('CharacterSelect');
              }}
            >
              <Ionicons name="brush-outline" size={14} color={T.accent} />
              <Text style={s.changeCharText}>캐릭터 바꾸기</Text>
            </PressableScale>
          </View>
        </ScrollView>

        {/* ── 오늘 요약 카드 (하단 탭바 바로 위 고정, 스크롤 밖) ── */}
        <View
          style={[s.card, { marginBottom: insets.bottom + 74 }]}
          ref={todayCardRef}
          collapsable={false}
        >
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>
              오늘 <Text style={s.cardTitleSub}>Today</Text>
            </Text>
            <View style={s.cardHeaderRight}>
              {/* 연속 공부(GROMO-630) — 하루 10분 스트릭. 0일이면 생략 */}
              {streakDays > 0 && (
                <View style={s.streakChip}>
                  <Ionicons name="flame" size={11} color={T.flame} />
                  <Text style={s.streakChipText}>연속 공부 {streakDays}일</Text>
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
                <Text style={s.more}>자세히</Text>
                <Ionicons name="chevron-forward" size={11} color={T.accent} />
              </PressableScale>
            </View>
          </View>

          <MetricRow
            divider
            icon="book"
            iconColor={T.greenDeep}
            iconBg={T.greenBg}
            label="공부 집중"
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
        </View>
      </View>

      {/* 목표 달성 축하 모달(GROMO-630) — 결과 화면을 닫고 홈에 오면 노출 */}
      <GoalCelebrationModal
        visible={goalCelebration != null}
        goalStreakDays={goalCelebration?.days ?? 1}
        goalMinutes={goalCelebration?.goalMinutes}
        onClose={closeGoalCelebration}
      />

      {/* 스크린타임 목표 달성 축하 모달(GROMO-629) — 어제 달성 시 오늘 첫 홈 진입에 노출 */}
      {/* 포커스 축하가 떠 있으면 대기 — 두 모달이 겹치지 않게 순차 노출(코드리뷰 P2) */}
      <ScreenTimeCelebrationModal
        visible={screenTimeCelebration != null && goalCelebration == null}
        streakDays={screenTimeCelebration?.days ?? 1}
        goalMinutes={screenTimeCelebration?.goalMinutes}
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
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.md },
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
  nickname: { ...T.text.subtitle, color: T.ink },
  rankBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: T.blueBg,
    borderRadius: 7,
    paddingHorizontal: T.space.sm,
    paddingVertical: 2,
  },
  rankText: { ...T.text.label, color: T.blue },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs, marginTop: 2 },
  tierImg: { width: 18, height: 18, resizeMode: 'contain' },
  tierText: { ...T.text.label, color: T.inkSub },
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

  // 방 + 캐릭터 — 가운데를 채우고, 카드를 하단으로 밀어냄
  room: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: T.space.xs },
  // 캐릭터 바꾸기 pill — 캐릭터 바로 아래, 은은한 인디고 틴트
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: T.space.md,
  },
  cardTitle: { ...T.text.subtitle, color: T.ink },
  cardTitleSub: { color: T.inkFaint, fontWeight: '500' },
  moreBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  more: { ...T.text.label, color: T.accent },
  // 연속 공부 칩(GROMO-630)
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
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
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: T.space.sm,
    marginTop: 1,
  },
  metricValue: { ...T.text.stat, color: T.ink },
  goalText: { ...T.text.caption, color: T.inkMuted },
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
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: T.caramel,
    overflow: 'hidden',
    marginTop: T.space.sm,
  },
  fill: { height: '100%', borderRadius: 3 },
});
