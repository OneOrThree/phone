import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { T } from '@/v2/constants/theme';

// v1 DrumPicker(src/components)의 v2 포팅 — 세로 휠 피커.
// 컨트롤드 컴포넌트: 스크롤이 멈추면 onChange(index)를 올리고, 부모가 selectedIndex를
// 그대로 유지하면(값 거부) 휠이 selectedIndex 위치로 되돌아간다. 프리셋 탭처럼
// 밖에서 selectedIndex가 바뀌어도 애니메이션으로 따라간다.

const ITEM_H = 44;
const VISIBLE = 5;
const PAD = 2; // 위아래 빈 칸 수 = (VISIBLE - 1) / 2
const PICKER_H = ITEM_H * VISIBLE;
const CENTER_Y = ITEM_H * PAD;

export function DrumPicker({
  items,
  selectedIndex,
  onChange,
}: {
  items: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  // 휠이 실제로 멈춰 있는 인덱스 — selectedIndex와 어긋나면 selectedIndex로 스크롤
  const [settledIndex, setSettledIndex] = useState(selectedIndex);

  const paddedLabels = [...Array(PAD).fill(''), ...items, ...Array(PAD).fill('')];

  function onLayout() {
    scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_H, animated: false });
  }

  useEffect(() => {
    if (settledIndex !== selectedIndex) {
      scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_H, animated: true });
      setSettledIndex(selectedIndex);
    }
  }, [selectedIndex, settledIndex]);

  function handleScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const raw = e.nativeEvent.contentOffset.y;
    const idx = Math.max(0, Math.min(items.length - 1, Math.round(raw / ITEM_H)));
    setSettledIndex(idx);
    if (idx !== selectedIndex) onChange(idx);
  }

  return (
    <View style={s.wrap}>
      <ScrollView
        ref={scrollRef}
        onLayout={onLayout}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        scrollEventThrottle={16}
        nestedScrollEnabled
      >
        {paddedLabels.map((label, i) => (
          <View key={i} style={s.item}>
            <Text style={s.itemText} allowFontScaling={false}>
              {label}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* 선택 영역 구분선 */}
      <View style={s.lineTop} pointerEvents="none" />
      <View style={s.lineBottom} pointerEvents="none" />

      {/* 상하 페이드 마스크 */}
      <View style={s.maskTop} pointerEvents="none" />
      <View style={s.maskBottom} pointerEvents="none" />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { height: PICKER_H, overflow: 'hidden' },
  item: { height: ITEM_H, alignItems: 'center', justifyContent: 'center' },
  itemText: {
    ...T.text.subtitle,
    fontWeight: '600',
    color: T.ink,
    fontVariant: ['tabular-nums'],
  },
  lineTop: {
    position: 'absolute',
    top: CENTER_Y,
    left: 24,
    right: 24,
    height: 1.5,
    backgroundColor: T.chipBorder,
  },
  lineBottom: {
    position: 'absolute',
    top: CENTER_Y + ITEM_H,
    left: 24,
    right: 24,
    height: 1.5,
    backgroundColor: T.chipBorder,
  },
  maskTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: CENTER_Y,
    backgroundColor: 'rgba(255,255,255,0.82)',
  },
  maskBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: CENTER_Y,
    backgroundColor: 'rgba(255,255,255,0.82)',
  },
});
