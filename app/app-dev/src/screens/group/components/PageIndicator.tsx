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
import { t } from '@/i18n';

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
  pageLabels?: readonly string[];
  disabled?: boolean;
  onSelectPage: (page: number) => void;
  onAccessibilitySelectPage?: (page: number) => void;
}

export function PageIndicator({
  pageCount,
  activeIndex,
  pageLabels = [],
  disabled = false,
  onSelectPage,
  onAccessibilitySelectPage,
}: PageIndicatorProps) {
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [focusWithin, setFocusWithin] = useState(false);
  const safeActiveIndex = Math.max(0, Math.min(activeIndex, Math.max(0, pageCount - 1)));
  const mode = resolveIndicatorMode(measuredWidth, pageCount);
  const previousModeRef = useRef(mode);
  const dotRefs = useRef<Array<View | null>>([]);
  const counterRef = useRef<View | null>(null);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setMeasuredWidth((current) => (current === next ? current : next));
  }, []);

  const moveCounter = useCallback(
    (delta: -1 | 1) => {
      if (disabled) return;
      const page = Math.max(0, Math.min(safeActiveIndex + delta, pageCount - 1));
      if (page === safeActiveIndex) return;
      (onAccessibilitySelectPage ?? onSelectPage)(page);
    },
    [disabled, onAccessibilitySelectPage, onSelectPage, pageCount, safeActiveIndex],
  );

  useEffect(() => {
    if (previousModeRef.current === mode) return;
    previousModeRef.current = mode;
    if (!focusWithin) return;
    const target = mode === 'counter' ? counterRef.current : dotRefs.current[safeActiveIndex];
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
              disabled={disabled}
              onPress={() => onSelectPage(page)}
              accessibilityActions={[
                { name: 'activate', label: t('group.pageIndicator.selectPage') },
              ]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'activate') {
                  (onAccessibilitySelectPage ?? onSelectPage)(page);
                }
              }}
              onFocus={() => {
                setFocusWithin(true);
              }}
              onBlur={() => {
                setFocusWithin(false);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('group.pageIndicator.dotA11y', {
                label:
                  pageLabels[page] ??
                  (page === pageCount - 1
                    ? t('group.pageIndicator.findMore')
                    : t('group.pageIndicator.nthGroup', { n: page + 1 })),
                page: page + 1,
                total: pageCount,
              })}
              accessibilityState={{ selected: page === safeActiveIndex, disabled }}
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
          disabled={disabled}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t('group.pageIndicator.counterA11y', {
            current: safeActiveIndex + 1,
            total: pageCount,
          })}
          accessibilityHint={t('group.pageIndicator.counterHint')}
          accessibilityValue={{
            min: 1,
            max: pageCount,
            now: safeActiveIndex + 1,
            text: `${safeActiveIndex + 1} / ${pageCount}`,
          }}
          accessibilityActions={[
            { name: 'increment', label: t('group.pageIndicator.nextPage') },
            { name: 'decrement', label: t('group.pageIndicator.prevPage') },
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') moveCounter(1);
            if (event.nativeEvent.actionName === 'decrement') moveCounter(-1);
          }}
          accessibilityState={{ disabled }}
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
    // FlatList의 카드 영역 다음에 문서 흐름대로 놓인다. 음수 여백으로 카드 위에
    // 겹치지 않으며, counter 텍스트가 커질 때는 44pt보다 세로로 늘어날 수 있다.
    minHeight: 44,
    marginTop: 0,
    marginBottom: T.space.md,
    alignItems: 'center',
    justifyContent: 'center',
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
