import { useCallback, useEffect, useRef, useState } from 'react';
import * as ReactNative from 'react-native';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
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
  pageLabels?: readonly string[];
  disabled?: boolean;
}

export function PageIndicator({
  pageCount,
  activeIndex,
  onSelectPage,
  pageLabels = [],
  disabled = false,
}: PageIndicatorProps) {
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const mode = resolveIndicatorMode(measuredWidth, pageCount);
  const previousModeRef = useRef(mode);
  const indicatorFocusedRef = useRef(false);
  const counterRef = useRef<View | null>(null);
  const dotRefs = useRef<Array<View | null>>([]);

  useEffect(() => {
    const previous = previousModeRef.current;
    previousModeRef.current = mode;
    if (previous === mode || !indicatorFocusedRef.current) return;
    requestAnimationFrame(() => {
      const target = mode === 'counter' ? counterRef.current : dotRefs.current[activeIndex];
      const node = ReactNative.findNodeHandle(target);
      if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
    });
  }, [activeIndex, mode]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setMeasuredWidth((current) => (current === next ? current : next));
  }, []);

  return (
    <View onLayout={onLayout} style={s.container} testID="group.deck.indicator">
      {mode === 'dots' ? (
        <View style={s.dots}>
          {Array.from({ length: pageCount }, (_, page) => (
            <Pressable
              ref={(node) => {
                dotRefs.current[page] = node;
              }}
              key={page}
              style={s.dotHit}
              disabled={disabled}
              onPress={() => onSelectPage(page)}
              onFocus={() => {
                indicatorFocusedRef.current = true;
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: page === activeIndex, disabled }}
              accessibilityLabel={`${pageLabels[page] ?? `${page + 1}번째`}, ${page + 1} / ${pageCount} 페이지로 이동`}
              testID={`group.deck.indicator.dot.${page}`}
            >
              <View style={[s.dot, page === activeIndex && s.dotActive]} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Pressable
          ref={counterRef}
          style={s.counter}
          accessible
          focusable
          accessibilityRole="text"
          onFocus={() => {
            indicatorFocusedRef.current = true;
          }}
          accessibilityLabel={`현재 ${activeIndex + 1}, 전체 ${pageCount} 페이지`}
          testID="group.deck.indicator.counter"
        >
          <Text style={s.counterText}>
            {activeIndex + 1} / {pageCount}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: DOT_GAP, paddingHorizontal: INDICATOR_GUTTER },
  dotHit: {
    width: DOT_HIT_WIDTH,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.borderDark },
  dotActive: { width: 18, backgroundColor: T.accent },
  counter: { minHeight: 44, justifyContent: 'center' },
  counterText: { ...T.text.caption, color: T.inkSub, fontVariant: ['tabular-nums'] },
});
