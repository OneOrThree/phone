import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { T } from '@/constants/theme';
import { TIERS, tierByLevel } from '@/constants/tiers';
import type { V2RootStackParamList } from '@/navigation/types';
import { fmtMinutes } from './format';
import { useLeagueMeta } from './useLeagueMeta';
import { useLeagueRanking } from './useLeagueRanking';
import { TierBadge } from './components/TierBadge';

// 티어 단계 안내 (root stack) — 시안 "티어 · 5단계 뱃지".
// 현재 티어 히어로 카드(진행바) + 5단계 카드 리스트(N단계) + 정산 안내.
// 티어·이번 주 집중분은 리그 탭과 동일 원천(useLeagueMeta → GET /league/me/tier, useLeagueRanking).
// 미배정/게스트/실패 시 tierLevel null → 1단계 기본(리그 화면과 같은 규칙), 집중분 0.
// 히어로·리스트 뱃지 모두 시안의 별 사각형 대신 tier 일러스트(tiers.ts image) 사용.

export default function TierGuideScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  const { tier } = useLeagueMeta();
  const level = tier.tierLevel ?? 1;
  const cur = tierByLevel(level);
  const { myMinutes: minutes } = useLeagueRanking();

  // 다음 단계 기준(분)과 남은 시간 — 시안 진행바는 다음 기준 대비 누적 비율(14h20m/22h ≈ 64%)
  const nextAt = cur.maxHours != null ? cur.maxHours * 60 : null;
  const remain = nextAt != null ? Math.max(nextAt - minutes, 0) : null;
  const progress = nextAt != null ? Math.min(minutes / nextAt, 1) : 1;

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── 헤더 ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={T.inkSub} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>티어 단계</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* ── 현재 티어 히어로 ── */}
        <LinearGradient colors={[T.accentBg, T.sand]} style={s.hero}>
          <Image source={cur.image} style={s.heroImg} />
          <Text style={s.heroName}>{cur.name}</Text>
          <Text style={s.heroSub} allowFontScaling={false}>
            이번 주 {fmtMinutes(minutes)}
            {remain != null ? ` · 다음 단계까지 ${fmtMinutes(remain)}` : ' · 최고 단계예요'}
          </Text>
          <View style={s.heroTrack}>
            <LinearGradient
              colors={[T.accentLight, T.accent]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[s.heroFill, { width: `${progress * 100}%` }]}
            />
          </View>
        </LinearGradient>

        {/* ── 5단계 카드 리스트 ── */}
        <View style={s.tierList}>
          {TIERS.map((t) => {
            const isCur = t.level === level;
            return (
              <View key={t.level} style={[s.tierRow, isCur ? s.tierRowCur : null]}>
                <TierBadge level={t.level} size={40} />
                <View style={s.tierNameCol}>
                  <View style={s.tierNameRow}>
                    <Text style={s.tierName}>{t.name}</Text>
                    {isCur && (
                      <View style={s.curBadge}>
                        <Text style={s.curBadgeText}>현재</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.tierRange}>{t.rangeLabel}</Text>
                </View>
                <Text style={[s.tierLevel, isCur ? s.tierLevelCur : null]}>{t.level}단계</Text>
              </View>
            );
          })}
        </View>

        {/* ── 정산 안내 ── */}
        <View style={s.notice}>
          <Text style={s.noticeText}>
            매주 <Text style={s.noticeStrong}>월요일 09시</Text> 정산 · 기준 충족 시 자동 승급, 미달
            시 한 단계 강등.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.sm,
    paddingBottom: T.space.sm,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...T.text.heading, fontWeight: '800', color: T.ink },

  scroll: { paddingHorizontal: T.space.xl, paddingBottom: 40 },

  hero: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: T.sand,
    borderRadius: 18,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.lg,
    marginTop: T.space.xs,
  },
  heroImg: { width: 84, height: 84, resizeMode: 'contain' },
  heroName: { ...T.text.subtitle, fontWeight: '800', color: T.ink, marginTop: T.space.sm },
  heroSub: { ...T.text.caption, fontWeight: '500', color: T.inkSub, marginTop: 3 },
  heroTrack: {
    alignSelf: 'stretch',
    height: 8,
    borderRadius: 4,
    backgroundColor: T.track,
    marginTop: T.space.md,
    overflow: 'hidden',
  },
  heroFill: { height: '100%', borderRadius: 4 },

  tierList: { gap: T.space.sm, marginTop: T.space.md },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.lg,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.sm,
  },
  tierRowCur: { backgroundColor: T.accentBg, borderWidth: 2, borderColor: T.accent },
  tierNameCol: { flex: 1 },
  tierNameRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  tierName: { ...T.text.label, fontWeight: '700', color: T.ink },
  tierRange: { ...T.text.caption, fontWeight: '500', color: T.inkSub, marginTop: 2 },
  curBadge: {
    backgroundColor: T.accent,
    borderRadius: 999,
    paddingHorizontal: T.space.sm,
    paddingVertical: 2,
  },
  curBadgeText: { ...T.text.caption, fontWeight: '700', color: T.white },
  tierLevel: { ...T.text.caption, fontWeight: '700', color: T.inkFaint },
  tierLevelCur: { color: T.accent },

  notice: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.md,
    marginTop: T.space.md,
  },
  noticeText: { ...T.text.caption, fontWeight: '500', color: T.link, lineHeight: 20 },
  noticeStrong: { fontWeight: '700', color: T.inkSub },
});
