import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';
import { TIERS, tierByLevel } from '@/v2/constants/tiers';
import type { V2RootStackParamList } from '@/v2/navigation/types';
import { fmtMinutes } from './format';
import { MY_RANK, MY_TIER } from './mock';

// 티어 단계 안내 (root stack) — 현재 티어 히어로 카드 + 5단계 리스트 + 정산 안내.
// 데이터는 mock — TODO: GET /league/me/tier·rank 연동.

export default function TierGuideScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  const level = MY_TIER.tierLevel ?? 1;
  const cur = tierByLevel(level);
  const minutes = MY_RANK.totalFocusMinutes ?? 0;

  // 다음 단계 기준(분)과 남은 시간 — 최고 단계면 null
  const nextAt = cur.maxHours != null ? cur.maxHours * 60 : null;
  const remain = nextAt != null ? Math.max(nextAt - minutes, 0) : null;
  const progress =
    nextAt != null
      ? Math.min(Math.max((minutes - cur.minHours * 60) / (nextAt - cur.minHours * 60), 0), 1)
      : 1;

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── 헤더 ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={T.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>티어 단계</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* ── 현재 티어 히어로 ── */}
        {/* 롱프레스 = 승격 연출 미리보기(임시 진입점) — 실제 트리거는 주간 정산 result(TODO) */}
        <TouchableOpacity
          style={s.hero}
          activeOpacity={0.9}
          onLongPress={() => navigation.navigate('LeagueResult', { type: 'promote' })}
        >
          <Image source={cur.image} style={s.heroImg} />
          <Text style={s.heroName}>{cur.name}</Text>
          <Text style={s.heroSub} allowFontScaling={false}>
            이번 주 {fmtMinutes(minutes)}
            {remain != null ? ` · 다음 단계까지 ${fmtMinutes(remain)}` : ' · 최고 단계예요'}
          </Text>
          <View style={s.heroTrack}>
            <View style={[s.heroFill, { width: `${progress * 100}%` }]} />
          </View>
        </TouchableOpacity>

        {/* ── 5단계 리스트 ── */}
        <View style={s.listCard}>
          {TIERS.map((t, i) => {
            const isCur = t.level === level;
            return (
              <View
                key={t.level}
                style={[
                  s.tierRow,
                  isCur ? s.tierRowCur : null,
                  i < TIERS.length - 1 && !isCur ? s.tierRowDivider : null,
                ]}
              >
                <Image source={t.image} style={s.tierImg} />
                <View style={s.tierNameCol}>
                  <Text style={[s.tierName, isCur ? s.tierNameCur : null]}>{t.name}</Text>
                  <Text style={s.tierRange}>{t.rangeLabel}</Text>
                </View>
                {isCur && (
                  <View style={s.curBadge}>
                    <Text style={s.curBadgeText}>현재</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* ── 정산 안내 ── */}
        {/* 롱프레스 = 강등 연출 미리보기(임시 진입점) */}
        <TouchableOpacity
          style={s.notice}
          activeOpacity={0.9}
          onLongPress={() => navigation.navigate('LeagueResult', { type: 'demote' })}
        >
          <Ionicons name="information-circle" size={16} color={T.inkSub} />
          <Text style={s.noticeText}>
            매주 월요일 오전 9시에 한 주 집중 시간을 정산해요. 결과에 따라 티어가 오르거나 내려가요.
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...T.text.subtitle, color: T.ink },

  scroll: { paddingHorizontal: 18, paddingBottom: 40 },

  hero: {
    alignItems: 'center',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 20,
    marginTop: 6,
  },
  heroImg: { width: 92, height: 92, resizeMode: 'contain' },
  heroName: { ...T.text.heading, color: T.ink, marginTop: 10 },
  heroSub: { ...T.text.label, color: T.inkSub, marginTop: 4 },
  heroTrack: {
    alignSelf: 'stretch',
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F1E9DA',
    marginTop: 14,
    overflow: 'hidden',
  },
  heroFill: { height: '100%', borderRadius: 4, backgroundColor: T.accent },

  listCard: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginTop: 14,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderRadius: 14,
  },
  tierRowCur: { backgroundColor: '#FBF3E8', borderWidth: 2, borderColor: '#C8893F' },
  tierRowDivider: { borderBottomWidth: 1, borderBottomColor: '#F4EEE2' },
  tierImg: { width: 44, height: 44, resizeMode: 'contain' },
  tierNameCol: { flex: 1, gap: 1 },
  tierName: { ...T.text.label, fontSize: 16, color: T.ink },
  tierNameCur: { fontWeight: '800' },
  tierRange: { ...T.text.caption, color: T.inkMuted },
  curBadge: {
    backgroundColor: T.accent,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  curBadgeText: { ...T.text.caption, fontSize: 12, color: T.white },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    marginTop: 16,
    paddingHorizontal: 6,
  },
  noticeText: { flex: 1, ...T.text.caption, fontWeight: '500', color: T.inkSub, lineHeight: 19 },
});
