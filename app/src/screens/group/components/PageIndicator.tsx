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
  onSelectPage: (page: number) => void;
}

export function pageAccessibilityLabel(label: string, page: number, pageCount: number): string {
  return `${label}, ${page + 1} / ${pageCount}`;
}

export function PageIndicator({ pageLabels, activeIndex, onSelectPage }: PageIndicatorProps) {
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [focusWithin, setFocusWithin] = useState(false);
  const pageCount = pageLabels.length;
  const safeActiveIndex = Math.max(0, Math.min(activeIndex, Math.max(0, pageCount - 1)));
  const mode = resolveIndicatorMode(measuredWidth, pageCount);
  const previousModeRef = useRef(mode);
  const dotRefs = useRef<Array<View | null>>([]);
  const counterRef = useRef<View | null>(null);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setMeasuredWidth((current) => (current === next ? current : next));
  }, []);

  useEffect(() => {
    if (previousModeRef.current === mode) return;
    previousModeRef.current = mode;
    if (!focusWithin) return;
    const target = mode === 'counter' ? counterRef.current : dotRefs.current[safeActiveIndex];
    // 키보드 입력 포커스와 스크린리더 접근성 포커스는 별개라 둘 다 이전한다.
    target?.focus();
    const node = findNodeHandle(target);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  }, [focusWithin, mode, safeActiveIndex]);

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
              onPress={() => onSelectPage(page)}
              onFocus={() => {
                setFocusWithin(true);
              }}
              onBlur={() => {
                setFocusWithin(false);
              }}
              accessibilityRole="button"
              accessibilityLabel={pageAccessibilityLabel(pageLabels[page] ?? '', page, pageCount)}
              accessibilityState={{ selected: page === safeActiveIndex }}
              testID={`group.deck.indicator.dot.${page}`}
            >
              <View
                style={[s.dot, page === safeActiveIndex && s.dotActive]}
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
          accessibilityLabel={`현재 ${safeActiveIndex + 1}, 전체 ${pageCount} 페이지`}
          onFocus={() => {
            setFocusWithin(true);
          }}
          onBlur={() => {
            setFocusWithin(false);
          }}
          testID="group.deck.indicator.counter"
        >
          <Text style={s.counter}>
            {safeActiveIndex + 1} / {pageCount}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    height: 44,
    marginTop: -56,
    marginBottom: T.space.md,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  dots: { flexDirection: 'row', gap: DOT_GAP, paddingHorizontal: INDICATOR_GUTTER },
  dotHit: {
    width: DOT_HIT_WIDTH,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.borderDark },
  dotActive: { width: 36, backgroundColor: T.accent },
  counterHit: { minHeight: 44, justifyContent: 'center' },
  counter: { ...T.text.caption, color: T.inkSub, fontVariant: ['tabular-nums'] },
});
