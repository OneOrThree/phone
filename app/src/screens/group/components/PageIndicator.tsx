import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
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
  pageLabels: readonly string[];
  activeIndex: number;
  disabled?: boolean;
  onSelectPage: (page: number) => void;
  onAccessibilitySelectPage?: (page: number) => void;
}

export function pageAccessibilityLabel(label: string, page: number, pageCount: number): string {
  return `${label}, ${page + 1} / ${pageCount}`;
}

export function PageIndicator({
  pageLabels,
  activeIndex,
  disabled = false,
  onSelectPage,
  onAccessibilitySelectPage,
}: PageIndicatorProps) {
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const pageCount = pageLabels.length;
  const mode = resolveIndicatorMode(measuredWidth, pageCount);
  const previousModeRef = useRef(mode);
  const focusWithinRef = useRef(false);
  const dotRefs = useRef<Array<View | null>>([]);
  const counterRef = useRef<View | null>(null);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setMeasuredWidth((current) => (current === next ? current : next));
  }, []);

  useEffect(() => {
    if (previousModeRef.current === mode) return;
    previousModeRef.current = mode;
    if (!focusWithinRef.current) return;
    const target = mode === 'counter' ? counterRef.current : dotRefs.current[activeIndex];
    const node = findNodeHandle(target);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  }, [activeIndex, mode]);

  return (
    <View onLayout={onLayout} style={s.container} testID="group.deck.indicator">
      {mode === 'dots' ? (
        <View style={s.dots}>
          {Array.from({ length: pageCount }, (_, page) => (
            <Pressable
              key={page}
              ref={(node) => {
                dotRefs.current[page] = node;
              }}
              style={s.dotHit}
              disabled={disabled}
              onPress={() => onSelectPage(page)}
              accessibilityActions={[{ name: 'activate', label: '페이지 선택' }]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'activate') {
                  (onAccessibilitySelectPage ?? onSelectPage)(page);
                }
              }}
              onFocus={() => {
                focusWithinRef.current = true;
              }}
              onBlur={() => {
                focusWithinRef.current = false;
              }}
              accessibilityRole="button"
              accessibilityLabel={pageAccessibilityLabel(pageLabels[page] ?? '', page, pageCount)}
              accessibilityState={{ selected: page === activeIndex, disabled }}
              testID={`group.deck.indicator.dot.${page}`}
            >
              <View
                style={[s.dot, page === activeIndex && s.dotActive]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            </Pressable>
          ))}
        </View>
      ) : (
        <Pressable
          ref={counterRef}
          style={s.counterHit}
          accessible
          accessibilityRole="text"
          accessibilityLabel={`현재 ${activeIndex + 1}, 전체 ${pageCount} 페이지`}
          accessibilityState={{ disabled }}
          onFocus={() => {
            focusWithinRef.current = true;
          }}
          onBlur={() => {
            focusWithinRef.current = false;
          }}
          testID="group.deck.indicator.counter"
        >
          <Text style={s.counter}>
            {activeIndex + 1} / {pageCount}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { height: 44, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: DOT_GAP, paddingHorizontal: INDICATOR_GUTTER },
  dotHit: {
    width: DOT_HIT_WIDTH,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.borderDark },
  dotActive: { width: 18, backgroundColor: T.accent },
  counterHit: { minHeight: 44, justifyContent: 'center' },
  counter: { ...T.text.caption, color: T.inkSub, fontVariant: ['tabular-nums'] },
});
