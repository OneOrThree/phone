import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  AccessibilityInfo,
  FlatList,
  findNodeHandle,
  Pressable,
  StyleSheet,
  Text,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  useWindowDimensions,
  View,
} from 'react-native';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { FindMoreCard } from './FindMoreCard';

const SIDE_PEEK = 24;
const CARD_GAP = 12;
const INDICATOR_GUTTER = 20;
const DOT_HIT_WIDTH = 44;
const DOT_GAP = 4;

export interface GroupCardDeckProps {
  groups: GroupSummaryResponse[];
  activeGroupId: string | null;
  onFind: () => void;
  renderCard: (
    group: GroupSummaryResponse,
    position: number,
    pageCount: number,
    active: boolean,
  ) => ReactElement;
  onPeekPress?: (group: GroupSummaryResponse) => void;
}

export function resolveDeckIndex(
  groups: readonly GroupSummaryResponse[],
  activeGroupId: string | null,
  previousIndex: number,
): number {
  if (activeGroupId === null) return groups.length;
  const stableIndex = groups.findIndex((group) => group.groupId === activeGroupId);
  if (stableIndex >= 0) return stableIndex;
  return Math.max(0, Math.min(previousIndex, Math.max(0, groups.length - 1)));
}

export function resolveDotFocusKey(
  pageKeys: readonly string[],
  activeIndex: number,
  preservedKey: string | null,
  indicatorModeChanged: boolean,
): string | null {
  const activeKey = pageKeys[activeIndex] ?? null;
  if (indicatorModeChanged) return activeKey;
  return preservedKey && pageKeys.includes(preservedKey) ? preservedKey : activeKey;
}

const groupOrderKey = (groups: readonly GroupSummaryResponse[]) =>
  groups.map((group) => group.groupId).join('\u0000');

// 운영 GroupListScreen을 교체하기 전, 덱 자체의 폭·snap·stable identity만 독립 검증하는 컴포넌트다.
// 앞면·인디케이터·flip 계약이 합쳐질 때 이 경계를 운영 화면에 연결한다.
export function GroupCardDeck({
  groups,
  activeGroupId,
  onFind,
  renderCard,
  onPeekPress,
}: GroupCardDeckProps) {
  const { width: windowWidth } = useWindowDimensions();
  const listRef = useRef<FlatList<GroupSummaryResponse>>(null);
  const initialIndex = resolveDeckIndex(groups, activeGroupId, 0);
  const activeGroupIdRef = useRef<string | null>(groups[initialIndex]?.groupId ?? null);
  const activeIndexRef = useRef(initialIndex);
  const cardWidth = Math.max(240, windowWidth - SIDE_PEEK * 2);
  const snapInterval = cardWidth + CARD_GAP;
  const orderKey = groupOrderKey(groups);
  const previousOrderKeyRef = useRef(orderKey);
  const previousSnapIntervalRef = useRef(snapInterval);
  const previousActiveInputRef = useRef<string | null | undefined>(undefined);
  const pendingPeekGroupIdRef = useRef<string | null>(null);
  const pendingPageAnnouncementRef = useRef<number | null>(null);
  const dragFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const momentumActiveRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [indicatorWidth, setIndicatorWidth] = useState(0);
  const indicatorFocusedRef = useRef(false);
  const pageCount = groups.length + 1;
  const showDots =
    indicatorWidth > 0 &&
    pageCount * DOT_HIT_WIDTH + (pageCount - 1) * DOT_GAP <=
      Math.max(0, indicatorWidth - INDICATOR_GUTTER * 2);
  const previousShowDotsRef = useRef(showDots);
  const dotRefs = useRef(new Map<string, View | null>());
  const counterRef = useRef<View | null>(null);
  const focusedIndicatorKeyRef = useRef<string | null>(null);
  const pageKeys = useMemo(() => [...groups.map((group) => group.groupId), 'find-more'], [groups]);
  // 폭·순서가 바뀌는 렌더에서는 passive effect를 기다리지 않고, 직전 stable identity가
  // 새 배치에서 차지하는 offset으로 FlatList를 다시 마운트한다. 그래야 이전 픽셀 offset이
  // 새 snapInterval의 다른 카드로 한 프레임 해석되지 않는다.
  const restoreIdentity =
    previousActiveInputRef.current !== activeGroupId ? activeGroupId : activeGroupIdRef.current;
  const restoredIndex = resolveDeckIndex(groups, restoreIdentity, activeIndexRef.current);

  useEffect(() => {
    if (previousShowDotsRef.current === showDots) return;
    previousShowDotsRef.current = showDots;
    if (!indicatorFocusedRef.current) return;
    if (showDots) {
      focusedIndicatorKeyRef.current = resolveDotFocusKey(
        pageKeys,
        activeIndex,
        focusedIndicatorKeyRef.current,
        true,
      );
    }
    const target = showDots ? dotRefs.current.get(pageKeys[activeIndex]) : counterRef.current;
    target?.focus();
    const node = findNodeHandle(target ?? null);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  }, [activeIndex, pageKeys, showDots]);

  useEffect(() => {
    if (!showDots || !indicatorFocusedRef.current) return;
    const preservedKey = focusedIndicatorKeyRef.current;
    const nextKey = resolveDotFocusKey(pageKeys, activeIndex, preservedKey, false);
    if (nextKey === null) return;
    focusedIndicatorKeyRef.current = nextKey;
    const target = dotRefs.current.get(nextKey);
    target?.focus();
    const node = findNodeHandle(target ?? null);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  }, [activeIndex, pageKeys, showDots]);

  const settleActiveOffset = useCallback(
    (offsetX: number) => {
      const index = Math.max(0, Math.min(Math.round(offsetX / snapInterval), groups.length));
      const changed =
        activeIndexRef.current !== index || pendingPageAnnouncementRef.current === index;
      pendingPageAnnouncementRef.current = null;
      activeGroupIdRef.current = groups[index]?.groupId ?? null;
      activeIndexRef.current = index;
      setActiveIndex(index);
      if (changed) {
        AccessibilityInfo.announceForAccessibility(
          `${groups[index]?.name ?? '그룹 찾기'}, ${index + 1} / ${pageCount} 페이지`,
        );
      }
      const pendingPeekId = pendingPeekGroupIdRef.current;
      pendingPeekGroupIdRef.current = null;
      if (pendingPeekId && groups[index]?.groupId === pendingPeekId) {
        const group = groups[index];
        if (group) onPeekPress?.(group);
      }
    },
    [groups, onPeekPress, pageCount, snapInterval],
  );

  const cancelDragFallback = useCallback(() => {
    if (dragFallbackTimerRef.current !== null) clearTimeout(dragFallbackTimerRef.current);
    dragFallbackTimerRef.current = null;
  }, []);

  useEffect(() => cancelDragFallback, [cancelDragFallback]);

  const onScrollBeginDrag = useCallback(() => {
    momentumActiveRef.current = false;
    cancelDragFallback();
  }, [cancelDragFallback]);

  const onMomentumScrollBegin = useCallback(() => {
    momentumActiveRef.current = true;
    cancelDragFallback();
  }, [cancelDragFallback]);

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      momentumActiveRef.current = false;
      cancelDragFallback();
      settleActiveOffset(event.nativeEvent.contentOffset.x);
    },
    [cancelDragFallback, settleActiveOffset],
  );

  const onScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (momentumActiveRef.current) return;
      // iOS는 targetContentOffset, Android의 비관성 drag는 현재 contentOffset만 제공한다.
      // 어느 플랫폼이든 momentum이 시작되면 begin handler가 이 fallback을 취소한다.
      const target = event.nativeEvent.targetContentOffset?.x ?? event.nativeEvent.contentOffset.x;
      cancelDragFallback();
      // iOS는 momentum gesture에도 targetContentOffset을 제공한다. 다음 tick 전에
      // onMomentumScrollBegin이 오면 이 fallback을 취소하고 실제 momentum 종료만 확정한다.
      dragFallbackTimerRef.current = setTimeout(() => {
        dragFallbackTimerRef.current = null;
        settleActiveOffset(target);
      }, 0);
    },
    [cancelDragFallback, settleActiveOffset],
  );

  // 회전·분할 화면과 서버 목록 reconcile 뒤에도 index가 아닌 stable groupId를 새 간격에 복원한다.
  useLayoutEffect(() => {
    const orderChanged = previousOrderKeyRef.current !== orderKey;
    const intervalChanged = previousSnapIntervalRef.current !== snapInterval;
    const activeInputChanged = previousActiveInputRef.current !== activeGroupId;
    previousOrderKeyRef.current = orderKey;
    previousSnapIntervalRef.current = snapInterval;
    previousActiveInputRef.current = activeGroupId;
    if (!orderChanged && !intervalChanged && !activeInputChanged) return;

    const identity = activeInputChanged ? activeGroupId : activeGroupIdRef.current;
    const index = resolveDeckIndex(groups, identity, activeIndexRef.current);
    activeGroupIdRef.current = groups[index]?.groupId ?? null;
    activeIndexRef.current = index;
    setActiveIndex(index);
    listRef.current?.scrollToOffset({ offset: index * snapInterval, animated: false });
  }, [activeGroupId, groups, orderKey, snapInterval]);

  const selectPage = (page: number) => {
    listRef.current?.scrollToOffset({ offset: page * snapInterval, animated: true });
    if (page !== activeIndexRef.current) pendingPageAnnouncementRef.current = page;
    activeGroupIdRef.current = groups[page]?.groupId ?? null;
    activeIndexRef.current = page;
    setActiveIndex(page);
  };

  return (
    <View>
      <FlatList
        ref={listRef}
        testID="group.cardDeck"
        data={groups}
        keyExtractor={(item) => item.groupId}
        horizontal
        initialScrollIndex={restoredIndex < groups.length ? restoredIndex : undefined}
        contentOffset={{ x: restoredIndex * snapInterval, y: 0 }}
        getItemLayout={(_, index) => ({
          length: snapInterval,
          offset: index * snapInterval,
          index,
        })}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SIDE_PEEK }}
        ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
        snapToInterval={snapInterval}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        onScrollBeginDrag={onScrollBeginDrag}
        onMomentumScrollEnd={onMomentumScrollEnd}
        onMomentumScrollBegin={onMomentumScrollBegin}
        onScrollEndDrag={onScrollEndDrag}
        ListFooterComponent={
          <View
            testID="group.cardDeck.findMorePage"
            style={{ marginLeft: CARD_GAP }}
            pointerEvents={activeIndex === groups.length ? 'auto' : 'none'}
            accessibilityElementsHidden={activeIndex !== groups.length}
            importantForAccessibility={
              activeIndex === groups.length ? 'auto' : 'no-hide-descendants'
            }
          >
            <FindMoreCard
              width={cardWidth}
              position={pageCount}
              pageCount={pageCount}
              onPress={onFind}
              focusable={activeIndex === groups.length}
            />
          </View>
        }
        renderItem={({ item, index }) => (
          <View
            testID={`group.cardDeck.page.${item.groupId}`}
            style={{ width: cardWidth }}
            accessibilityElementsHidden={index !== activeIndex}
            importantForAccessibility={index === activeIndex ? 'auto' : 'no-hide-descendants'}
          >
            <View
              pointerEvents={index === activeIndex ? 'auto' : 'none'}
              testID={`group.cardDeck.pageBody.${item.groupId}`}
            >
              {renderCard(item, index + 1, pageCount, index === activeIndex)}
            </View>
            {index !== activeIndex && (
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => {
                  pendingPeekGroupIdRef.current = item.groupId;
                  listRef.current?.scrollToOffset({ offset: index * snapInterval, animated: true });
                }}
                accessible={false}
                focusable={false}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                testID={`group.cardDeck.peek.${item.groupId}`}
              />
            )}
          </View>
        )}
      />
      <View
        testID="group.cardDeck.indicator"
        style={s.indicator}
        onLayout={(event) => setIndicatorWidth(event.nativeEvent.layout.width)}
      >
        {showDots ? (
          <View style={s.dots}>
            {Array.from({ length: pageCount }, (_, page) => {
              const pageKey = pageKeys[page];
              return (
                <Pressable
                  key={pageKey}
                  ref={(node) => {
                    dotRefs.current.set(pageKey, node);
                  }}
                  testID={`group.cardDeck.indicator.dot.${page}`}
                  style={s.dotHit}
                  onPress={() => selectPage(page)}
                  onFocus={() => {
                    indicatorFocusedRef.current = true;
                    focusedIndicatorKeyRef.current = pageKey;
                  }}
                  onBlur={() => {
                    indicatorFocusedRef.current = false;
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${groups[page]?.name ?? '그룹 찾기'}, ${page + 1} / ${pageCount} 페이지로 이동`}
                  accessibilityState={{ selected: page === activeIndex }}
                >
                  <View style={[s.dot, page === activeIndex && s.dotActive]} />
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Pressable
            ref={counterRef}
            style={s.counterHit}
            accessible
            accessibilityRole="text"
            testID="group.cardDeck.indicator.counter"
            accessibilityLabel={`현재 ${activeIndex + 1}, 전체 ${pageCount} 페이지`}
            onFocus={() => {
              indicatorFocusedRef.current = true;
            }}
            onBlur={() => {
              indicatorFocusedRef.current = false;
            }}
          >
            <Text>
              {activeIndex + 1} / {pageCount}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  indicator: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: DOT_GAP, paddingHorizontal: INDICATOR_GUTTER },
  dotHit: { width: DOT_HIT_WIDTH, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#C8CAD0' },
  dotActive: { width: 18, backgroundColor: '#5E6AD2' },
  counterHit: { minHeight: 44, paddingVertical: 8, justifyContent: 'center' },
});
