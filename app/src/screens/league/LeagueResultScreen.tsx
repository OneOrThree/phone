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
import type { ImageSourcePropType } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { T, withAlpha } from '@/constants/theme';
import { tierByLevel } from '@/constants/tiers';
import type { V2RootStackParamList } from '@/navigation/types';

// 강등 시 '깨진 뱃지' 중간 연출 이미지 — 강등 전(from) 티어별(tierNdown.png)
const DOWN_IMAGES: Record<number, ImageSourcePropType> = {
  2: require('@/assets/tier_image/tier2down.png'),
  3: require('@/assets/tier_image/tier3down.png'),
  4: require('@/assets/tier_image/tier4down.png'),
  5: require('@/assets/tier_image/tier5down.png'),
};

// 승격/유지/강등 연출 (root stack, 풀스크린 다크 radial) — 세 타입 동일 포맷.
// 실제 트리거는 주간 정산 result(TODO) — 지금은 dev 메뉴 임시 진입점으로 미리보기.
// 뱃지 큰 일러스트는 tiers.ts image 공용. 전환형(승격·강등)은 이전→새 티어 크로스페이드,
// 유지형은 전환 없이 현재 티어 단일 등장.

// mock: 타입별 티어 전환·주간 집중시간(디자인 미리보기)
//  - 승격 3→4(48h) · 유지 4(48h) · 강등 4→3(38h)
const RESULT_CFG = {
  promote: {
    fromLevel: 3,
    toLevel: 4,
    weekHours: 48,
    caption: 'PROMOTED',
    title: '승격했어요!',
    cta: '새 리그 보러가기',
  },
  maintain: {
    fromLevel: 4,
    toLevel: 4,
    weekHours: 48,
    caption: 'MAINTAINED',
    title: '자리를 지켰어요',
    cta: '이어서 달리기',
  },
  demote: {
    fromLevel: 4,
    toLevel: 3,
    weekHours: 38,
    caption: 'DEMOTED',
    title: '한 단계 내려갔어요',
    cta: '이번 주 다시 시작',
  },
} as const;

export default function LeagueResultScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<V2RootStackParamList, 'LeagueResult'>>();
  const cfg = RESULT_CFG[route.params.type];

  const fromTier = tierByLevel(cfg.fromLevel);
  const toTier = tierByLevel(cfg.toLevel);
  const hasTransition = cfg.fromLevel !== cfg.toLevel;
  const positive = cfg.toLevel >= cfg.fromLevel; // 승격·유지 = 반짝이 노출
  const demote = cfg.toLevel < cfg.fromLevel; // 강등 = 3단계(깨진 뱃지) 연출
  const downImage = demote ? DOWN_IMAGES[cfg.fromLevel] : null;

  // 다음 티어(현재 결과 티어의 한 단계 위)까지 저번 주 대비 남은 시간
  const nextUp = toTier.maxHours != null ? tierByLevel(toTier.level + 1) : null;
  const nextRemain = nextUp ? Math.max(nextUp.minHours - cfg.weekHours, 0) : 0;

  // 등장 연출:
  // ① (전환형) 기존 뱃지 잠깐 노출 / (유지형) 짧게 대기
  // → ②③ 뱃지 전환·등장 + 티어명 팝 → ④ 0.2초 뒤 타이틀 팝 → ⑤ 하단 안내
  const badgeAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const nameAnim = useRef(new Animated.Value(0)).current;
  const line3 = useRef(new Animated.Value(0)).current;
  const [showTo, setShowTo] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setShowTo(false);
    [badgeAnim, titleAnim, nameAnim, line3].forEach((v) => v.setValue(0));
    const hold = Animated.delay(hasTransition ? 1100 : 300);
    hold.start(({ finished }) => {
      if (!finished || cancelled) return;
      // 뱃지 전환/등장 시작 (배경 병렬) — 강등은 3단계라 더 길게·균등하게
      Animated.timing(badgeAnim, {
        toValue: 1,
        duration: demote ? 2000 : 1200,
        easing: demote ? Easing.inOut(Easing.ease) : Easing.out(Easing.back(1.2)),
        useNativeDriver: true,
      }).start();
      // 결과 티어명 등장 — 승격·유지는 전환과 동시에, 강등은 결과(to) 뱃지가 뜨는 시점(≈1.5초)에 맞춰
      Animated.delay(demote ? 1500 : 0).start(({ finished: f2 }) => {
        if (!f2 || cancelled) return;
        // 티어명(화살표/단일) 등장 — 레이아웃 페이드
        LayoutAnimation.configureNext(
          LayoutAnimation.create(
            500,
            LayoutAnimation.Types.easeInEaseOut,
            LayoutAnimation.Properties.opacity,
          ),
        );
        setShowTo(true);
        // 티어명 팝인
        Animated.spring(nameAnim, {
          toValue: 1,
          friction: 5,
          tension: 120,
          useNativeDriver: true,
        }).start();
        // 티어명 팝 0.2초 뒤 타이틀 팝 → 하단 안내
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
    });
    return () => {
      cancelled = true;
      hold.stop();
    };
  }, [route.params.type, hasTransition, demote, badgeAnim, titleAnim, nameAnim, line3]);

  // 뱃지 전환 보간 — 이전 티어(fade out·축소) → 결과 티어(fade in·팝)
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
  // 강등 3단계 보간 — 티어(from) → 깨진 뱃지(down) → 티어(to, 마지막)
  // 깨짐은 '나타나는' 연출이 아니라 순간 교체(하드 컷): 갓생러가 딱 깨진 뱃지로 바뀐다.
  const dFromOpacity = badgeAnim.interpolate({
    inputRange: [0.28, 0.29],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const dDownOpacity = badgeAnim.interpolate({
    inputRange: [0.28, 0.29, 0.62, 0.78],
    outputRange: [0, 1, 1, 0],
    extrapolate: 'clamp',
  });
  const dToOpacity = badgeAnim.interpolate({
    inputRange: [0.75, 1],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  // 결과 티어명 팝인 — 작게(0.4x)서 튀어오르는 스케일(스프링 오버슈트)
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
  // 하단 안내 한 줄 — 페이드 + 팝(탕)
  const lineStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
  });

  return (
    <View style={s.root}>
      {/* 시안 radial 배경 — expo-linear-gradient엔 radial이 없어 svg로 */}
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="bg" cx="50%" cy="30%" rx="80%" ry="55%">
            <Stop offset="0" stopColor={T.night.top} />
            <Stop offset="1" stopColor={T.night.bottom} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#bg)" />
      </Svg>

      {/* 반짝이 — 긍정 결과(승격·유지)만 */}
      {positive && (
        <>
          <View style={[s.spark, s.spark1]} />
          <View style={[s.spark, s.sparkMilk, s.spark2]} />
          <View style={[s.spark, s.spark3]} />
          <View style={[s.spark, s.sparkMilk, s.spark4]} />
        </>
      )}

      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.body}>
          {/* 타이틀 — 팝 등장 */}
          <Animated.View
            style={[s.titleGroup, { opacity: titleOpacity, transform: [{ scale: titleScale }] }]}
          >
            <Text style={s.caption}>{cfg.caption}</Text>
            <Text style={s.title}>{cfg.title}</Text>
          </Animated.View>

          {/* 큰 티어 뱃지 + 글로우 — 강등 3단계(깨진 뱃지) / 승격 2단계 크로스페이드 / 유지 단일 */}
          <View style={s.glow}>
            <View style={s.badgeStack}>
              {demote ? (
                <>
                  {/* 티어4 → 깨진 뱃지(down) → 티어3 */}
                  <Animated.Image
                    source={fromTier.image}
                    style={[s.badgeImg, s.badgeAbs, { opacity: dFromOpacity }]}
                  />
                  {downImage && (
                    <Animated.Image
                      source={downImage}
                      style={[s.badgeImgDown, s.badgeAbs, { opacity: dDownOpacity }]}
                    />
                  )}
                  <Animated.Image
                    source={toTier.image}
                    style={[s.badgeImg, { opacity: dToOpacity, transform: [{ scale: toScale }] }]}
                  />
                </>
              ) : hasTransition ? (
                <>
                  <Animated.Image
                    source={fromTier.image}
                    style={[
                      s.badgeImg,
                      s.badgeAbs,
                      { opacity: fromOpacity, transform: [{ scale: fromScale }] },
                    ]}
                  />
                  <Animated.Image
                    source={toTier.image}
                    style={[s.badgeImg, { opacity: toOpacity, transform: [{ scale: toScale }] }]}
                  />
                </>
              ) : (
                <Animated.Image
                  source={toTier.image}
                  style={[s.badgeImg, { opacity: toOpacity, transform: [{ scale: toScale }] }]}
                />
              )}
            </View>
          </View>

          {/* 뱃지 아래 티어명 — 전환형은 이전→결과 화살표, 유지형은 단일 */}
          <View style={s.tierChange}>
            {hasTransition ? (
              <>
                <Text style={showTo ? s.tierFrom : s.tierName}>{fromTier.name}</Text>
                {showTo && (
                  <Animated.View
                    style={[
                      s.tierToGroup,
                      { opacity: nameAnim, transform: [{ scale: nameScale }] },
                    ]}
                  >
                    <Ionicons name="arrow-forward" size={22} color={T.night.muted} />
                    <Text style={s.tierName}>{toTier.name}</Text>
                  </Animated.View>
                )}
              </>
            ) : (
              <Animated.Text
                style={[s.tierName, { opacity: nameAnim, transform: [{ scale: nameScale }] }]}
              >
                {toTier.name}
              </Animated.Text>
            )}
          </View>
        </View>

        {/* 다음 티어까지 한 줄 안내 — CTA 바로 위 */}
        <Animated.Text style={[s.goalHint, lineStyle(line3)]}>
          {nextUp == null ? (
            '이미 최고 티어예요!'
          ) : demote ? (
            <>
              저번 주보다 <Text style={s.goalStrong}>{nextRemain}시간</Text> 더 집중하면 원래 티어로
              돌아갈 수 있어요!
            </>
          ) : (
            <>
              저번 주보다 <Text style={s.goalStrong}>{nextRemain}시간</Text> 더 집중하면 다음 티어로
              올라갈 수 있어요!
            </>
          )}
        </Animated.Text>

        {/* ── 하단 CTA ── */}
        <TouchableOpacity style={s.cta} activeOpacity={0.85} onPress={() => navigation.goBack()}>
          <Text style={s.ctaText}>{cfg.cta}</Text>
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
  title: {
    ...T.text.display,
    fontSize: 40,
    lineHeight: 46,
    color: T.night.cream,
    marginBottom: 24,
  },

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
  // 강등 깨진 뱃지(down) — 아트가 작게 그려져 있어 조금 더 크게
  badgeImgDown: { width: 205, height: 205, resizeMode: 'contain' },
  badgeStack: { width: 190, height: 190, alignItems: 'center', justifyContent: 'center' },
  badgeAbs: { position: 'absolute' },
  tierChange: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tierToGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tierFrom: { ...T.text.subtitle, fontSize: 22, color: T.night.muted },
  tierName: { ...T.text.title, fontSize: 30, color: T.night.cream },

  // 다음 티어 안내 — CTA 바로 위 한 줄 힌트(숫자 금색 강조)
  goalHint: {
    ...T.text.caption,
    fontWeight: '600',
    color: T.accentLight,
    textAlign: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  goalStrong: { fontWeight: '800', color: T.night.gold },

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
