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
import { CURRENCY } from '@/constants/currency';
import { tierByLevel } from '@/constants/tiers';
import { ConfettiBurst } from '@/components/ConfettiBurst';
import { useMotion } from '@/hooks/useMotion';
import { hapticSuccess } from '@/utils/haptics';
import { ackLastResult } from '@/services/leagueApi';
import type { V2RootStackParamList } from '@/navigation/types';

// 강등 시 '깨진 뱃지' 중간 연출 이미지 — 강등 전(from) 티어별(tierNdown.png)
const DOWN_IMAGES: Record<number, ImageSourcePropType> = {
  2: require('@/assets/tier_image/tier2down.png'),
  3: require('@/assets/tier_image/tier3down.png'),
  4: require('@/assets/tier_image/tier4down.png'),
  5: require('@/assets/tier_image/tier5down.png'),
};

// 승격/유지/강등 연출 (root stack, 풀스크린 다크 radial) — 세 타입 동일 포맷.
// 데이터는 주간 정산 실결과(GET /league/me/last-result) — 리그 탭 포커스 훅(useLeagueLastResult)이
// 매핑해 params로 넘기고, 화면이 닫힐 때 ack로 확인 처리해 재노출을 막는다 (GROMO-831).
// 뱃지 큰 일러스트는 tiers.ts image 공용. 전환형(승격·강등)은 이전→새 티어 크로스페이드,
// 유지형은 전환 없이 현재 티어 단일 등장.

// 컨페티가 실제로 화면에 남아 있는 시간(ms) — ConfettiBurst 조각의 최대 수명에서 계산했다.
// 시작 지연 BASE_DELAY 250 + 흔들림 350 + 낙하 duration 최대 2500 = 3100, 여기에 여유 100.
// 장애물(obstacle)을 주지 않으므로 조각은 전부 바닥까지 떨어지고 쌓이는 조각이 없다.
const CONFETTI_LIFE_MS = 3200;

// 타입별 연출 텍스트 — 티어·시간은 params 실데이터, 여기는 표시 문구만
const TYPE_CFG = {
  promote: { caption: 'PROMOTED', title: '승격했어요!', cta: '새 리그 보러가기' },
  maintain: { caption: 'MAINTAINED', title: '자리를 지켰어요', cta: '이어서 달리기' },
  demote: { caption: 'DEMOTED', title: '한 단계 내려갔어요', cta: '이번 주 다시 시작' },
} as const;

export default function LeagueResultScreen() {
  const navigation = useNavigation();
  // '동작 줄이기' 게이트 (GROMO-1381). 이 화면은 **단계 시퀀스**라 타이머를 걷어내면 안 된다 —
  // m.delay()는 대기 시간을 0으로 만들 뿐 타이머 자체는 남겨서 시퀀스가 끝까지 완주한다.
  //
  // ⚠️ 이 화면의 LayoutAnimation(아래 티어명 등장)은 이번에 걷어내지 않는다 (결정 D-26).
  //    단계 시퀀스·레거시 Animated와 얽혀 있어 같은 PR에서 제거하면 승급/강등 연출 회귀 위험이
  //    크다. 대신 이 화면에는 Reanimated 레이아웃 애니메이션을 **추가하지 않아**(랭킹 행의
  //    rankSwap 같은 것) 두 시스템이 같은 트리에서 부딪히는 조건 자체를 만들지 않는다.
  const m = useMotion();
  const route = useRoute<RouteProp<V2RootStackParamList, 'LeagueResult'>>();
  const { type, fromLevel, toLevel, weekHours, weekStartAt, promotionBonusCoins } = route.params;
  const cfg = TYPE_CFG[type];
  // 승급 보상 시간조각 — 서버가 실어 보낸 값만 쓴다(GROMO-1193). 클라 공식 폴백은 BE 머지 전
  // 임시 조치였는데, BE가 값을 내리는 지금은 **서버가 진짜 0을 준 경우**(지급 실패·미지급)에도
  // 공식으로 금액을 지어내 유령 배지를 띄운다.
  const bonusCoins = promotionBonusCoins ?? 0;
  const showBonus = type === 'promote' && bonusCoins > 0;

  // 닫힐 때(CTA·제스처 모두 unmount 경유) 확인 처리 — 실패하면 리그 탭 재포커스 때
  // useLeagueLastResult가 미확인 상태를 감지해 재노출 없이 ack만 재시도한다(멱등)
  useEffect(() => {
    return () => {
      ackLastResult(weekStartAt).catch(() => {});
    };
  }, [weekStartAt]);

  const fromTier = tierByLevel(fromLevel);
  const toTier = tierByLevel(toLevel);
  const hasTransition = fromLevel !== toLevel;
  const positive = toLevel >= fromLevel; // 승격·유지 = 반짝이 노출
  const demote = toLevel < fromLevel; // 강등 = 3단계(깨진 뱃지) 연출
  const downImage = demote ? DOWN_IMAGES[fromLevel] : null;

  // 다음 티어(현재 결과 티어의 한 단계 위)까지 저번 주 대비 남은 시간.
  // tiers.ts minHours는 백엔드 승급 기준 promotion_time(V13 시드, 14/28/42/56h)과 일치 확인됨.
  // weekHours가 소수라 표시용 남은 시간은 올림 — 'N시간 더'가 실제 도달 기준을 밑돌지 않게.
  const nextUp = toTier.maxHours != null ? tierByLevel(toTier.level + 1) : null;
  const nextRemain = nextUp ? Math.max(Math.ceil(nextUp.minHours - weekHours), 0) : 0;

  // 등장 연출:
  // ① (전환형) 기존 뱃지 잠깐 노출 / (유지형) 짧게 대기
  // → ②③ 뱃지 전환·등장 + 티어명 팝 → ④ 0.2초 뒤 타이틀 팝 → ⑤ 하단 안내
  const badgeAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const nameAnim = useRef(new Animated.Value(0)).current;
  const line3 = useRef(new Animated.Value(0)).current;
  const [showTo, setShowTo] = useState(false);
  // 승급 축하 파티클 — 결과 뱃지가 완전히 도착한 뒤에만 터진다(시퀀스 후).
  const [celebrate, setCelebrate] = useState(false);
  // ⚠️ m을 effect 의존성에 넣지 않는다 — 아래 시퀀스 effect 주석 참고. 대신 최신 delay를 ref로 읽는다.
  const delayRef = useRef(m.delay);
  delayRef.current = m.delay;
  // 축하(햅틱·컨페티)는 화면당 1회. 시퀀스가 어떤 이유로 다시 돌더라도 보상 피드백은 반복하지 않는다.
  const celebratedRef = useRef(false);
  // 조각이 전부 화면 밖으로 나가면 컨페티를 **언마운트**한다. 남겨 두면 조각이 안 보이는 뒤로도
  // 중력 센서 구독과 매 프레임 적분(useFrameCallback)이 CTA를 누를 때까지 계속 돈다(codex 리뷰).
  //
  // ⚠️ 이 대기에는 m.delay()를 통과시키지 않는다 — 연출을 기다리는 호흡이 아니라 연출이 **끝나는
  //    시각**이라, 0으로 눌리면 컨페티가 뜨자마자 사라진다. reduce에서는 ConfettiBurst가 스스로
  //    렌더하지 않으므로 이 타이머가 헛돌아도 보이는 것이 없다.
  useEffect(() => {
    if (!celebrate) return undefined;
    const t = setTimeout(() => setCelebrate(false), CONFETTI_LIFE_MS);
    // 화면을 떠난 뒤에 타이머가 돌지 않게 반드시 걷는다.
    return () => clearTimeout(t);
  }, [celebrate]);
  useEffect(() => {
    let cancelled = false;
    setShowTo(false);
    setCelebrate(false);
    [badgeAnim, titleAnim, nameAnim, line3].forEach((v) => v.setValue(0));
    // 대기 시간(1100·300)·뱃지 전환 길이(2000·1200)·강등 지연(1500)은 연출 호흡이라 값을 그대로 둔다.
    // reduce일 때만 m.delay가 0으로 눌러 단계가 즉시 이어진다(타이머는 남는다).
    const hold = Animated.delay(delayRef.current(hasTransition ? 1100 : 300));
    hold.start(({ finished }) => {
      if (!finished || cancelled) return;
      // 뱃지 전환/등장 시작 (배경 병렬) — 강등은 3단계라 더 길게·균등하게
      Animated.timing(badgeAnim, {
        toValue: 1,
        duration: delayRef.current(demote ? 2000 : 1200),
        easing: demote ? Easing.inOut(Easing.ease) : Easing.out(Easing.back(1.2)),
        useNativeDriver: true,
      }).start(({ finished: fb }) => {
        // 승급만 축하한다 — 결과 뱃지가 다 뜬 순간이 이 화면의 정점이다.
        // hapticSuccess는 notification 계열 "따-단" 2박자라 **축하 표면 전용**이다.
        // (파티클은 '동작 줄이기'에서 ConfettiBurst가 스스로 생략한다 — 여기서 다시 분기하지 않는다.)
        if (!fb || cancelled || type !== 'promote') return;
        setCelebrate(true);
        if (!celebratedRef.current) {
          celebratedRef.current = true;
          hapticSuccess();
        }
      });
      // 결과 티어명 등장 — 승격·유지는 전환과 동시에, 강등은 결과(to) 뱃지가 뜨는 시점(≈1.5초)에 맞춰
      Animated.delay(delayRef.current(demote ? 1500 : 0)).start(({ finished: f2 }) => {
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
    // ⚠️ m을 의존성에서 뺀다. 넣으면 '동작 줄이기'가 바뀔 때(초기 비동기 조회가 true→false로
    //    확정되는 경우 포함) 이 effect가 다시 돌아 **이미 끝난 화면의 시퀀스를 처음부터 재생**하고,
    //    승급이면 hapticSuccess·컨페티까지 다시 발생한다 — 보상 피드백이 중복된다(codex 리뷰).
    //    대기 값은 delayRef로 타이머를 걸 때의 최신 값을 읽고, 축하는 celebratedRef로 1회만 낸다.
  }, [type, hasTransition, demote, badgeAnim, titleAnim, nameAnim, line3]);

  // '동작 줄이기'가 **재생 도중** 켜진 경우 — 위 시퀀스 effect는 다시 돌지 않고(의존성에서 뺐다),
  // delayRef는 **앞으로 새로 만들 단계**의 대기만 줄인다. 이미 시작된 delay·timing·spring은
  // 그대로 끝까지 돈다. 그래서 여기서 진행 중인 것을 세우고 최종 상태로 점프시킨다.
  //
  // ⚠️ **꺼짐 → 켜짐 전이에서만** 동작한다(첫 실행은 건너뛴다). useReduceMotion은 비동기 조회가
  //    끝나기 전 구간을 보수적으로 true로 읽으므로, 마운트 시점의 true까지 '즉시 완료'로 처리하면
  //    설정을 켜지 않은 사용자도 확정(true→false) 전에 연출을 통째로 잃는다.
  // ⚠️ 축하 피드백은 재발행하지 않는다 — celebratedRef가 이미 서 있으면 건너뛴다. 다만 진행 중이던
  //    뱃지 전환을 세우면 그 완료 콜백이 finished:false로 끝나 승급 축하 경로가 **끊기므로**,
  //    아직 안 냈다면 여기서 한 번 낸다(정책 D7 — 축하는 reduce에서도 유지되고 파티클만 생략된다.
  //    파티클 생략은 ConfettiBurst가 스스로 처리하므로 여기서 분기하지 않는다).
  const prevReduceRef = useRef(m.reduce);
  useEffect(() => {
    const turnedOn = !prevReduceRef.current && m.reduce;
    prevReduceRef.current = m.reduce;
    if (!turnedOn) return;
    // 모든 값의 목표는 1이다(뱃지 전환·티어명 팝·타이틀 팝·하단 안내). 이미 끝난 뒤라면 no-op.
    [badgeAnim, titleAnim, nameAnim, line3].forEach((v) => {
      v.stopAnimation();
      v.setValue(1);
    });
    setShowTo(true);
    if (type === 'promote' && !celebratedRef.current) {
      celebratedRef.current = true;
      hapticSuccess();
    }
  }, [m.reduce, type, badgeAnim, titleAnim, nameAnim, line3]);

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

        {/* 승급 보상 시간조각 배지 — 하단 안내와 같은 등장 애니메이션(line3) */}
        {showBonus ? (
          <Animated.View style={[s.bonusBadge, lineStyle(line3)]}>
            <Text style={s.bonusText}>
              +{bonusCoins.toLocaleString()} {CURRENCY.label}
            </Text>
          </Animated.View>
        ) : null}

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

      {/* 승급 축하 종이폭죽 — 뱃지 전환이 끝난 뒤 화면 전체에 흩뿌린다(장애물 없음).
          기존 컴포넌트를 그대로 재사용한다. pointerEvents는 ConfettiBurst 내부에서 none. */}
      {celebrate && <ConfettiBurst />}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.night.bottom },
  safe: { flex: 1, paddingHorizontal: T.space.xxl },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: T.space.sm },

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
    marginBottom: T.space.sm,
  },
  title: {
    ...T.text.display,
    fontSize: 40,
    lineHeight: 46,
    color: T.night.cream,
    marginBottom: T.space.xxl,
  },

  glow: {
    padding: T.space.xl,
    borderRadius: 999,
    backgroundColor: withAlpha(T.night.gold, 0.16),
    marginBottom: T.space.xxl,
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
  tierChange: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  tierToGroup: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  tierFrom: { ...T.text.subtitle, fontSize: 22, color: T.night.muted },
  tierName: { ...T.text.title, fontSize: 30, color: T.night.cream },

  // 다음 티어 안내 — CTA 바로 위 한 줄 힌트(숫자 금색 강조)
  goalHint: {
    ...T.text.caption,
    fontWeight: '600',
    color: T.accentLight,
    textAlign: 'center',
    paddingHorizontal: T.space.lg,
    marginBottom: T.space.md,
  },
  goalStrong: { fontWeight: '800', color: T.night.gold },

  // 승급 보상 시간조각 배지(+N 시간조각) — 골드 pill(다크 배경 대비)
  bonusBadge: {
    alignSelf: 'center',
    backgroundColor: withAlpha(T.night.gold, 0.16),
    borderRadius: 999,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.sm,
    marginBottom: T.space.md,
  },
  bonusText: { ...T.text.label, fontWeight: '800', color: T.night.gold },

  cta: {
    height: 56,
    borderRadius: 18,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: T.space.xxl,
  },
  ctaText: { ...T.text.body, fontWeight: '700', color: T.white },
});
