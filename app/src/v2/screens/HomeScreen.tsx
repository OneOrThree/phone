import { View, Text, StyleSheet, TouchableOpacity, DevSettings } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { T } from '@/v2/constants/theme';
import { STORAGE_KEYS } from '@/types/storage';
import { useUser } from '@/store/UserContext';
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

export default function HomeScreen() {
  const { nickname, goalSeconds } = useUser();
  const insets = useSafeAreaInsets();

  // TODO: 실제 데이터로 교체 (지금은 시안 값 placeholder)
  const rank = 8;
  const tierName = '초집중 모드';
  const focusSeconds = 3 * 3600 + 12 * 60;
  const phoneSeconds = 2 * 3600 + 40 * 60;
  const phoneGoalSeconds = 4 * 3600 + 30 * 60;

  // 임시 로그아웃 — 정식 설정 화면 전까지 (설정 버튼에 연결)
  async function devLogout() {
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.accessToken,
      STORAGE_KEYS.refreshToken,
      STORAGE_KEYS.user,
    ]);
    DevSettings.reload();
  }

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.body}>
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
          <TouchableOpacity style={s.settingsBtn} onPress={devLogout} activeOpacity={0.8}>
            <Ionicons name="notifications-outline" size={19} color={T.ink} />
            <View style={s.notifDot} />
          </TouchableOpacity>
        </View>

        {/* ── 방 + 캐릭터 ── */}
        <View style={s.room}>
          <View style={s.floor} />
          <Character2D size={188} />
        </View>

        {/* ── 오늘 요약 카드 (하단 탭바 바로 위 고정) ── */}
        <View style={[s.card, { marginBottom: insets.bottom + 74 }]}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>
              오늘 <Text style={s.cardTitleSub}>Today</Text>
            </Text>
            <TouchableOpacity style={s.moreBtn} activeOpacity={0.7}>
              {/* TODO: 통계 화면으로 이동 */}
              <Text style={s.more}>자세히</Text>
              <Ionicons name="chevron-forward" size={11} color={T.accent} />
            </TouchableOpacity>
          </View>

          <View style={[s.metricRow, s.metricDivider]}>
            <View style={[s.metricIcon, { backgroundColor: '#EEF4E9' }]}>
              <Ionicons name="book" size={17} color="#6FA15A" />
            </View>
            <View style={s.flex1}>
              <Text style={s.metricLabel}>공부 집중</Text>
              <View style={s.metricValueRow}>
                <Text style={s.metricValue}>{hm(focusSeconds)}</Text>
                <Text style={s.metricGoal}>/ 목표 {hm(goalSeconds)}</Text>
              </View>
            </View>
          </View>

          <View style={s.metricRow}>
            <View style={[s.metricIcon, { backgroundColor: '#F6ECE0' }]}>
              <Ionicons name="phone-portrait-outline" size={17} color={T.accent} />
            </View>
            <View style={s.flex1}>
              <Text style={s.metricLabel}>핸드폰 사용</Text>
              <View style={s.metricValueRow}>
                <Text style={s.metricValue}>{hm(phoneSeconds)}</Text>
                <Text style={s.metricGoal}>/ 목표 {hm(phoneGoalSeconds)}</Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  body: { flex: 1 },

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
  rankText: { ...T.text.caption, color: '#4C5DE6' },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  tierDot: {
    width: 14,
    height: 14,
    borderRadius: 4,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierText: { ...T.text.caption, color: T.inkSub },
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
  cardTitle: { ...T.text.label, color: T.ink },
  cardTitleSub: { color: '#B3A695', fontWeight: '500' },
  moreBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  more: { ...T.text.caption, color: T.accent },
  metricRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 6 },
  metricDivider: { borderBottomWidth: 1, borderBottomColor: '#F0E9DC', paddingBottom: 13 },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex1: { flex: 1 },
  metricLabel: { ...T.text.caption, color: T.inkMuted },
  metricValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  metricValue: { ...T.text.title, color: T.ink },
  metricGoal: { ...T.text.caption, color: T.inkMuted },
});
