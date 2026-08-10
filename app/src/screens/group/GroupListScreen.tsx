import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
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
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
import { T } from '@/constants/theme';
import { STORAGE_KEYS } from '@/types/storage';
import { enterUp } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
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
import { GroupFocusPollingController, groupFocusStatusStore } from './groupFocusStatus';
import { todayStrKst } from '@/utils/localDate';
import {
  logGroupCardActionClicked,
  logGroupCardDeckViewed,
  logGroupCardFlipped,
  logGroupCardReordered,
  logGroupCarouselPaged,
  logGroupDeckGuideReadFailed,
  logGroupDeckGuideWriteFailed,
  logTabGuideCompleted,
  type GroupCardReorderTrigger,
  type GroupCountBucket,
  type GroupEntry,
} from '@/services/analyticsEvents';
import {
  createCardInteractionContext,
  type CardInteractionContext,
} from '@/services/cardInteraction';
import {
  completeGroupDeckGuide,
  GROUP_DECK_GUIDE_ID,
  isGroupDeckGuideCompletedInSession,
  resolveGroupDeckGuideDecision,
  type GroupDeckGuideReadState,
} from './groupDeckGuide';

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
const GUIDE_CHARACTER = require('@/assets/character_study.png');

function groupCountBucket(count: number): GroupCountBucket {
  if (count === 1) return '1';
  if (count <= 5) return '2_5';
  if (count <= 10) return '6_10';
  return '11_plus';
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

/**
 * 카드 한 장의 최소 높이 — 로딩 스켈레톤(GroupScreen)이 같은 실루엣을 그리도록 공유하는 상수.
 * 내역: paddingVertical 16×2 + borderWidth 1×2 + 이름 한 줄(T.text.subtitle 19pt ≈ 23) = 58.
 * 아래 s.card의 minHeight로도 걸어 둔다 — 스켈레톤과 실제 카드가 **같은 값에 묶여 있어야**
 * 카드 규격이 바뀔 때 자리표시자만 옛 치수로 남는 일이 없다. 소개(description)가 있는 카드는
 * 이보다 커지므로, 데이터 도착 시 어긋남은 '아래로 늘어나는' 방향뿐이다(위로 줄어드는 점프 없음).
 */
export const GROUP_CARD_HEIGHT = 300;

// FlatList 셀 래퍼 props — RN이 CellRendererComponent에 넘기는 것들.
// (@react-native/virtualized-lists의 CellRendererProps는 앱에서 직접 해석되지 않는 중첩 패키지라
//  같은 모양을 로컬 타입으로 둔다.)
//
// ⚠️ **여기 있는 props는 하나도 떨어뜨리면 안 된다.** 특히 `onFocusCapture`는 VirtualizedList가
//    마지막 포커스 셀을 기록해 가상화 렌더 영역 안에 유지하는 경로다 — 삼키면 스크롤·목록 갱신
//    때 포커스된 카드가 재활용되면서 스크린리더/키보드 포커스를 잃는다(codex 리뷰).
//    그래서 아래 구현은 index/children만 꺼내고 **나머지는 통째로 전달**한다.
interface CellProps {
  index: number;
  children: ReactNode;
  cellKey?: string;
  item?: GroupSummaryResponse;
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
  // 우리는 해석하지 않고 그대로 전달만 한다 — RN 내부 셀 타입의 FocusEvent는 DOM 계열이라
  // 여기서 같은 이름으로 재선언하면 오히려 타입이 어긋난다.
  onFocusCapture?: unknown;
}

// 카드 진입 시차 — FlatList가 셀마다 두르는 래퍼 View를 Animated.View로 갈아끼운다.
// 트리에 뷰를 **새로 끼우지 않으므로** testID 셀렉터(E2E) 계약이 그대로다.
// 모듈 스코프 컴포넌트라 렌더마다 타입이 바뀌지 않는다 — 매 렌더 새 컴포넌트를 만들면 셀이
// 통째로 리마운트되어 진입 애니메이션이 계속 다시 재생된다.
//
// ⚠️ 진입 시차 인덱스는 **마운트 시점 값으로 고정한다.** enterUp은 인덱스별 캐시라 참조가
//    갈리고, Reanimated CSS는 참조 동등성으로 애니메이션 재시작을 판단한다. 목록은 재조회로
//    갱신되고(생성·참여·나가기 뒤 서버 순서가 바뀔 수 있다) 셀은 groupId 키로 살아남으므로,
//    인덱스를 그대로 넘기면 순서가 밀린 카드들이 이유 없이 다시 떠오른다(claude 리뷰 —
//    리그 랭킹 행과 같은 결함이고, 여기 고치는 비용은 두 줄이다).
// ⚠️ 얼리는 것은 enterUp의 **인자**다. m.css()는 매 렌더 통과시켜야 '동작 줄이기'가 반영된다.
// index·children과, 호스트 뷰가 모르는 값(item·cellKey)만 꺼내고 나머지는 통째로 전달한다.
function GroupListCell({
  index,
  children,
  item: _item,
  cellKey: _cellKey,
  style,
  ...rest
}: CellProps) {
  const m = useMotion();
  const enterIndex = useRef(index).current;
  return (
    <Animated.View {...rest} style={[style, m.enter(enterUp(enterIndex))]}>
      {children}
    </Animated.View>
  );
}

export interface GroupListScreenProps {
  groups: GroupSummaryResponse[];
  groupsRevision?: number;
  isScreenFocused?: boolean;
  userId?: string | null;
  onSelect: (groupId: string, interaction: CardInteractionContext) => void;
  onFocus: (groupId: string, interaction: CardInteractionContext) => void;
  onSettings: (groupId: string) => void;
  viewEpisodeId: number;
  groupEntry: GroupEntry;
  guideBlocked?: boolean;
  guideScreenFocused?: boolean;
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
  onFocus,
  onSettings,
  viewEpisodeId,
  groupEntry,
  guideBlocked = false,
  guideScreenFocused = true,
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
  const [orderMenuGroupId, setOrderMenuGroupId] = useState<string | null>(null);
  // RN 부팅 직후 currentState가 null일 수 있다. background/inactive 신호 전에는 foreground
  // 후보로 두고 listener가 이후 확정한다.
  const [appActive, setAppActive] = useState(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  const [summaryDate, setSummaryDate] = useState(todayStrKst);
  const [exposedEpisodeId, setExposedEpisodeId] = useState<number | null>(null);
  const [guideQueued, setGuideQueued] = useState(false);
  const [guideVisible, setGuideVisible] = useState(false);
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
  // hydration 전 서버 첫 카드를 현재 위치로 확정하지 않는다. undefined는 아직 위치 미확정,
  // null은 사용자가 끝의 찾기 카드를 선택한 상태다.
  const activeIdentityRef = useRef<string | null | undefined>(undefined);
  const orderedGroupsRef = useRef(orderedGroups);
  orderedGroupsRef.current = orderedGroups;
  const roomReturnRef = useRef<GroupRoomReturnContext | null>(null);
  const frontFocusRef = useRef<View | null>(null);
  const roomFocusRef = useRef<View | null>(null);
  const actionLockedRef = useRef(false);
  const [pendingFrontFocusGroupId, setPendingFrontFocusGroupId] = useState<string | null>(null);
  const summaryAdapter = useMemo(() => new GroupCardSummaryAdapter(groupFocusStatusStore), []);
  const focusPolling = useMemo(
    () =>
      userId ? new GroupFocusPollingController({ store: groupFocusStatusStore, userId }) : null,
    [userId],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
      if (state === 'active') setSummaryDate(todayStrKst());
    });
    const dateTimer = setInterval(() => setSummaryDate(todayStrKst()), 30_000);
    return () => {
      subscription.remove();
      clearInterval(dateTimer);
    };
  }, []);

  useEffect(() => {
    if (isScreenFocused) actionLockedRef.current = false;
  }, [isScreenFocused]);

  // 완료 key read와 현재 blocking overlay 판정이 끝나기 전에는 덱을 열지 않는다. 이 시점의
  // guide_state를 episode의 불변 노출 값으로 기록하고, pending이었다면 blocker 해제 뒤 queue를 연다.
  useEffect(() => {
    if (!hydrated || exposedEpisodeId === viewEpisodeId) return;
    let canceled = false;
    const settle = (readState: GroupDeckGuideReadState) => {
      if (canceled) return;
      const decision = resolveGroupDeckGuideDecision(readState, guideBlocked);
      logGroupCardDeckViewed({
        group_count_bucket: groupCountBucket(orderedGroups.length),
        group_entry: groupEntry,
        guide_state: decision.exposure,
      });
      setGuideQueued(decision.queue);
      setExposedEpisodeId(viewEpisodeId);
    };
    AsyncStorage.getItem(STORAGE_KEYS.guideGroupDeck)
      .then((value) =>
        settle(value === '1' || isGroupDeckGuideCompletedInSession() ? 'completed' : 'incomplete'),
      )
      .catch(() => {
        logGroupDeckGuideReadFailed();
        settle('unknown');
      });
    return () => {
      canceled = true;
    };
  }, [exposedEpisodeId, groupEntry, guideBlocked, hydrated, orderedGroups.length, viewEpisodeId]);

  useEffect(() => {
    if (!guideQueued || guideVisible || guideBlocked || !guideScreenFocused || !appActive) return;
    setGuideVisible(true);
  }, [appActive, guideBlocked, guideQueued, guideScreenFocused, guideVisible]);

  useEffect(() => {
    if (guideVisible && (guideBlocked || !guideScreenFocused || !appActive)) {
      setGuideVisible(false);
    }
  }, [appActive, guideBlocked, guideScreenFocused, guideVisible]);

  useEffect(() => {
    focusPolling?.setLifecycle({
      screenFocused: isScreenFocused,
      appActive,
      hasGroups: groups.length > 0,
    });
  }, [appActive, focusPolling, groups.length, isScreenFocused]);

  useEffect(() => () => focusPolling?.dispose(), [focusPolling]);

  useEffect(() => {
    summaryAdapter.setScope(
      userId ? { userId, date: summaryDate, groupIds: groups.map((group) => group.groupId) } : null,
    );
    setSummaryVersion((version) => version + 1);
    if (flippedGroupId) summaryAdapter.ensureBack(flippedGroupId).catch(() => undefined);
  }, [flippedGroupId, groups, summaryAdapter, summaryDate, userId]);

  const guideSteps = useMemo<GuideStep[]>(
    () => [
      { text: '내 그룹이 카드로 모였어. 같이 둘러보자!', character: GUIDE_CHARACTER },
      {
        text:
          orderedGroups.length >= 2
            ? '옆으로 넘기면 다른 그룹을 볼 수 있어.'
            : '이 카드가 내 그룹이야. 그룹이 늘면 옆으로 넘길 수 있어.',
        character: GUIDE_CHARACTER,
      },
      { text: '카드를 탭하면 오늘의 방 상태를 볼 수 있어.', character: GUIDE_CHARACTER },
      {
        text: '여기서 바로 집중하거나 방 전체를 열 수 있어.',
        character: GUIDE_CHARACTER,
      },
    ],
    [orderedGroups.length],
  );

  const finishGuide = useCallback(() => {
    if (
      completeGroupDeckGuide(
        () => logTabGuideCompleted({ guide: GROUP_DECK_GUIDE_ID }),
        () => AsyncStorage.setItem(STORAGE_KEYS.guideGroupDeck, '1'),
        logGroupDeckGuideWriteFailed,
      )
    ) {
      setGuideVisible(false);
      setGuideQueued(false);
    }
  }, []);

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
    (page: number, trigger: 'indicator_press' | 'accessibility_action' = 'indicator_press') => {
      const next = Math.max(0, Math.min(page, pageCount - 1));
      const from = activeIndex;
      if (from === next) return;
      listRef.current?.scrollToOffset({ offset: next * snapInterval, animated: true });
      activeIdentityRef.current = orderedGroups[next]?.groupId ?? null;
      setActiveIndex(next);
      setFlippedGroupId(null);
      logGroupCarouselPaged({
        trigger,
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
      identity === undefined
        ? 0
        : identity === null
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
      setPendingFrontFocusGroupId(target.groupId);
    }
  }, [focusNode, groupsRevision, hydrated, isScreenFocused, orderedGroups, snapInterval]);

  useEffect(() => {
    if (pendingFrontFocusGroupId === null) return;
    if (activeIdentityRef.current !== pendingFrontFocusGroupId || frontFocusRef.current === null)
      return;
    focusNode(frontFocusRef);
    setPendingFrontFocusGroupId(null);
  }, [focusNode, pendingFrontFocusGroupId]);

  // grip에서 시작한 포인터만 재정렬이 소유한다. 그동안 FlatList의 수평 pan과 본문 tap은
  // 비활성화되며, release에서 실제 순서가 달라진 경우에만 한 번 commit한다.
  const dragRef = useRef<{
    groupId: string;
    from: number;
    target: number;
    edgeOffset: number;
    moved: boolean;
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
          dragRef.current = { groupId, from, target: from, edgeOffset: 0, moved: false };
          lastEdgePageAtRef.current = 0;
          setDraggingGroupId(groupId);
          setFlippedGroupId(null);
        },
        onPanResponderMove: (_event, gesture) => {
          const drag = dragRef.current;
          if (!drag) return;
          if (Math.abs(gesture.dx) > 8) drag.moved = true;
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
          if (!drag) return;
          if (drag.moved) commitMove(drag.groupId, drag.target, 'drag');
          else setOrderMenuGroupId(drag.groupId);
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

  if (!hydrated || exposedEpisodeId !== viewEpisodeId) {
    return (
      <View style={s.loading} testID="group.deck.loading">
        <ActivityIndicator color={T.accent} />
      </View>
    );
  }

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
        CellRendererComponent={GroupListCell}
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
                  if (actionLockedRef.current) return;
                  actionLockedRef.current = true;
                  const interaction = createCardInteractionContext();
                  logGroupCardActionClicked({
                    action: 'room',
                    role: item.role === 'OWNER' ? 'owner' : 'member',
                    back_source: 'user',
                    interaction_id: interaction.interactionId,
                  });
                  roomReturnRef.current = {
                    groupId: item.groupId,
                    sourceIndex: index,
                    departureRevision: groupsRevision,
                  };
                  onSelect(item.groupId, interaction);
                }}
                onFocus={() => {
                  if (actionLockedRef.current) return;
                  actionLockedRef.current = true;
                  const interaction = createCardInteractionContext();
                  logGroupCardActionClicked({
                    action: 'focus',
                    role: item.role === 'OWNER' ? 'owner' : 'member',
                    back_source: 'user',
                    interaction_id: interaction.interactionId,
                  });
                  onFocus(item.groupId, interaction);
                }}
                onSettings={() => {
                  if (actionLockedRef.current) return;
                  actionLockedRef.current = true;
                  const interaction = createCardInteractionContext();
                  logGroupCardActionClicked({
                    action: 'settings',
                    role: item.role === 'OWNER' ? 'owner' : 'member',
                    back_source: 'user',
                    interaction_id: interaction.interactionId,
                  });
                  onSettings(item.groupId);
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
                  focusPolling?.activate();
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

      {orderMenuGroupId !== null && (
        <View style={s.orderMenu} testID={`group.card.orderMenu.${orderMenuGroupId}`}>
          <Text style={s.orderMenuTitle}>카드 순서 변경</Text>
          <View style={s.orderMenuActions}>
            <TouchableOpacity
              onPress={() => {
                const from = orderedGroupsRef.current.findIndex(
                  (group) => group.groupId === orderMenuGroupId,
                );
                commitMove(orderMenuGroupId, from - 1, 'pointer_control');
                setOrderMenuGroupId(null);
              }}
              disabled={orderedGroups[0]?.groupId === orderMenuGroupId}
              testID="group.card.orderMenu.previous"
            >
              <Text style={s.backLink}>앞으로</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                const from = orderedGroupsRef.current.findIndex(
                  (group) => group.groupId === orderMenuGroupId,
                );
                commitMove(orderMenuGroupId, from + 1, 'pointer_control');
                setOrderMenuGroupId(null);
              }}
              disabled={orderedGroups[orderedGroups.length - 1]?.groupId === orderMenuGroupId}
              testID="group.card.orderMenu.next"
            >
              <Text style={s.backLink}>뒤로</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setOrderMenuGroupId(null)}>
              <Text style={s.backLink}>취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

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

      <TabGuideOverlay
        storageKey={STORAGE_KEYS.guideGroupDeck}
        steps={guideSteps}
        visible={guideVisible}
        completionMode="external"
        allowRequestClose={false}
        testID="group.deck.guide"
        onFinish={finishGuide}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

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
  orderMenu: {
    marginHorizontal: T.space.xl,
    padding: T.space.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: T.white,
    gap: T.space.sm,
  },
  orderMenuTitle: { ...T.text.label, color: T.ink },
  orderMenuActions: { flexDirection: 'row', justifyContent: 'space-around' },

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
