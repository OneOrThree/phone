import { useEffect, useRef } from 'react';
import { Animated, Text, Image, StyleSheet } from 'react-native';
import { T } from '@/constants/theme';

// 온보딩 진입 스플래시 — 캐릭터(character_hi)를 가운데, 하단에 GROMO 워드마크.
// HOLD_MS 노출 후 FADE_MS 동안 페이드아웃 → onDone()으로 온보딩(W1)에 넘긴다.
const HOLD_MS = 1200;
const FADE_MS = 400;

export default function OnboardingSplash({ onDone }: { onDone: () => void }) {
  const opacity = useRef(new Animated.Value(1)).current;
  // onDone은 인라인으로 넘어와 매 렌더 새 참조 — ref로 잡아 effect 재실행/타이머 리셋을 막는다.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onDoneRef.current();
      });
    }, HOLD_MS);
    return () => clearTimeout(t);
  }, [opacity]);

  return (
    <Animated.View style={[s.root, { opacity }]}>
      <Image
        source={require('../../../assets/character_hi.png')}
        style={s.char}
        resizeMode="contain"
      />
      <Text style={s.brand}>GROMO</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paper, alignItems: 'center', justifyContent: 'center' },
  char: { width: 220, height: 220 },
  brand: {
    ...T.text.display,
    color: T.ink,
    letterSpacing: 4,
    marginTop: 8,
  },
});
