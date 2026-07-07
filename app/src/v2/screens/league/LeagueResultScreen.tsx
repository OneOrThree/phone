import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { T } from '@/constants/theme';
import { tierByLevel } from '@/constants/tiers';
import { CharacterImage } from '@/components/character/CharacterImage';
import type { V2RootStackParamList } from '@/navigation/types';
import { TierBadge } from './components/TierBadge';

// 승격/강등 연출 (root stack, 풀스크린 다크 radial) — 시안 "승격/강등 연출".
// 실제 트리거는 주간 정산 result(TODO) — 지금은 TierGuide 롱프레스 임시 진입점으로 미리보기.
// TODO: 정산 result 기반 실데이터(이전/새 티어, 시간, 보너스) 연결.
// 승격 큰 뱃지는 시안의 별 사각형 대신 tier 일러스트(tiers.ts image) — 계획서에서 확정.

// mock: 승격 3→4 / 강등 4→3 (시안 연출 기준)
const PROMOTE_TO = 4;
const DEMOTE_FROM = 4;

export default function LeagueResultScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<V2RootStackParamList, 'LeagueResult'>>();
  const promote = route.params.type === 'promote';

  // 강등 화면 마스코트 둥실 애니메이션 (시안 gmFloat 4s)
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: -7, duration: 2000, useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float]);

  const to = tierByLevel(promote ? PROMOTE_TO : DEMOTE_FROM - 1);
  const from = tierByLevel(DEMOTE_FROM);

  return (
    <View style={s.root}>
      {/* 시안 radial 배경 — expo-linear-gradient엔 radial이 없어 svg로 */}
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="bg" cx="50%" cy={promote ? '28%' : '32%'} rx="80%" ry="55%">
            <Stop offset="0" stopColor={T.night.top} />
            <Stop offset="1" stopColor={T.night.bottom} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#bg)" />
      </Svg>

      {/* 승격 화면 반짝이 */}
      {promote && (
        <>
          <View style={[s.spark, s.spark1]} />
          <View style={[s.spark, s.sparkMilk, s.spark2]} />
          <View style={[s.spark, s.spark3]} />
          <View style={[s.spark, s.sparkMilk, s.spark4]} />
        </>
      )}

      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.body}>
          {promote ? (
            <>
              <Text style={s.caption}>PROMOTED</Text>
              <Text style={s.title}>승격했어요!</Text>

              {/* 큰 티어 뱃지 + 글로우 */}
              <View style={s.glow}>
                <Image source={to.image} style={s.badgeImg} />
              </View>

              <Text style={s.tierName}>{to.name}</Text>
              <Text style={s.desc}>
                이번 주 <Text style={s.descStrong}>26시간</Text> 집중!{'\n'}
                {to.name} 기준(주 {to.minHours}시간)을 넘겨 한 단계 올라갔어요.
              </Text>

              <View style={s.pill}>
                <View style={s.coin} />
                <Text style={s.pillText} allowFontScaling={false}>
                  승격 보너스 +150
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={[s.caption, s.captionMuted]}>한 주 마감 · WEEK CLOSED</Text>
              <Text style={[s.title, s.titleDemote]}>한 주 수고했어요</Text>

              {/* 둥실 떠다니는 마스코트 */}
              <Animated.View style={{ transform: [{ translateY: float }] }}>
                <CharacterImage size={108} />
              </Animated.View>

              {/* 티어 전환 (이전 → 지금) */}
              <View style={s.transRow}>
                <View style={[s.transCol, s.transDim]}>
                  <TierBadge level={from.level} size={40} />
                  <Text style={s.transFromName}>{from.name}</Text>
                </View>
                <Ionicons name="chevron-down" size={20} color={T.night.muted} />
                <View style={s.transCol}>
                  <TierBadge level={to.level} size={56} />
                  <Text style={s.transToName}>{to.name} · 지금</Text>
                </View>
              </View>

              <Text style={s.tierLeague}>{to.name} 리그</Text>
              <Text style={s.desc}>{to.name} 리그에서 더 힘내봐요!</Text>

              <View style={[s.pill, s.pillDemote]}>
                <Ionicons name="checkmark" size={14} color={T.accentLight} />
                <Text style={[s.pillText, s.pillTextDemote]} allowFontScaling={false}>
                  다음 주 +8시간이면 다시 {from.name}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* ── 하단 CTA ── */}
        <TouchableOpacity style={s.cta} activeOpacity={0.85} onPress={() => navigation.goBack()}>
          <Text style={s.ctaText}>{promote ? '새 리그 보러가기' : '이번 주 다시 시작'}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.night.bottom },
  safe: { flex: 1, paddingHorizontal: 22 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },

  spark: { position: 'absolute', borderRadius: 99, backgroundColor: T.night.gold },
  sparkMilk: { backgroundColor: T.night.cream, opacity: 0.7 },
  spark1: { left: 50, top: 120, width: 6, height: 6, opacity: 0.8 },
  spark2: { right: 60, top: 160, width: 8, height: 8 },
  spark3: { left: 80, top: 230, width: 5, height: 5, opacity: 0.6 },
  spark4: { right: 48, top: 280, width: 6, height: 6 },

  caption: {
    ...T.text.label,
    fontWeight: '700',
    color: T.accentLight,
    letterSpacing: 2,
    marginBottom: 8,
  },
  captionMuted: { ...T.text.caption, fontWeight: '700', color: T.night.muted },
  title: { ...T.text.display, color: T.night.cream, marginBottom: 24 },
  titleDemote: { ...T.text.title, marginBottom: 22 },

  glow: {
    padding: 18,
    borderRadius: 999,
    backgroundColor: 'rgba(240,199,106,0.16)',
    marginBottom: 24,
    shadowColor: T.night.gold,
    shadowOpacity: 0.55,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },
  badgeImg: { width: 120, height: 120, resizeMode: 'contain' },
  tierName: { ...T.text.title, color: T.night.cream },

  desc: {
    ...T.text.label,
    fontWeight: '500',
    lineHeight: 24,
    color: T.accentLight,
    textAlign: 'center',
    marginTop: 10,
  },
  descStrong: { fontWeight: '800', color: T.night.gold },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(200,137,63,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(200,137,63,0.45)',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
    marginTop: 22,
  },
  pillDemote: { backgroundColor: 'rgba(200,137,63,0.16)', borderColor: 'rgba(200,137,63,0.4)' },
  pillText: { ...T.text.label, fontWeight: '700', color: T.night.gold },
  pillTextDemote: { ...T.text.caption, fontWeight: '700', color: T.accentLight },
  coin: { width: 17, height: 17, borderRadius: 9, backgroundColor: T.night.gold },

  transRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18 },
  transCol: { alignItems: 'center', gap: 5 },
  transDim: { opacity: 0.45 },
  transFromName: { ...T.text.caption, color: T.night.muted },
  transToName: { ...T.text.caption, fontWeight: '700', color: T.accentLight },
  tierLeague: { ...T.text.stat, color: T.night.cream, marginTop: 12 },

  cta: {
    height: 56,
    borderRadius: 18,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  ctaText: { ...T.text.body, fontWeight: '700', color: T.white },
});
