import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { useFocus } from '../contexts/FocusContext';
import { useEquipment } from '../contexts/EquipmentContext';
import { useCoins } from '../contexts/CoinContext';
import { Character2D } from '../components/character/Character2D';
import { T, inkBox } from '../components/theme';
import { apiFetch } from '../utils/api';

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
}

const VARIANT_MSG = {
  default: '열심히 집중 중!',
  focus: '노트북 켜고 집중 중... 🖥',
  reading: '책 읽으면서 집중 중... 📚',
  yoga: '요가하면서 마음 집중 중... 🧘',
  exercise: '운동하면서 집중 중... 💪',
  study: '문제집 풀면서 집중 중... ✏',
};

const MOTION = {
  default: { axis: 'y', range: 4, duration: 1800, easing: Easing.inOut(Easing.sin) },
  focus: { axis: 'y', range: 2.5, duration: 250, easing: Easing.linear },
  reading: { axis: 'rotate', range: 4, duration: 2400, easing: Easing.inOut(Easing.sin) },
  yoga: { axis: 'scale', range: 0.05, duration: 3200, easing: Easing.inOut(Easing.sin) },
  exercise: { axis: 'y', range: 14, duration: 500, easing: Easing.out(Easing.quad) },
  study: { axis: 'x', range: 3.5, duration: 180, easing: Easing.linear },
};

const REST_L = -30;
const REST_R = 30;

const ARM_CONFIGS = {
  default: null,
  focus: { l: [-40, REST_L], r: [40, REST_R], dur: 160, easing: Easing.linear, sync: false },
  reading: { l: null, r: [60, REST_R], dur: 1100, easing: Easing.inOut(Easing.sin), sync: true },
  yoga: {
    l: [-145, REST_L],
    r: [145, REST_R],
    dur: 2600,
    easing: Easing.inOut(Easing.sin),
    sync: true,
  },
  exercise: {
    l: [-100, REST_L],
    r: [100, REST_R],
    dur: 480,
    easing: Easing.out(Easing.quad),
    sync: true,
  },
  study: { l: null, r: [45, 20], dur: 170, easing: Easing.linear, sync: true },
};

function makeArmLoop(val, [to, from], dur, easing) {
  return Animated.loop(
    Animated.sequence([
      Animated.timing(val, { toValue: to, duration: dur, easing, useNativeDriver: true }),
      Animated.timing(val, { toValue: from, duration: dur * 0.9, easing, useNativeDriver: true }),
    ]),
  );
}

function AnimatedCharacter({ variant, size }) {
  const bodyAnim = useRef(new Animated.Value(0)).current;
  const leftArm = useRef(new Animated.Value(REST_L)).current;
  const rightArm = useRef(new Animated.Value(REST_R)).current;

  useEffect(() => {
    bodyAnim.setValue(0);
    leftArm.setValue(REST_L);
    rightArm.setValue(REST_R);

    const bodyCfg = MOTION[variant] ?? MOTION.default;
    const bodyLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(bodyAnim, {
          toValue: 1,
          duration: bodyCfg.duration,
          easing: bodyCfg.easing,
          useNativeDriver: true,
        }),
        Animated.timing(bodyAnim, {
          toValue: -1,
          duration: bodyCfg.duration,
          easing: bodyCfg.easing,
          useNativeDriver: true,
        }),
      ]),
    );
    bodyLoop.start();

    const armCfg = ARM_CONFIGS[variant];
    const armLoops = [];
    if (armCfg) {
      if (armCfg.l) {
        const lp = makeArmLoop(leftArm, armCfg.l, armCfg.dur, armCfg.easing);
        armLoops.push(lp);
        lp.start();
      }
      if (armCfg.r) {
        const lp = makeArmLoop(rightArm, armCfg.r, armCfg.dur, armCfg.easing);
        armLoops.push(lp);
        // focus: right arm starts half a cycle out of phase for alternating effect
        if (!armCfg.sync) {
          Animated.delay(armCfg.dur).start(() => lp.start());
        } else {
          lp.start();
        }
      }
    }

    return () => {
      bodyLoop.stop();
      armLoops.forEach((l) => l.stop());
    };
  }, [variant, bodyAnim, leftArm, rightArm]);

  const bodyCfg = MOTION[variant] ?? MOTION.default;
  let bodyStyle;
  if (bodyCfg.axis === 'y')
    bodyStyle = {
      transform: [
        {
          translateY: bodyAnim.interpolate({
            inputRange: [-1, 1],
            outputRange: [-bodyCfg.range, bodyCfg.range],
          }),
        },
      ],
    };
  else if (bodyCfg.axis === 'x')
    bodyStyle = {
      transform: [
        {
          translateX: bodyAnim.interpolate({
            inputRange: [-1, 1],
            outputRange: [-bodyCfg.range, bodyCfg.range],
          }),
        },
      ],
    };
  else if (bodyCfg.axis === 'rotate')
    bodyStyle = {
      transform: [
        {
          rotate: bodyAnim.interpolate({
            inputRange: [-1, 1],
            outputRange: [`-${bodyCfg.range}deg`, `${bodyCfg.range}deg`],
          }),
        },
      ],
    };
  else
    bodyStyle = {
      transform: [
        {
          scale: bodyAnim.interpolate({
            inputRange: [-1, 1],
            outputRange: [1 - bodyCfg.range, 1 + bodyCfg.range],
          }),
        },
      ],
    };

  return (
    <Animated.View style={bodyStyle}>
      <Character2D size={size} variant={variant} leftArmAngle={leftArm} rightArmAngle={rightArm} />
    </Animated.View>
  );
}

const VARIANT_CARD_COLOR = {
  default: T.paperDark,
  focus: T.sky,
  reading: T.yellow,
  yoga: T.mint,
  exercise: T.coral,
  study: T.lavender,
};

export default function FocusModeScreen({ navigation, route }) {
  const { tagId, tagName, subject } = route.params ?? {};
  const { todayFocusSeconds, addFocusSeconds } = useFocus();
  const { equippedItem } = useEquipment();
  const { addCoins } = useCoins();
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const startTimeRef = useRef(null);
  const startedAtRef = useRef(null);
  const lastCoinRef = useRef(0);
  const addCoinsRef = useRef(addCoins);
  useEffect(() => {
    addCoinsRef.current = addCoins;
  }, [addCoins]);

  const variant = equippedItem?.focusVariant ?? 'default';
  const msg = VARIANT_MSG[variant] ?? VARIANT_MSG.default;
  const cardColor = VARIANT_CARD_COLOR[variant] ?? T.paperDark;

  useFocusEffect(
    React.useCallback(() => {
      startTimeRef.current = Date.now();
      startedAtRef.current = new Date().toISOString();
      lastCoinRef.current = 0;
      setSessionSeconds(0);
      const id = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setSessionSeconds(elapsed);
        const earned = Math.floor(elapsed / 10);
        if (earned > lastCoinRef.current) {
          addCoinsRef.current(earned - lastCoinRef.current);
          lastCoinRef.current = earned;
        }
      }, 1000);
      return () => clearInterval(id);
    }, []),
  );

  async function handleStop() {
    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const endedAt = new Date().toISOString();

    addFocusSeconds(elapsed);

    try {
      await apiFetch('/api/v1/focus-session', {
        method: 'POST',
        body: JSON.stringify({
          focusTagId: tagId ?? null,
          subject: subject ?? null,
          startedAt: startedAtRef.current,
          endedAt,
          distractionCount: 0,
          totalDistractionSeconds: 0,
        }),
      });
    } catch (e) {
      console.error('[세션 저장 실패]', e);
    }

    navigation.navigate('홈', {
      focusResult: {
        sessionSeconds: elapsed,
        totalSeconds: todayFocusSeconds + elapsed,
        coinsEarned: Math.floor(elapsed / 10),
        tagName: tagName ?? null,
        subject: subject ?? null,
      },
    });
  }

  return (
    <View style={s.container}>
      <StatusBar style="dark" />

      {/* 헤더 */}
      <View style={s.headerRow}>
        <View>
          <Text style={s.pageLabel}>✏ 집중 중이에요</Text>
          {(tagName || subject) && (
            <Text style={s.sessionInfo}>
              {tagName}{tagName && subject ? '  ·  ' : ''}{subject}
            </Text>
          )}
        </View>
        <Text style={s.decoStar}>★ ★</Text>
      </View>

      {/* 현재 세션 타이머 */}
      <View style={[s.timerCard, inkBox(T.yellow)]}>
        <Text style={s.timerSmall}>현재 세션</Text>
        <Text style={s.timerText}>{formatTime(sessionSeconds)}</Text>
      </View>

      {/* 캐릭터 */}
      <View style={[s.charCard, inkBox(cardColor, '-0.8deg')]}>
        <Text style={s.charMsg}>{msg}</Text>
        <View style={s.charInner}>
          <AnimatedCharacter size={200} variant={variant} />
        </View>
      </View>

      {/* 오늘 누적 — compact 한 줄 */}
      <View style={s.accumRow}>
        <Text style={s.accumLabel}>오늘 누적 ⏱</Text>
        <Text style={s.accumTime}>{formatTime(todayFocusSeconds + sessionSeconds)}</Text>
      </View>

      {/* 중지 */}
      <TouchableOpacity style={s.stopBtn} onPress={handleStop} activeOpacity={0.7}>
        <Text style={s.stopBtnText}>중지하기</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.paper,
    paddingTop: 56,
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  pageLabel: { fontSize: 20, fontWeight: '900', color: T.ink },
  sessionInfo: { fontSize: 13, fontWeight: '600', color: T.inkMed, marginTop: 2 },
  decoStar: { fontSize: 14, color: T.inkLight, letterSpacing: 4 },

  timerCard: {
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  timerSmall: { fontSize: 13, fontWeight: '700', color: T.inkMed, marginBottom: 2 },
  timerText: { fontSize: 56, fontWeight: '900', color: T.ink, letterSpacing: -2 },

  charCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  charMsg: { fontSize: 13, fontWeight: '700', color: T.inkMed, marginBottom: 6 },
  charInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  accumRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 16,
  },
  accumLabel: { fontSize: 13, fontWeight: '700', color: T.inkMed },
  accumTime: { fontSize: 18, fontWeight: '900', color: T.ink, letterSpacing: -0.5 },

  stopBtn: {
    backgroundColor: T.ink,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  stopBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },

});
