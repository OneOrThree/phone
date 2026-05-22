import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { useFocus } from '../contexts/FocusContext';
import { useEquipment } from '../contexts/EquipmentContext';
import { useCoins } from '../contexts/CoinContext';
import { Character2D } from '../components/Character2D';
import { T, inkBox } from '../components/theme';

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
}

const VARIANT_MSG = {
  default:  '열심히 집중 중!',
  focus:    '노트북 켜고 집중 중... 🖥',
  reading:  '책 읽으면서 집중 중... 📚',
  yoga:     '요가하면서 마음 집중 중... 🧘',
  exercise: '운동하면서 집중 중... 💪',
  study:    '문제집 풀면서 집중 중... ✏',
};

const MOTION = {
  default:  { axis: 'y',      range: 4,    duration: 1800, easing: Easing.inOut(Easing.sin) },
  focus:    { axis: 'y',      range: 2.5,  duration: 250,  easing: Easing.linear },
  reading:  { axis: 'rotate', range: 4,    duration: 2400, easing: Easing.inOut(Easing.sin) },
  yoga:     { axis: 'scale',  range: 0.05, duration: 3200, easing: Easing.inOut(Easing.sin) },
  exercise: { axis: 'y',      range: 14,   duration: 500,  easing: Easing.out(Easing.quad) },
  study:    { axis: 'x',      range: 3.5,  duration: 180,  easing: Easing.linear },
};

function AnimatedCharacter({ variant, size }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    anim.setValue(0);
    const cfg = MOTION[variant] ?? MOTION.default;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1,  duration: cfg.duration, easing: cfg.easing, useNativeDriver: true }),
        Animated.timing(anim, { toValue: -1, duration: cfg.duration, easing: cfg.easing, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [variant]);

  const cfg = MOTION[variant] ?? MOTION.default;

  let animStyle;
  if (cfg.axis === 'y') {
    animStyle = { transform: [{ translateY: anim.interpolate({ inputRange: [-1, 1], outputRange: [-cfg.range, cfg.range] }) }] };
  } else if (cfg.axis === 'x') {
    animStyle = { transform: [{ translateX: anim.interpolate({ inputRange: [-1, 1], outputRange: [-cfg.range, cfg.range] }) }] };
  } else if (cfg.axis === 'rotate') {
    animStyle = { transform: [{ rotate: anim.interpolate({ inputRange: [-1, 1], outputRange: [`-${cfg.range}deg`, `${cfg.range}deg`] }) }] };
  } else {
    animStyle = { transform: [{ scale: anim.interpolate({ inputRange: [-1, 1], outputRange: [1 - cfg.range, 1 + cfg.range] }) }] };
  }

  return (
    <Animated.View style={animStyle}>
      <Character2D size={size} variant={variant} />
    </Animated.View>
  );
}

const VARIANT_CARD_COLOR = {
  default:  T.paperDark,
  focus:    T.sky,
  reading:  T.yellow,
  yoga:     T.mint,
  exercise: T.coral,
  study:    T.lavender,
};

export default function FocusModeScreen({ navigation }) {
  const { todayFocusSeconds, addFocusSeconds } = useFocus();
  const { equippedItem } = useEquipment();
  const { addCoins } = useCoins();
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const startTimeRef = useRef(null);
  const lastCoinRef = useRef(0);

  const variant = equippedItem?.focusVariant ?? 'default';
  const msg = VARIANT_MSG[variant] ?? VARIANT_MSG.default;
  const cardColor = VARIANT_CARD_COLOR[variant] ?? T.paperDark;

  useFocusEffect(
    React.useCallback(() => {
      startTimeRef.current = Date.now();
      lastCoinRef.current = 0;
      setSessionSeconds(0);
      const id = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setSessionSeconds(elapsed);
        const earned = Math.floor(elapsed / 10);
        if (earned > lastCoinRef.current) {
          addCoins(earned - lastCoinRef.current);
          lastCoinRef.current = earned;
        }
      }, 1000);
      return () => clearInterval(id);
    }, [])
  );

  function handleStop() {
    addFocusSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    navigation.navigate('홈');
  }

  return (
    <View style={s.container}>
      <StatusBar style="dark" />

      <View style={s.headerRow}>
        <Text style={s.pageLabel}>✏ 집중 중이에요</Text>
        <Text style={s.decoStar}>★ ★</Text>
      </View>

      {/* Timer */}
      <View style={[s.timerCard, inkBox(T.yellow)]}>
        <Text style={s.timerSmall}>현재 세션</Text>
        <Text style={s.timerText}>{formatTime(sessionSeconds)}</Text>
      </View>

      {/* Character */}
      <View style={[s.charCard, inkBox(cardColor, '-0.8deg')]}>
        <Text style={s.charMsg}>{msg}</Text>
        <View style={s.charInner}>
          <AnimatedCharacter size={200} variant={variant} />
        </View>
      </View>

      {/* Accumulated */}
      <View style={[s.accumCard, inkBox(T.mint)]}>
        <Text style={s.accumLabel}>오늘 누적 ⏱</Text>
        <Text style={s.accumTime}>{formatTime(todayFocusSeconds + sessionSeconds)}</Text>
      </View>

      {/* Stop */}
      <Pressable
        style={({ pressed }) => [s.stopBtn, pressed && s.stopBtnPressed]}
        onPress={handleStop}
      >
        <Text style={s.stopBtnText}>⬛ 중지하기</Text>
      </Pressable>

      <Text style={s.bottomDeco}>✦ · · · ✦ · · · ✦</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: T.paper,
    paddingTop: 56, paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  pageLabel: { fontSize: 20, fontWeight: '900', color: T.ink },
  decoStar: { fontSize: 14, color: T.inkLight, letterSpacing: 4 },

  timerCard: { alignItems: 'center', paddingVertical: 12, paddingHorizontal: 24, marginBottom: 12 },
  timerSmall: { fontSize: 13, fontWeight: '700', color: T.inkMed, marginBottom: 2 },
  timerText: { fontSize: 52, fontWeight: '900', color: T.ink, letterSpacing: -2 },

  charCard: { flex: 1, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 24, marginBottom: 12 },
  charMsg: { fontSize: 13, fontWeight: '700', color: T.inkMed, marginBottom: 6 },
  charInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  accumCard: { alignItems: 'center', paddingVertical: 14, marginBottom: 18 },
  accumLabel: { fontSize: 13, fontWeight: '700', color: T.inkMed },
  accumTime: { fontSize: 30, fontWeight: '900', color: T.ink, marginTop: 2, letterSpacing: -1 },

  stopBtn: {
    backgroundColor: T.coral,
    borderWidth: 2.5, borderColor: T.ink,
    borderBottomWidth: 5, borderRightWidth: 5,
    borderTopLeftRadius: 14, borderTopRightRadius: 12,
    borderBottomLeftRadius: 12, borderBottomRightRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  stopBtnPressed: { transform: [{ translateX: 2 }, { translateY: 2 }], borderBottomWidth: 2.5, borderRightWidth: 2.5 },
  stopBtnText: { fontSize: 16, fontWeight: '900', color: T.ink },

  bottomDeco: { textAlign: 'center', marginTop: 14, fontSize: 13, color: T.inkLight, letterSpacing: 4 },
});
