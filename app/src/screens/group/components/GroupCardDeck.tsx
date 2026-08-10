import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
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
  renderCard: (group: GroupSummaryResponse) => ReactElement;
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

const groupOrderKey = (groups: readonly GroupSummaryResponse[]) =>
  groups.map((group) => group.groupId).join('\u0000');

// 운영 GroupListScreen을 교체하기 전, 덱 자체의 폭·snap·stable identity만 독립 검증하는 컴포넌트다.
// 앞면·인디케이터·flip 계약이 합쳐질 때 이 경계를 운영 화면에 연결한다.
export function GroupCardDeck({ groups, activeGroupId, onFind, renderCard }: GroupCardDeckProps) {
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
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [indicatorWidth, setIndicatorWidth] = useState(0);
  const indicatorFocusedRef = useRef(false);
  const pageCount = groups.length + 1;
  const showDots =
    indicatorWidth > 0 &&
    pageCount * DOT_HIT_WIDTH + (pageCount - 1) * DOT_GAP <=
      Math.max(0, indicatorWidth - INDICATOR_GUTTER * 2);
  const previousShowDotsRef = useRef(showDots);
  const dotRefs = useRef<Array<View | null>>([]);
  const counterRef = useRef<View | null>(null);
  // 폭·순서가 바뀌는 렌더에서는 passive effect를 기다리지 않고, 직전 stable identity가
  // 새 배치에서 차지하는 offset으로 FlatList를 다시 마운트한다. 그래야 이전 픽셀 offset이
  // 새 snapInterval의 다른 카드로 한 프레임 해석되지 않는다.
  const restoreIdentity =
    previousActiveInputRef.current !== activeGroupId ? activeGroupId : activeGroupIdRef.current;
  const restoredIndex = resolveDeckIndex(groups, restoreIdentity, activeIndexRef.current);
  const layoutKey = `${orderKey}\u0001${snapInterval}`;

  useEffect(() => {
    if (previousShowDotsRef.current === showDots) return;
    previousShowDotsRef.current = showDots;
    if (!indicatorFocusedRef.current) return;
    const target = showDots ? dotRefs.current[activeIndex] : counterRef.current;
    target?.focus();
    const node = findNodeHandle(target);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  }, [activeIndex, showDots]);

  const settleActiveCard = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.max(
        0,
        Math.min(Math.round(event.nativeEvent.contentOffset.x / snapInterval), groups.length),
      );
      activeGroupIdRef.current = groups[index]?.groupId ?? null;
      activeIndexRef.current = index;
      setActiveIndex(index);
    },
    [groups, snapInterval],
  );

  // 회전·분할 화면과 서버 목록 reconcile 뒤에도 index가 아닌 stable groupId를 새 간격에 복원한다.
  useEffect(() => {
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
    activeGroupIdRef.current = groups[page]?.groupId ?? null;
    activeIndexRef.current = page;
    setActiveIndex(page);
  };

  return (
    <View>
      <FlatList
        key={layoutKey}
        ref={listRef}
        testID="group.cardDeck"
        data={groups}
        keyExtractor={(item) => item.groupId}
        horizontal
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
        onMomentumScrollEnd={settleActiveCard}
        onScrollEndDrag={settleActiveCard}
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
            />
          </View>
        }
        renderItem={({ item, index }) => (
          <View
            testID={`group.cardDeck.page.${item.groupId}`}
            style={{ width: cardWidth }}
            pointerEvents={index === activeIndex ? 'auto' : 'none'}
            accessibilityElementsHidden={index !== activeIndex}
            importantForAccessibility={index === activeIndex ? 'auto' : 'no-hide-descendants'}
          >
            {index === activeIndex && (
              <Text
                style={s.srOnly}
                accessibilityLabel={`${item.name}, 현재 ${index + 1}/${pageCount} 페이지`}
              >
                {`${item.name}, 현재 ${index + 1}/${pageCount} 페이지`}
              </Text>
            )}
            {renderCard(item)}
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
            {Array.from({ length: pageCount }, (_, page) => (
              <Pressable
                key={page}
                ref={(node) => {
                  dotRefs.current[page] = node;
                }}
                testID={`group.cardDeck.indicator.dot.${page}`}
                style={s.dotHit}
                onPress={() => selectPage(page)}
                onFocus={() => {
                  indicatorFocusedRef.current = true;
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
            ))}
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
  indicator: { height: 44, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: DOT_GAP, paddingHorizontal: INDICATOR_GUTTER },
  dotHit: { width: DOT_HIT_WIDTH, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#C8CAD0' },
  dotActive: { width: 18, backgroundColor: '#5E6AD2' },
  counterHit: { minHeight: 44, justifyContent: 'center' },
  srOnly: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
