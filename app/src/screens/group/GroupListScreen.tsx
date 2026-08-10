import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  findNodeHandle,
  PanResponder,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { FindMoreCard } from './components/FindMoreCard';
import { PageIndicator } from './components/PageIndicator';
import { GroupCardFront } from './components/GroupCardFront';
import { GroupCardBack } from './components/GroupCardBack';
import { useGroupCardOrder } from './useGroupCardOrder';
import { resolveGroupRoomReturn, type GroupRoomReturnContext } from './groupRoomReturn';
import {
  DEFAULT_GROUP_CARD_EMOJI,
  readGroupCardEmoji,
  type GroupCardEmoji,
} from './groupCardEmojiStore';
import { GroupCardSummaryAdapter } from './groupCardSummary';
import { groupFocusStatusStore } from './groupFocusStatus';
import { todayStrKst } from '@/utils/localDate';
import {
  logGroupCardActionClicked,
  logGroupCardFlipped,
  logGroupCardReordered,
  logGroupCarouselPaged,
  type GroupCardReorderTrigger,
  type GroupCountBucket,
} from '@/services/analyticsEvents';

// 그룹 목록 — 명세 docs/app/group-plan-2.md §3-1.
//
// 형태: 헤더 + 카드 FlatList + 하단 고정 CTA 2개(만들기·찾기). 카드는 세로 스택 —
//      이름(+비공개 자물쇠) / 소개(값 있을 때만) / 방장 칩, 우측에 n/m 인원.
//
// props 계약(배관이 확정 — 이 시그니처는 바꾸지 않는다):
//   groups    : GroupSummaryResponse[]  내가 참여 중인 그룹(서버 순서 그대로, 앱 재정렬 금지)
//   onSelect  : (groupId: string) => void  카드 탭. **자체적으로 navigate 하지 않는다** —
//               1개일 땐 목록을 닫고, 2개 이상일 땐 GroupRoom push 하는 분기는 GroupScreen이 쥔다
//   onCreate  : () => void   '그룹 만들기' — GroupScreen이 전이 상태를 세우고 GroupCreate로 push
//   onFind    : () => void   '그룹 찾기' — GroupScreen이 GroupFindSheet를 연다
//   onRefresh : () => Promise<void>  당겨서 새로고침. 조회 실패 배너는 GroupScreen이 이미 그린다
//   onBack?   : () => void   **있을 때만** 헤더 좌측에 원형 백버튼을 그린다.
//               그룹이 1건인데 그룹방 ⋯ 메뉴로 '잠깐 열어 본' 목록에만 전달된다 — 그 상태에선
//               되돌아갈 길이 카드 탭뿐이라 목록이 탭에 눌러앉는다. 2건 이상의 기본 목록은
//               그룹 탭의 첫 화면이라 미전달(백버튼 없음)이 정상이다.
//
// 렌더는 SafeAreaView 없이 컨텐츠만 — 탭 셸(SafeAreaView·배경)은 GroupScreen이 감싼다.
// 빈 배열은 다루지 않는다: 0건은 GroupScreen이 빈 상태로 가로채므로 여기 오지 않는다.

// 플로팅 탭바가 가리는 하단 여백(그룹 탭 공통 기준 — GroupScreen·그룹방과 같은 값)
const TAB_BAR_SPACE = 74;
const SIDE_PEEK = 24;
const CARD_GAP = 12;
const DRAG_EDGE = 60;
const EDGE_PAGE_THROTTLE_MS = 260;

function groupCountBucket(count: number): GroupCountBucket {
  if (count === 1) return '1';
  if (count <= 5) return '2_5';
  if (count <= 10) return '6_10';
  return '11_plus';
}

function transientInteractionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : 8 + (random % 4)).toString(16);
  });
}

export function resolveDragTarget(
  from: number,
  pointerDelta: number,
  edgeOffset: number,
  edgeDirection: -1 | 0 | 1,
  max: number,
): { target: number; edgeOffset: number } {
  const nextEdgeOffset = edgeOffset + edgeDirection;
  return {
    target: Math.max(0, Math.min(from + pointerDelta + nextEdgeOffset, max)),
    edgeOffset: nextEdgeOffset,
  };
}

export interface GroupListScreenProps {
  groups: GroupSummaryResponse[];
  groupsRevision?: number;
  isScreenFocused?: boolean;
  userId?: string | null;
  onSelect: (groupId: string) => void;
  onCreate: () => void;
  onFind: () => void;
  onRefresh: () => Promise<void>;
  onBack?: () => void;
}

export default function GroupListScreen({
  groups,
  groupsRevision = 0,
  isScreenFocused = true,
  userId = null,
  onSelect,
  onCreate,
  onFind,
  onRefresh,
  onBack,
}: GroupListScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [refreshing, setRefreshing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [flippedGroupId, setFlippedGroupId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [emojis, setEmojis] = useState<Record<string, GroupCardEmoji>>({});
  const [, setSummaryVersion] = useState(0);
  const cardWidth = Math.max(240, windowWidth - SIDE_PEEK * 2);
  const snapInterval = cardWidth + CARD_GAP;
  const { orderedGroupIds, hydrated, saveFailed, commitOrder } = useGroupCardOrder({
    serverGroupIds: groups.map((group) => group.groupId),
    userId,
  });
  const orderedGroups = useMemo(() => {
    if (!hydrated) return groups;
    const groupById = new Map(groups.map((group) => [group.groupId, group]));
    return orderedGroupIds.flatMap((groupId) => {
      const group = groupById.get(groupId);
      return group ? [group] : [];
    });
  }, [groups, hydrated, orderedGroupIds]);
  const pageCount = orderedGroups.length + 1;
  const listRef = useRef<FlatList<GroupSummaryResponse>>(null);
  const activeIdentityRef = useRef<string | null>(orderedGroups[0]?.groupId ?? null);
  const orderedGroupsRef = useRef(orderedGroups);
  orderedGroupsRef.current = orderedGroups;
  const roomReturnRef = useRef<GroupRoomReturnContext | null>(null);
  const frontFocusRef = useRef<View | null>(null);
  const roomFocusRef = useRef<View | null>(null);
  const summaryDate = todayStrKst();
  const summaryAdapter = useMemo(() => new GroupCardSummaryAdapter(groupFocusStatusStore), []);

  useEffect(() => {
    summaryAdapter.setScope(
      userId ? { userId, date: summaryDate, groupIds: groups.map((group) => group.groupId) } : null,
    );
    setSummaryVersion((version) => version + 1);
  }, [groups, summaryAdapter, summaryDate, userId]);

  useEffect(() => {
    const refresh = () => setSummaryVersion((version) => version + 1);
    const unsubscribeSummary = summaryAdapter.subscribe(refresh);
    const unsubscribeFocus = userId
      ? groupFocusStatusStore.subscribe(userId, summaryDate, refresh)
      : () => undefined;
    return () => {
      unsubscribeSummary();
      unsubscribeFocus();
    };
  }, [summaryAdapter, summaryDate, userId]);

  useEffect(() => {
    let active = true;
    Promise.all(
      groups.map(
        async (group) => [group.groupId, await readGroupCardEmoji(userId, group.groupId)] as const,
      ),
    )
      .then((entries) => {
        if (active) setEmojis(Object.fromEntries(entries));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [groups, groupsRevision, isScreenFocused, userId]);

  // 새로고침이 끝나기 전에 이 화면이 사라질 수 있다(그룹이 1건이 되면 GroupScreen이 그룹방으로
  // 갈아끼운다) — 언마운트 뒤 setState를 막는다.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [onRefresh]);

  const selectPage = useCallback(
    (page: number) => {
      const next = Math.max(0, Math.min(page, pageCount - 1));
      const from = activeIndex;
      if (from === next) return;
      listRef.current?.scrollToOffset({ offset: next * snapInterval, animated: true });
      activeIdentityRef.current = orderedGroups[next]?.groupId ?? null;
      setActiveIndex(next);
      setFlippedGroupId(null);
      logGroupCarouselPaged({
        trigger: 'indicator_press',
        from_index: from,
        to_index: next,
        group_count_bucket: groupCountBucket(orderedGroups.length),
      });
    },
    [activeIndex, orderedGroups, pageCount, snapInterval],
  );

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.max(
        0,
        Math.min(Math.round(event.nativeEvent.contentOffset.x / snapInterval), pageCount - 1),
      );
      const nextIdentity = orderedGroups[next]?.groupId ?? null;
      if (activeIdentityRef.current !== nextIdentity) {
        logGroupCarouselPaged({
          trigger: 'swipe',
          from_index: activeIndex,
          to_index: next,
          group_count_bucket: groupCountBucket(orderedGroups.length),
        });
        setFlippedGroupId(null);
      }
      activeIdentityRef.current = nextIdentity;
      setActiveIndex(next);
    },
    [activeIndex, orderedGroups, pageCount, snapInterval],
  );

  // 회전·폭 변경·서버 순서 변경 뒤에도 index가 아니라 stable groupId로 같은 페이지를 찾는다.
  useEffect(() => {
    const identity = activeIdentityRef.current;
    const next =
      identity === null
        ? orderedGroups.length
        : orderedGroups.findIndex((g) => g.groupId === identity);
    const safeIndex =
      next >= 0 ? next : Math.min(activeIndex, Math.max(0, orderedGroups.length - 1));
    activeIdentityRef.current = orderedGroups[safeIndex]?.groupId ?? null;
    setActiveIndex(safeIndex);
    listRef.current?.scrollToOffset({ offset: safeIndex * snapInterval, animated: false });
  }, [activeIndex, orderedGroups, snapInterval]);

  const focusNode = useCallback((ref: { current: View | null }) => {
    requestAnimationFrame(() => {
      const node = findNodeHandle(ref.current);
      if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
    });
  }, []);

  // 복귀 판단은 출발 뒤 성공한 전체 목록 revision을 받은 뒤에만 한다. 조회 실패나 부분 응답을
  // 탈퇴로 추정해 다른 카드를 복원하지 않는다.
  useEffect(() => {
    const context = roomReturnRef.current;
    if (!isScreenFocused || !context || groupsRevision <= context.departureRevision || !hydrated)
      return;

    const target = resolveGroupRoomReturn(
      context,
      orderedGroups.map((group) => group.groupId),
    );
    roomReturnRef.current = null;
    if (target.kind === 'empty') return;

    activeIdentityRef.current = target.groupId;
    setActiveIndex(target.index);
    listRef.current?.scrollToOffset({ offset: target.index * snapInterval, animated: false });
    if (target.kind === 'same_back') {
      setFlippedGroupId(target.groupId);
      focusNode(roomFocusRef);
    } else {
      setFlippedGroupId(null);
      focusNode(frontFocusRef);
    }
  }, [focusNode, groupsRevision, hydrated, isScreenFocused, orderedGroups, snapInterval]);

  // grip에서 시작한 포인터만 재정렬이 소유한다. 그동안 FlatList의 수평 pan과 본문 tap은
  // 비활성화되며, release에서 실제 순서가 달라진 경우에만 한 번 commit한다.
  const dragRef = useRef<{
    groupId: string;
    from: number;
    target: number;
    edgeOffset: number;
  } | null>(null);
  const lastEdgePageAtRef = useRef(0);
  const respondersRef = useRef(new Map<string, ReturnType<typeof PanResponder.create>>());

  const commitMove = useCallback(
    (groupId: string, targetIndex: number, trigger: GroupCardReorderTrigger) => {
      const ids = orderedGroupsRef.current.map((group) => group.groupId);
      const from = ids.indexOf(groupId);
      const target = Math.max(0, Math.min(targetIndex, ids.length - 1));
      if (from < 0 || from === target) return false;
      const next = [...ids];
      next.splice(from, 1);
      next.splice(target, 0, groupId);
      const committed = commitOrder(next);
      if (committed) {
        logGroupCardReordered({
          trigger,
          from_index: from,
          to_index: target,
          group_count_bucket: groupCountBucket(ids.length),
        });
        activeIdentityRef.current = groupId;
        setActiveIndex(target);
        listRef.current?.scrollToOffset({ offset: target * snapInterval, animated: false });
      }
      return committed;
    },
    [commitOrder, snapInterval],
  );

  const handlersFor = useCallback(
    (groupId: string) => {
      const cached = respondersRef.current.get(groupId);
      if (cached) return cached.panHandlers;
      const responder = PanResponder.create({
        onStartShouldSetPanResponder: () => hydrated,
        onMoveShouldSetPanResponder: () => hydrated,
        onPanResponderGrant: () => {
          if (!hydrated) return;
          const from = orderedGroupsRef.current.findIndex((group) => group.groupId === groupId);
          if (from < 0) return;
          dragRef.current = { groupId, from, target: from, edgeOffset: 0 };
          lastEdgePageAtRef.current = 0;
          setDraggingGroupId(groupId);
          setFlippedGroupId(null);
        },
        onPanResponderMove: (_event, gesture) => {
          const drag = dragRef.current;
          if (!drag) return;
          const max = orderedGroupsRef.current.length - 1;
          const pointerDelta = Math.round(gesture.dx / snapInterval);
          drag.target = resolveDragTarget(drag.from, pointerDelta, drag.edgeOffset, 0, max).target;

          const direction =
            gesture.moveX < DRAG_EDGE ? -1 : gesture.moveX > windowWidth - DRAG_EDGE ? 1 : 0;
          const now = Date.now();
          if (direction !== 0 && now - lastEdgePageAtRef.current >= EDGE_PAGE_THROTTLE_MS) {
            const next = resolveDragTarget(
              drag.from,
              pointerDelta,
              drag.edgeOffset,
              direction,
              max,
            );
            drag.edgeOffset = next.edgeOffset;
            drag.target = next.target;
            lastEdgePageAtRef.current = now;
            listRef.current?.scrollToOffset({
              offset: drag.target * snapInterval,
              animated: true,
            });
          }
        },
        onPanResponderRelease: () => {
          const drag = dragRef.current;
          dragRef.current = null;
          setDraggingGroupId(null);
          if (drag) commitMove(drag.groupId, drag.target, 'drag');
        },
        onPanResponderTerminate: () => {
          dragRef.current = null;
          setDraggingGroupId(null);
        },
      });
      respondersRef.current.set(groupId, responder);
      return responder.panHandlers;
    },
    [commitMove, hydrated, snapInterval, windowWidth],
  );

  useEffect(() => {
    respondersRef.current.clear();
  }, [hydrated, orderedGroupIds]);

  return (
    <View style={s.root} testID="group.list">
      <View style={s.header}>
        {/* 백버튼 규격은 그룹 스택 화면(GroupCreateScreen·NoticeScreen)의 s.backBtn과 같은 32/r16 */}
        {onBack && (
          <TouchableOpacity
            style={s.backBtn}
            onPress={onBack}
            activeOpacity={0.7}
            accessibilityLabel="뒤로"
            testID="group.list.back"
          >
            <Ionicons name="chevron-back" size={18} color={T.inkSub} />
          </TouchableOpacity>
        )}
        <Text style={s.headerTitle}>내 그룹</Text>
      </View>

      <FlatList
        ref={listRef}
        testID="group.list.items"
        data={orderedGroups}
        keyExtractor={(item) => item.groupId}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[s.listContent, { paddingHorizontal: SIDE_PEEK }]}
        ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
        snapToInterval={snapInterval}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        scrollEnabled={draggingGroupId === null}
        onMomentumScrollEnd={onMomentumScrollEnd}
        ListFooterComponent={
          <View style={{ marginLeft: CARD_GAP }}>
            <FindMoreCard width={cardWidth} onPress={onFind} />
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={T.accent} />
        }
        renderItem={({ item, index }) => (
          <View style={{ width: cardWidth }} testID={`group.list.card.${item.groupId}`}>
            {flippedGroupId === item.groupId ? (
              <GroupCardBack
                group={item}
                snapshot={summaryAdapter.getSnapshot(item.groupId)}
                focusRef={activeIdentityRef.current === item.groupId ? roomFocusRef : undefined}
                onRetry={(dependency) => {
                  summaryAdapter.retry(item.groupId, dependency).catch(() => undefined);
                }}
                onRoom={() => {
                  logGroupCardActionClicked({
                    action: 'room',
                    role: item.role === 'OWNER' ? 'owner' : 'member',
                    back_source: 'user',
                    interaction_id: transientInteractionId(),
                  });
                  roomReturnRef.current = {
                    groupId: item.groupId,
                    sourceIndex: index,
                    departureRevision: groupsRevision,
                  };
                  onSelect(item.groupId);
                }}
                onFront={() => {
                  setFlippedGroupId(null);
                  logGroupCardFlipped({
                    to_face: 'front',
                    trigger: 'card_tap',
                    group_count_bucket: groupCountBucket(orderedGroups.length),
                  });
                }}
              />
            ) : (
              <GroupCardFront
                group={item}
                emoji={emojis[item.groupId] ?? DEFAULT_GROUP_CARD_EMOJI}
                bodyRef={activeIdentityRef.current === item.groupId ? frontFocusRef : undefined}
                onFlip={() => {
                  if (draggingGroupId !== null) return;
                  setFlippedGroupId(item.groupId);
                  logGroupCardFlipped({
                    to_face: 'back',
                    trigger: 'card_tap',
                    group_count_bucket: groupCountBucket(orderedGroups.length),
                  });
                  summaryAdapter.ensureBack(item.groupId).catch(() => undefined);
                }}
                reorderHandlers={hydrated ? handlersFor(item.groupId) : undefined}
                canMovePrevious={hydrated && index > 0}
                canMoveNext={hydrated && index < orderedGroups.length - 1}
                onMoveStep={(step) => {
                  if (!hydrated) return;
                  const from = orderedGroupsRef.current.findIndex(
                    (group) => group.groupId === item.groupId,
                  );
                  if (commitMove(item.groupId, from + step, 'accessibility_action'))
                    setFlippedGroupId(null);
                }}
              />
            )}
          </View>
        )}
      />

      {saveFailed && (
        <Text style={s.saveError} accessibilityRole="alert">
          순서를 저장하지 못했어요. 다음 변경 때 다시 시도합니다.
        </Text>
      )}

      <PageIndicator pageCount={pageCount} activeIndex={activeIndex} onSelectPage={selectPage} />

      {/* ── 하단 고정 CTA — 빈 상태(GroupScreen)와 같은 52/r16 규격을 그대로 쓴다 ── */}
      <View style={[s.footer, { paddingBottom: insets.bottom + TAB_BAR_SPACE }]}>
        <TouchableOpacity
          style={s.primaryBtn}
          activeOpacity={0.85}
          onPress={onCreate}
          testID="group.list.create"
        >
          <Text style={s.primaryText}>그룹 만들기</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.outlineBtn}
          activeOpacity={0.85}
          onPress={onFind}
          testID="group.list.find"
        >
          <Text style={s.outlineText}>그룹 찾기</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  // 헤더는 좌우 20(T.space.xl) — 홈·리그·전체 탭의 화면 제목과 시작선을 맞춘다(공지 화면과 같은 값).
  // 백버튼이 없을 땐 gap이 붙어도 자식이 하나라 시작선이 그대로다.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.sm,
    paddingBottom: T.space.md,
  },
  headerTitle: { ...T.text.title, color: T.ink },
  // 그룹 스택 화면(GroupCreateScreen s.backBtn)과 같은 규격 — 32/r16/white/border
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  listContent: { paddingBottom: T.space.md },

  backPlaceholder: {
    minHeight: 300,
    borderRadius: 22,
    padding: T.space.xl,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    justifyContent: 'center',
    gap: T.space.lg,
  },
  backTitle: { ...T.text.heading, color: T.ink },
  backDesc: { ...T.text.body, color: T.inkSub },
  backPrimary: {
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  backPrimaryText: { ...T.text.label, color: T.white },
  backLink: { ...T.text.caption, color: T.accent, textAlign: 'center' },
  saveError: {
    ...T.text.caption,
    color: T.dangerInk,
    textAlign: 'center',
    paddingTop: T.space.xs,
  },

  footer: { paddingHorizontal: T.space.xxl, paddingTop: T.space.md },
  // 화면 CTA = 52 / r16 (그룹 화면 공통 규격 — GroupScreen 빈 상태와 같은 값)
  primaryBtn: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  primaryText: { ...T.text.subtitle, color: T.white },
  outlineBtn: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
  },
  outlineText: { ...T.text.subtitle, color: T.ink },
});
