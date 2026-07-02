import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { T } from '@/v2/constants/theme';
import { tierByLevel } from '@/v2/constants/tiers';
import { Character2D } from '@/components/character/Character2D';
import type { V2RootStackParamList } from '@/v2/navigation/types';
import { TierBadge } from './components/TierBadge';

// 승격/강등 연출 (root stack, 풀스크린 다크) — route.params.type으로 분기.
// 실제 트리거는 주간 정산의 result(TODO) — 지금은 TierGuide 롱프레스 임시 진입점으로 미리보기.
// TODO: 정산 result 기반 실데이터(이전/새 티어, 보너스) 연결 + 등장 애니메이션 연출.

const GOLD = '#F2CE73';

export default function LeagueResultScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<V2RootStackParamList, 'LeagueResult'>>();
  const promote = route.params.type === 'promote';

  // mock: 현재 3단계 기준 — 승격이면 4단계로, 강등이면 2단계로
  const from = tierByLevel(3);
  const to = tierByLevel(promote ? 4 : 2);

  return (
    <LinearGradient colors={['#3B2E20', '#241B12', '#1B1613']} style={s.bg}>
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.body}>
          {promote ? (
            <>
              <Text style={s.caption}>PROMOTED</Text>
              <Text style={s.title}>승격했어요!</Text>

              {/* 큰 티어 뱃지 + 글로우 */}
              <View style={s.glowOuter}>
                <View style={s.glowInner}>
                  <Image source={to.image} style={s.badgeImg} />
                </View>
              </View>

              <View style={s.tierPill}>
                <TierBadge level={to.level} size={18} />
                <Text style={s.tierPillText}>{to.name}</Text>
              </View>

              <Text style={s.desc}>
                한 주 동안 쌓아 올린 집중의 결과예요.{'\n'}새 리그에서도 같이 달려요!
              </Text>

              <View style={s.bonusPill}>
                <Ionicons name="sparkles" size={14} color={GOLD} />
                <Text style={s.bonusText} allowFontScaling={false}>
                  승격 보너스 +150
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={[s.caption, s.captionMuted]}>WEEK CLOSED</Text>
              <Text style={s.title}>한 주 수고했어요</Text>

              {/* 마스코트 — TODO: 둥실 떠다니는 애니메이션 연출 */}
              <View style={s.mascotCircle}>
                <Character2D size={104} />
              </View>

              {/* 티어 전환 (이전 → 현재) */}
              <View style={s.transRow}>
                <View style={s.transCol}>
                  <Image source={from.image} style={[s.transImgSmall, s.transDim]} />
                  <Text style={[s.transName, s.transDim]}>{from.name}</Text>
                </View>
                <Ionicons name="arrow-forward" size={20} color="#8A7B68" />
                <View style={s.transCol}>
                  <Image source={to.image} style={s.transImg} />
                  <Text style={s.transName}>{to.name}</Text>
                </View>
              </View>

              <Text style={s.desc}>
                괜찮아요, 기록은 사라지지 않아요.{'\n'}다음 주에 같이 다시 올라가요!
              </Text>

              <View style={s.bonusPill}>
                <Ionicons name="trending-up" size={14} color={GOLD} />
                <Text style={s.bonusText} allowFontScaling={false}>
                  다음 주 {from.minHours}h 집중하면 다시 {from.name}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* ── 하단 CTA ── */}
        <TouchableOpacity
          style={[s.cta, promote ? s.ctaGold : s.ctaDim]}
          activeOpacity={0.85}
          onPress={() => navigation.goBack()}
        >
          <Text style={[s.ctaText, promote ? s.ctaTextGold : null]}>
            {promote ? '새 리그 보러가기' : '확인'}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: 24 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },

  caption: { ...T.text.caption, color: GOLD, letterSpacing: 4 },
  captionMuted: { color: '#C9B99B' },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5, color: '#FFF7E8' },

  glowOuter: {
    width: 208,
    height: 208,
    borderRadius: 104,
    backgroundColor: 'rgba(242,206,115,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  glowInner: {
    width: 164,
    height: 164,
    borderRadius: 82,
    backgroundColor: 'rgba(242,206,115,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeImg: { width: 128, height: 128, resizeMode: 'contain' },

  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  tierPillText: { ...T.text.label, fontSize: 16, color: '#FFF7E8' },

  desc: {
    ...T.text.body,
    fontSize: 15,
    lineHeight: 23,
    color: '#C9B99B',
    textAlign: 'center',
  },

  bonusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(242,206,115,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(242,206,115,0.45)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  bonusText: { ...T.text.caption, color: GOLD },

  mascotCircle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    overflow: 'hidden',
  },

  transRow: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 4 },
  transCol: { alignItems: 'center', gap: 5 },
  transImg: { width: 84, height: 84, resizeMode: 'contain' },
  transImgSmall: { width: 60, height: 60, resizeMode: 'contain' },
  transDim: { opacity: 0.45 },
  transName: { ...T.text.caption, color: '#E9DCC3' },

  cta: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 15,
    marginBottom: 10,
  },
  ctaGold: { backgroundColor: GOLD },
  ctaDim: { backgroundColor: 'rgba(255,255,255,0.12)' },
  ctaText: { ...T.text.label, fontSize: 17, color: '#FFF7E8' },
  ctaTextGold: { color: '#3A2A12' },
});
