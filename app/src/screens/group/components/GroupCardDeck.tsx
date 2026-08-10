import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  useWindowDimensions,
  View,
} from 'react-native';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { FindMoreCard } from './FindMoreCard';

const SIDE_PEEK = 24;
const CARD_GAP = 12;

export interface GroupCardDeckProps {
  groups: GroupSummaryResponse[];
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
export function GroupCardDeck({ groups, onFind, renderCard }: GroupCardDeckProps) {
  const { width: windowWidth } = useWindowDimensions();
  const listRef = useRef<FlatList<GroupSummaryResponse>>(null);
  const activeGroupIdRef = useRef<string | null>(groups[0]?.groupId ?? null);
  const activeIndexRef = useRef(0);
  const cardWidth = Math.max(240, windowWidth - SIDE_PEEK * 2);
  const snapInterval = cardWidth + CARD_GAP;
  const orderKey = groupOrderKey(groups);
  const previousOrderKeyRef = useRef(orderKey);
  const previousSnapIntervalRef = useRef(snapInterval);

  const settleActiveCard = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.max(
        0,
        Math.min(Math.round(event.nativeEvent.contentOffset.x / snapInterval), groups.length),
      );
      activeGroupIdRef.current = groups[index]?.groupId ?? null;
      activeIndexRef.current = index;
    },
    [groups, snapInterval],
  );

  // 회전·분할 화면과 서버 목록 reconcile 뒤에도 index가 아닌 stable groupId를 새 간격에 복원한다.
  useEffect(() => {
    const orderChanged = previousOrderKeyRef.current !== orderKey;
    const intervalChanged = previousSnapIntervalRef.current !== snapInterval;
    previousOrderKeyRef.current = orderKey;
    previousSnapIntervalRef.current = snapInterval;
    if (!orderChanged && !intervalChanged) return;

    const identity = activeGroupIdRef.current;
    const index = resolveDeckIndex(groups, identity, activeIndexRef.current);
    activeGroupIdRef.current = groups[index]?.groupId ?? null;
    activeIndexRef.current = index;
    listRef.current?.scrollToOffset({ offset: index * snapInterval, animated: false });
  }, [groups, orderKey, snapInterval]);

  return (
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
  );
}
