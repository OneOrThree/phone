import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutAnimation,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { T, withAlpha } from '@/constants/theme';
import { tierByLevel } from '@/constants/tiers';
import { CharacterImage } from '@/components/character/CharacterImage';
import type { V2RootStackParamList } from '@/navigation/types';
import { TierBadge } from './components/TierBadge';

// 승격/유지/강등 연출 (root stack, 풀스크린 다크 radial) — 시안 "승격/강등 연출".
// 실제 트리거는 주간 정산 result(TODO) — 지금은 dev 메뉴/TierGuide 롱프레스 임시 진입점으로 미리보기.
// TODO: 정산 result 기반 실데이터(이전/새 티어, 시간, 보너스) 연결.
// 승격 큰 뱃지는 시안의 별 사각형 대신 tier 일러스트(tiers.ts image) — 계획서에서 확정.

// mock: 승격 3→4 / 유지 4 / 강등 4→3 (시안 연출 기준)
const PROMOTE_TO = 4;
const DEMOTE_FROM = 4;
const MAINTAIN_AT = 4;
// mock: 승격 주 집중 시간(디자인 미리보기) — 갓생러(42–56h) 구간 안의 값
const PROMOTE_WEEK_HOURS = 48;

export default function LeagueResultScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<V2RootStackParamList, 'LeagueResult'>>();
  const promote = route.params.type === 'promote';
  const maintain = route.params.type === 'maintain';

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

  // 승격 등장 연출(승격 화면만):
  // ① 기존 뱃지+이름 노출 → ②③ 뱃지 전환과 동시에 화살표+승격 티어명 등장(showTo)
  // → ④ 타이틀 팝 → ⑤ 문구 한 줄씩 탕탕
  const badgeAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const nameAnim = useRef(new Animated.Value(0)).current;
  const line3 = useRef(new Animated.Value(0)).current;
  const [showTo, setShowTo] = useState(false);
  useEffect(() => {
    if (!promote) return;
    let cancelled = false;
    setShowTo(false);
    [badgeAnim, titleAnim, nameAnim, line3].forEach((v) => v.setValue(0));
    // ① 기존 뱃지·이름 잠깐 노출
    const hold = Animated.delay(1100);
    hold.start(({ finished }) => {
      if (!finished || cancelled) return;
      // ②③ 뱃지 전환과 '동시에' 화살표 + 승격 티어명 등장(showTo)
      LayoutAnimation.configureNext(
        LayoutAnimation.create(
          500,
          LayoutAnimation.Types.easeInEaseOut,
          LayoutAnimation.Properties.opacity,
        ),
      );
      setShowTo(true);
      // ② 뱃지 전환(1.2초)은 배경에서 병렬 진행
      Animated.timing(badgeAnim, {
        toValue: 1,
        duration: 1200,
        easing: Easing.out(Easing.back(1.2)),
        useNativeDriver: true,
      }).start();
      // ③ 새 티어명 화려하게 팝인 — 작게서 튀어오르는 스프링(뱃지 전환과 동시)
      Animated.spring(nameAnim, {
        toValue: 1,
        friction: 5,
        tension: 120,
        useNativeDriver: true,
      }).start();
      // ④ 갓생러 팝 0.2초 뒤 타이틀 팝 → ⑤ 하단 안내 문구 등장
      Animated.sequence([
        Animated.delay(200),
        Animated.timing(titleAnim, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(line3, { toValue: 1, friction: 5, tension: 150, useNativeDriver: true }),
      ]).start();
    });
    return () => {
      cancelled = true;
      hold.stop();
    };
  }, [promote, badgeAnim, titleAnim, nameAnim, line3]);

  const to = tierByLevel(promote ? PROMOTE_TO : DEMOTE_FROM - 1);
  const from = tierByLevel(DEMOTE_FROM);
  const stay = tierByLevel(MAINTAIN_AT);

  // 승격: 이전 티어(승격 전) + 다음 리그(한 단계 위) 안내값
  const promoteFrom = tierByLevel(PROMOTE_TO - 1);
  const promoteNext = to.maxHours != null ? tierByLevel(to.level + 1) : null;
  const promoteNextRemain = promoteNext
    ? Math.max(promoteNext.minHours - PROMOTE_WEEK_HOURS, 0)
    : 0;

  // 승격 뱃지 전환 보간 — 이전 티어(fade out·축소) → 승격 티어(fade in·팝)
  const fromOpacity = badgeAnim.interpolate({
    inputRange: [0, 0.5],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const fromScale = badgeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.7],
    extrapolate: 'clamp',
  });
  const toOpacity = badgeAnim.interpolate({
    inputRange: [0.25, 1],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const toScale = badgeAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  // 새 티어명 팝인 — 작게(0.4x)서 튀어오르는 스케일(스프링 오버슈트)
  const nameScale = nameAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  // 타이틀 등장 — 크게(1.5x) 나타났다 현재 크기로 축소
  const titleOpacity = titleAnim.interpolate({
    inputRange: [0, 0.4],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const titleScale = titleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1.5, 1],
    extrapolate: 'clamp',
  });
  // 아래 문구 한 줄 — 페이드 + 팝(탕)
  const lineStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
  });

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
              {/* PROMOTED·승격했어요! — 뱃지 전환 뒤 크게 나타났다 현재 크기로 축소 */}
              <Animated.View
                style={[
                  s.titleGroup,
                  { opacity: titleOpacity, transform: [{ scale: titleScale }] },
                ]}
              >
                <Text style={s.caption}>PROMOTED</Text>
                <Text style={s.title}>승격했어요!</Text>
              </Animated.View>

              {/* 큰 티어 뱃지 + 글로우 — 이전 티어 → 승격 티어 크로스페이드 전환 */}
              <View style={s.glow}>
                <View style={s.badgeStack}>
                  <Animated.Image
                    source={promoteFrom.image}
                    style={[
                      s.badgeImg,
                      s.badgeAbs,
                      { opacity: fromOpacity, transform: [{ scale: fromScale }] },
                    ]}
                  />
                  <Animated.Image
                    source={to.image}
                    style={[s.badgeImg, { opacity: toOpacity, transform: [{ scale: toScale }] }]}
                  />
                </View>
              </View>

              {/* 뱃지 아래 티어명 — 기존 뱃지 땐 그 이름만 가운데, 승격 후 화살표+승격 티어명 화려하게 등장 */}
              <View style={s.tierChange}>
                <Text style={showTo ? s.tierFrom : s.tierName}>{promoteFrom.name}</Text>
                {showTo && (
                  <Animated.View
                    style={[
                      s.tierToGroup,
                      { opacity: nameAnim, transform: [{ scale: nameScale }] },
                    ]}
                  >
                    <Ionicons name="arrow-forward" size={22} color={T.night.muted} />
                    <Text style={s.tierName}>{to.name}</Text>
                  </Animated.View>
                )}
              </View>
            </>
          ) : maintain ? (
            <>
              <Text style={[s.caption, s.captionMuted]}>한 주 마감 · WEEK CLOSED</Text>
              <Text style={[s.title, s.titleDemote]}>자리를 지켰어요</Text>

              {/* 둥실 떠다니는 마스코트 */}
              <Animated.View style={{ transform: [{ translateY: float }] }}>
                <CharacterImage size={108} />
              </Animated.View>

              {/* 현재 티어 유지 — 단일 뱃지 */}
              <View style={s.stayBadge}>
                <TierBadge level={stay.level} size={56} />
              </View>
              <Text style={s.tierLeague}>{stay.name} 리그 · 유지</Text>
              <Text style={s.desc}>
                이번 주도 {stay.name} 기준을 지켜냈어요.{'\n'}
                다음 주엔 승격까지 노려봐요!
              </Text>

              <View style={[s.pill, s.pillDemote]}>
                <Ionicons name="arrow-up" size={14} color={T.accentLight} />
                <Text style={[s.pillText, s.pillTextDemote]} allowFontScaling={false}>
                  다음 주 +6시간이면 승격 도전
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

        {/* 다음 티어까지 한 줄 안내 — CTA 바로 위 (승격만) */}
        {promote && (
          <Animated.Text style={[s.goalHint, lineStyle(line3)]}>
            {promoteNext != null ? (
              <>
                저번 주보다 <Text style={s.goalStrong}>{promoteNextRemain}시간</Text> 더 집중하면
                다음 티어로 올라갈 수 있어요!
              </>
            ) : (
              '이미 최고 티어예요!'
            )}
          </Animated.Text>
        )}

        {/* ── 하단 CTA ── */}
        <TouchableOpacity style={s.cta} activeOpacity={0.85} onPress={() => navigation.goBack()}>
          <Text style={s.ctaText}>
            {promote ? '새 리그 보러가기' : maintain ? '이어서 달리기' : '이번 주 다시 시작'}
          </Text>
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

  titleGroup: { alignItems: 'center' },
  caption: {
    ...T.text.label,
    fontWeight: '700',
    color: T.accentLight,
    letterSpacing: 2,
    marginBottom: 8,
  },
  captionMuted: { ...T.text.caption, fontWeight: '700', color: T.night.muted },
  title: {
    ...T.text.display,
    fontSize: 40,
    lineHeight: 46,
    color: T.night.cream,
    marginBottom: 24,
  },
  titleDemote: { ...T.text.title, marginBottom: 22 },

  glow: {
    padding: 18,
    borderRadius: 999,
    backgroundColor: withAlpha(T.night.gold, 0.16),
    marginBottom: 24,
    shadowColor: T.night.gold,
    shadowOpacity: 0.55,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },
  badgeImg: { width: 190, height: 190, resizeMode: 'contain' },
  badgeStack: { width: 190, height: 190, alignItems: 'center', justifyContent: 'center' },
  badgeAbs: { position: 'absolute' },
  tierChange: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tierToGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tierFrom: { ...T.text.subtitle, fontSize: 22, color: T.night.muted },
  tierName: { ...T.text.title, fontSize: 30, color: T.night.cream },

  // 강등·유지 화면 설명 문구
  desc: {
    ...T.text.label,
    fontWeight: '500',
    lineHeight: 24,
    color: T.accentLight,
    textAlign: 'center',
    marginTop: 10,
  },

  // 승격 다음 티어 안내 — CTA 바로 위 한 줄 힌트(숫자 금색 강조)
  goalHint: {
    ...T.text.caption,
    fontWeight: '600',
    color: T.accentLight,
    textAlign: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  goalStrong: { fontWeight: '800', color: T.night.gold },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: withAlpha(T.accent, 0.2),
    borderWidth: 1,
    borderColor: withAlpha(T.accent, 0.45),
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
    marginTop: 22,
  },
  pillDemote: { backgroundColor: withAlpha(T.accent, 0.16), borderColor: withAlpha(T.accent, 0.4) },
  pillText: { ...T.text.label, fontWeight: '700', color: T.night.gold },
  pillTextDemote: { ...T.text.caption, fontWeight: '700', color: T.accentLight },

  stayBadge: { alignItems: 'center', marginTop: 18, marginBottom: 2 },
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
