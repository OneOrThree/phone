import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  FlatList,
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
  const pageCount = groups.length + 1;
  const showDots =
    indicatorWidth > 0 &&
    pageCount * DOT_HIT_WIDTH + (pageCount - 1) * DOT_GAP <=
      Math.max(0, indicatorWidth - INDICATOR_GUTTER * 2);

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
        ref={listRef}
        testID="group.cardDeck"
        data={groups}
        keyExtractor={(item) => item.groupId}
        horizontal
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
          <View style={{ marginLeft: CARD_GAP }}>
            <FindMoreCard width={cardWidth} onPress={onFind} />
          </View>
        }
        renderItem={({ item }) => <View style={{ width: cardWidth }}>{renderCard(item)}</View>}
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
                testID={`group.cardDeck.indicator.dot.${page}`}
                style={s.dotHit}
                onPress={() => selectPage(page)}
                accessibilityRole="button"
                accessibilityLabel={`${groups[page]?.name ?? '그룹 찾기'}, ${page + 1} / ${pageCount}`}
                accessibilityState={{ selected: page === activeIndex }}
              >
                <View style={[s.dot, page === activeIndex && s.dotActive]} />
              </Pressable>
            ))}
          </View>
        ) : (
          <Text
            testID="group.cardDeck.indicator.counter"
            accessibilityLabel={`현재 ${activeIndex + 1}, 전체 ${pageCount} 페이지`}
          >
            {activeIndex + 1} / {pageCount}
          </Text>
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
});
