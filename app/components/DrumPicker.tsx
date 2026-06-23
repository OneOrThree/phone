import { useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { T } from './theme';

const ITEM_H = 48;
const VISIBLE = 5;
const PAD = 2;
const PICKER_H = ITEM_H * VISIBLE;
const CENTER_Y = ITEM_H * PAD;

export interface DrumPickerItem {
  label: string;
  value?: unknown;
}

interface DrumPickerProps {
  items: DrumPickerItem[];
  selectedIndex?: number;
  onChange: (index: number) => void;
}

export function DrumPicker({ items, selectedIndex = 0, onChange }: DrumPickerProps) {
  const scrollRef = useRef<ScrollView>(null);
  const lastIdx = useRef(selectedIndex);

  const paddedLabels = [
    ...Array(PAD).fill(''),
    ...items.map((it) => it.label),
    ...Array(PAD).fill(''),
  ];

  function onLayout() {
    scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_H, animated: false });
  }

  useEffect(() => {
    if (lastIdx.current !== selectedIndex) {
      scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_H, animated: true });
      lastIdx.current = selectedIndex;
    }
  }, [selectedIndex]);

  function handleScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const raw = e.nativeEvent.contentOffset.y;
    const idx = Math.max(0, Math.min(items.length - 1, Math.round(raw / ITEM_H)));
    lastIdx.current = idx;
    onChange(idx);
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
            <Text style={s.itemText}>{label}</Text>
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
  itemText: { fontSize: 20, fontWeight: '500', color: T.ink },
  lineTop: {
    position: 'absolute',
    top: CENTER_Y,
    left: 32,
    right: 32,
    height: 1.5,
    backgroundColor: T.ink,
  },
  lineBottom: {
    position: 'absolute',
    top: CENTER_Y + ITEM_H,
    left: 32,
    right: 32,
    height: 1.5,
    backgroundColor: T.ink,
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
