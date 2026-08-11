import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { T } from '@/constants/theme';

export interface DrumPickerProps {
  items: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
}

interface DrumPickerCoreProps extends DrumPickerProps {
  scrollAdapter: 'native' | 'web';
}

const ITEM_H = 44;
const VISIBLE = 5;
const PAD = 2;
const PICKER_H = ITEM_H * VISIBLE;
const CENTER_Y = ITEM_H * PAD;
export const WEB_SCROLL_SETTLE_MS = 120;

// 휠의 모든 시각·애니메이션 구현은 이 module 하나가 소유한다. 플랫폼 adapter는 스크롤 종료
// 신호만 고르므로 앱 UI가 바뀌면 웹도 같은 변경을 즉시 받는다.
export function DrumPickerCore({
  items,
  selectedIndex,
  onChange,
  scrollAdapter,
}: DrumPickerCoreProps) {
  const scrollRef = useRef<ScrollView>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(
    () => () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    },
    [],
  );

  function settleAtOffset(raw: number) {
    const index = Math.max(0, Math.min(items.length - 1, Math.round(raw / ITEM_H)));
    setSettledIndex(index);
    if (scrollAdapter === 'web') {
      // react-native-web은 snapToInterval을 적용하지 않아 smooth scroll로 정중앙에 맞춘다.
      scrollRef.current?.scrollTo({ y: index * ITEM_H, animated: true });
    }
    if (index !== selectedIndex) onChange(index);
  }

  function handleNativeScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    settleAtOffset(event.nativeEvent.contentOffset.y);
  }

  function handleWebScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const raw = event.nativeEvent.contentOffset.y;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      settleAtOffset(raw);
    }, WEB_SCROLL_SETTLE_MS);
  }

  const web = scrollAdapter === 'web';
  return (
    <View style={s.wrap}>
      <ScrollView
        ref={scrollRef}
        testID={web ? 'drum-picker.web.scroll' : undefined}
        onLayout={onLayout}
        onScroll={web ? handleWebScroll : undefined}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        onMomentumScrollEnd={web ? undefined : handleNativeScrollEnd}
        onScrollEndDrag={web ? undefined : handleNativeScrollEnd}
        scrollEventThrottle={16}
        nestedScrollEnabled
      >
        {paddedLabels.map((label, index) => (
          <View key={index} style={s.item}>
            <Text style={s.itemText} allowFontScaling={false}>
              {label}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={s.lineTop} pointerEvents="none" />
      <View style={s.lineBottom} pointerEvents="none" />
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
