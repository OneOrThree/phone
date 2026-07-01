import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';
import type { V2RootStackParamList } from '@/v2/navigation/types';
import { useUser } from '@/store/UserContext';
import ScreenTimeReportView from '@/components/ScreenTimeReportView';
import { Character2D } from '@/components/character/Character2D';

// v2 홈 화면 (GROMO-552) — Claude Design "01 홈" 시안 기반.
// 상단바(닉/순위/티어) + 방+캐릭터 + 오늘 요약 카드. 탭바/FAB는 RootNavigator.
// 데이터 층은 @/store 훅 재사용. 엔드포인트 미확정 값은 placeholder + TODO.
// TODO: 순위·티어(리그 API), 집중시간·핸드폰사용(통계/스크린타임), 룸 일러스트, 통계 이동.

// 초 → "N시간 M분"
function hm(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
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
        <Text style={s.metricValue} allowFontScaling={false}>
          {hm(value)}
        </Text>
        <View style={s.progressRow}>
          <View style={s.track}>
            <View style={[s.fill, { width: `${pct * 100}%`, backgroundColor: fillColor }]} />
          </View>
          <View style={s.goalBlock}>
            <Text style={s.goalLabel} allowFontScaling={false}>
              목표
            </Text>
            <Text style={s.goalValue} allowFontScaling={false}>
              {hm(goal)}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// 핸드폰 사용 행 — 값+진행 바를 네이티브 Home Usage 리포트 뷰가 그린다.
// (실사용시간은 원인 3으로 JS에 못 넘어와, 익스텐션 뷰를 임베드해야만 자정~현재 정확값 표시)
// goalSeconds prop → App Group에 기록 → 익스텐션이 목표 대비 바를 그림.
// iOS 외/네이티브 뷰 없음 → placeholder.
function PhoneUsageRow({
  goalSeconds,
  refresh,
  onPress,
}: {
  goalSeconds: number;
  refresh: number;
  onPress: () => void;
}) {
  return (
    <View style={s.metricRow}>
      <View style={[s.metricIcon, { backgroundColor: '#F6ECE0' }]}>
        <Ionicons name="phone-portrait-outline" size={17} color={T.accent} />
      </View>
      <View style={s.flex1}>
        <View style={s.usageLabelRow}>
          <Text style={s.metricLabel} allowFontScaling={false}>
            핸드폰 사용
          </Text>
          <Ionicons name="chevron-forward" size={12} color={T.inkMuted} />
        </View>
        {ScreenTimeReportView ? (
          // key에 goalSeconds+refresh → 목표 변경/홈 포커스 시 리마운트되어 최신값으로 재계산됨
          // (DeviceActivityReport는 prop 변경만으로는 재계산 안 하고, 실시간 갱신도 아니라서)
          <ScreenTimeReportView
            key={`goal-${goalSeconds}-r${refresh}`}
            reportContext="Home Usage"
            goalSeconds={goalSeconds}
            style={s.usageReport}
          />
        ) : (
          <Text style={s.metricValue}>–</Text>
        )}
      </View>
      {/* 투명 터치 레이어 — 네이티브 뷰 위에서도 탭 감지 → 앱별 상세 오버레이 */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={0.6}
        onPress={onPress}
        accessibilityLabel="핸드폰 앱별 사용시간 보기"
      />
    </View>
  );
}

// 앱별/카테고리별 사용시간 상세 — Total Activity 리포트를 absolute 오버레이로 띄운다.
// (RN Modal은 별도 윈도우라 DeviceActivityReport scene이 활성화 안 됨 → 같은 계층 오버레이 필수)
function UsageDetailOverlay({ onClose }: { onClose: () => void }) {
  return (
    <View style={s.detailOverlay}>
      <SafeAreaView style={s.detailSafe} edges={['top']}>
        <View style={s.detailHeader}>
          <TouchableOpacity style={s.detailClose} onPress={onClose} activeOpacity={0.7}>
            <Ionicons name="close" size={24} color={T.ink} />
          </TouchableOpacity>
          <Text style={s.detailTitle}>핸드폰 사용</Text>
          <View style={s.detailClose} />
        </View>
        <View style={s.detailBody}>
          {/* 리포트 콜드스타트가 느려 뒤에 스피너 → 뜨면 리포트가 덮음 */}
          <ActivityIndicator style={s.detailLoading} size="large" color={T.accent} />
          {ScreenTimeReportView ? (
            <ScreenTimeReportView reportContext="Total Activity" style={s.detailReport} />
          ) : (
            <Text style={s.detailEmpty}>iOS 기기에서만 볼 수 있어요</Text>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

export default function HomeScreen() {
  // 목표는 온보딩값(집중=goalSeconds, 사용시간=screenTimeGoalSeconds).
  const { nickname, goalSeconds, screenTimeGoalSeconds } = useUser();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  // 홈이 포커스될 때마다 사용량 리포트를 리마운트 → 최신값으로 재계산(묵은 값 방지).
  const [reportRefresh, setReportRefresh] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setReportRefresh((r) => r + 1);
    }, []),
  );

  // 당겨서 새로고침 — 리포트 리마운트로 재계산. 네이티브 재계산이 async라 스피너는 잠깐만.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setReportRefresh((r) => r + 1);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  // 앱별 사용시간 상세 오버레이
  const [showUsageDetail, setShowUsageDetail] = useState(false);

  // TODO: 순위·티어(리그 API), 집중시간 값(통계 API)은 아직 placeholder
  const rank = 8;
  const tierName = '초집중 모드';
  const focusSeconds = 3 * 3600 + 12 * 60;
  const hasNotifications = false; // TODO: 실제 안 읽은 알림 여부로 교체

  return (
    <SafeAreaView style={s.root} edges={['top']}>
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
                <Character2D size={30} />
              </View>
              <View>
                <View style={s.nameRow}>
                  <Text style={s.nickname}>{nickname}</Text>
                  <View style={s.rankBadge}>
                    <Ionicons name="trophy" size={9} color="#4C5DE6" />
                    <Text style={s.rankText}>{rank}위</Text>
                  </View>
                </View>
                <View style={s.tierRow}>
                  <View style={s.tierDot}>
                    <Ionicons name="flame" size={8} color="#fff" />
                  </View>
                  <Text style={s.tierText}>{tierName}</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity
              style={s.settingsBtn}
              onPress={() => {
                // TODO: 알림 화면으로 이동
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="notifications-outline" size={19} color={T.ink} />
              {hasNotifications && <View style={s.notifDot} />}
            </TouchableOpacity>
          </View>

          {/* ── 방 + 캐릭터 ── */}
          <View style={s.room}>
            <View style={s.floor} />
            <Character2D size={188} />
          </View>
        </ScrollView>

        {/* ── 오늘 요약 카드 (하단 탭바 바로 위 고정, 스크롤 밖) ── */}
        <View style={[s.card, { marginBottom: insets.bottom + 74 }]}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>
              오늘 <Text style={s.cardTitleSub}>Today</Text>
            </Text>
            <TouchableOpacity
              style={s.moreBtn}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('Stats')}
            >
              <Text style={s.more}>자세히</Text>
              <Ionicons name="chevron-forward" size={11} color={T.accent} />
            </TouchableOpacity>
          </View>

          <MetricRow
            divider
            icon="book"
            iconColor="#6FA15A"
            iconBg="#EEF4E9"
            label="공부 집중"
            value={focusSeconds}
            goal={goalSeconds}
          />
          <PhoneUsageRow
            goalSeconds={screenTimeGoalSeconds}
            refresh={reportRefresh}
            onPress={() => setShowUsageDetail(true)}
          />
        </View>
      </View>
      {showUsageDetail ? <UsageDetailOverlay onClose={() => setShowUsageDetail(false)} /> : null}
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
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 8,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EBD7B5',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nickname: { ...T.text.subtitle, color: T.ink },
  rankBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#ECEEFD',
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  rankText: { ...T.text.label, color: '#4C5DE6' },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  tierDot: {
    width: 14,
    height: 14,
    borderRadius: 4,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierText: { ...T.text.label, color: T.inkSub },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: '#EADEC9',
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
    borderColor: '#F1EADD',
  },

  // 방 + 캐릭터 — 가운데를 채우고, 카드를 하단으로 밀어냄
  room: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  floor: {
    position: 'absolute',
    bottom: 26,
    width: 210,
    height: 54,
    borderRadius: 105,
    backgroundColor: T.paperAlt,
    opacity: 0.6,
  },

  // 오늘 카드
  card: {
    marginHorizontal: 18,
    marginTop: 8,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 13,
    shadowColor: '#50371E',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 11,
  },
  cardTitle: { ...T.text.subtitle, color: T.ink },
  cardTitleSub: { color: '#B3A695', fontWeight: '500' },
  moreBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  more: { ...T.text.label, color: T.accent },
  metricRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8 },
  metricDivider: { borderBottomWidth: 1, borderBottomColor: '#F0E9DC', paddingBottom: 14 },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex1: { flex: 1 },
  usageLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metricLabel: { ...T.text.label, fontSize: 14, color: T.inkMuted },
  metricValue: { ...T.text.title, fontSize: 22, color: T.ink, marginTop: 1 },
  usageReport: { width: '100%', height: 70, marginTop: 1 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 7 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#EFE7DA', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  goalBlock: { alignItems: 'center' },
  goalLabel: { fontSize: 11, fontWeight: '600', color: T.inkMuted },
  goalValue: { ...T.text.caption, color: T.inkMuted, marginTop: 1 },

  // 앱별 사용시간 상세 오버레이
  detailOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: T.paperLight, zIndex: 10 },
  detailSafe: { flex: 1 },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
  },
  detailClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  detailTitle: { ...T.text.subtitle, color: T.ink },
  detailBody: { flex: 1 },
  detailLoading: { position: 'absolute', top: 44, left: 0, right: 0 },
  detailReport: { flex: 1 },
  detailEmpty: { ...T.text.body, color: T.inkMuted, textAlign: 'center', marginTop: 44 },
});
