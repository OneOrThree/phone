import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { T } from '@/constants/theme';

const INDICATOR_GUTTER = 20;
const DOT_HIT_WIDTH = 44;
const DOT_GAP = 4;

export type IndicatorMode = 'dots' | 'counter';

export function requiredDotsWidth(pageCount: number): number {
  if (pageCount <= 0) return 0;
  return pageCount * DOT_HIT_WIDTH + (pageCount - 1) * DOT_GAP;
}

export function resolveIndicatorMode(measuredWidth: number, pageCount: number): IndicatorMode {
  if (measuredWidth <= 0) return 'counter';
  const available = Math.max(0, measuredWidth - INDICATOR_GUTTER * 2);
  return requiredDotsWidth(pageCount) <= available ? 'dots' : 'counter';
}

interface PageIndicatorProps {
  pageCount: number;
  activeIndex: number;
  onSelectPage: (page: number) => void;
}

export function PageIndicator({ pageCount, activeIndex, onSelectPage }: PageIndicatorProps) {
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const mode = resolveIndicatorMode(measuredWidth, pageCount);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setMeasuredWidth((current) => (current === next ? current : next));
  }, []);

  return (
    <View onLayout={onLayout} style={s.container} testID="group.deck.indicator">
      {mode === 'dots' ? (
        <View
          style={s.dots}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {Array.from({ length: pageCount }, (_, page) => (
            <Pressable
              key={page}
              style={s.dotHit}
              onPress={() => onSelectPage(page)}
              testID={`group.deck.indicator.dot.${page}`}
            >
              <View style={[s.dot, page === activeIndex && s.dotActive]} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Text
          style={s.counter}
          accessibilityLabel={`${activeIndex + 1} / ${pageCount}`}
          testID="group.deck.indicator.counter"
        >
          {activeIndex + 1} / {pageCount}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { height: 36, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: DOT_GAP, paddingHorizontal: INDICATOR_GUTTER },
  dotHit: {
    width: DOT_HIT_WIDTH,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.borderDark },
  dotActive: { width: 18, backgroundColor: T.accent },
  counter: { ...T.text.caption, color: T.inkSub, fontVariant: ['tabular-nums'] },
});
