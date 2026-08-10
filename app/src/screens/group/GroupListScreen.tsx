import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  FlatList,
  findNodeHandle,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
import { T } from '@/constants/theme';
import { STORAGE_KEYS } from '@/types/storage';
import {
  logGroupCardActionClicked,
  logGroupCardDeckViewed,
  logGroupCardFlipped,
  logGroupCardReordered,
  logGroupCarouselPaged,
  logGroupDeckGuideInterrupted,
  logGroupDeckGuideReadFailed,
  logGroupDeckGuideWriteFailed,
  logTabGuideCompleted,
  type GroupCountBucket,
  type GroupEntry,
  type GroupCardFlipTrigger,
  type GroupCarouselTrigger,
} from '@/services/analyticsEvents';
import {
  createCardInteractionContext,
  type CardInteractionContext,
} from '@/services/cardInteraction';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { FindMoreCard } from './components/FindMoreCard';
import { PageIndicator } from './components/PageIndicator';
import { GroupCardFront } from './components/GroupCardFront';
import { GroupCardBack } from './components/GroupCardBack';
import { useGroupCardOrder } from './useGroupCardOrder';
import { useGroupCardEmojis } from './useGroupCardEmojis';
import { useGroupCardData } from './useGroupCardData';
import { resolveGroupRoomReturn, type GroupRoomReturnContext } from './groupRoomReturn';
import {
  GROUP_DECK_GUIDE_ID,
  completeGroupDeckGuide,
  groupDeckGuideSteps,
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

export function advanceEdgeTarget(current: number, direction: -1 | 1, max: number): number {
  return Math.max(0, Math.min(current + direction, max));
}

const GUIDE_CHARACTER = {
  hi: require('@/assets/character_hi.png'),
  study: require('@/assets/character_study.png'),
  happy: require('@/assets/character_happy.png'),
} as const;

function groupCountBucket(count: number): Exclude<GroupCountBucket, '0'> {
  if (count === 1) return '1';
  if (count <= 5) return '2_5';
  if (count <= 10) return '6_10';
  return '11_plus';
}

export interface GroupListScreenProps {
  groups: GroupSummaryResponse[];
  groupsRevision?: number;
  isScreenFocused?: boolean;
  userId?: string | null;
  onSelect: (groupId: string, interaction: CardInteractionContext) => void;
  onCreate: () => void;
  onFind: () => void;
  onStartFocus?: (groupId: string, interaction: CardInteractionContext) => void;
  onOpenSettings?: (groupId: string) => void;
  onRefresh: () => Promise<void>;
  onBack?: () => void;
  // guide eligibility는 성공 목록만으로 부족하다. 인증·route·overlay queue 상태를 부모가 제공한다.
  guideBlocked?: boolean;
  guideScreenFocused?: boolean;
  guideEpisode?: number;
  groupEntry?: GroupEntry;
  guideDataReady?: boolean;
  guideDataFailed?: boolean;
  // 사용자 첫 back과 guide 3→4가 공유하는 lazy ensure 경로다.
  onEnsureBack?: (groupId: string) => void;
}

export default function GroupListScreen({
  groups,
  groupsRevision = 0,
  isScreenFocused = true,
  userId = null,
  onSelect,
  onCreate,
  onFind,
  onStartFocus = () => undefined,
  onOpenSettings = () => undefined,
  onRefresh,
  onBack,
  guideBlocked = false,
  guideScreenFocused = true,
  guideEpisode = 0,
  groupEntry = 'unknown',
  guideDataReady = true,
  guideDataFailed = false,
  onEnsureBack,
}: GroupListScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [refreshing, setRefreshing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeStableGroupId, setActiveStableGroupId] = useState<string | null>(
    groups[0]?.groupId ?? null,
  );
  const [flippedGroupId, setFlippedGroupId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [reorderMenuGroupId, setReorderMenuGroupId] = useState<string | null>(null);
  const [deckLayoutReady, setDeckLayoutReady] = useState(false);
  const [activeAnchorGroupId, setActiveAnchorGroupId] = useState<string | null>(null);
  const guideManaged = typeof userId === 'string';
  const [guideInputReady, setGuideInputReady] = useState(!guideManaged);
  const [guideQueued, setGuideQueued] = useState(false);
  const [guideVisible, setGuideVisible] = useState(false);
  // RN 부팅 직후 currentState가 아직 null일 수 있다. 실제 background/inactive 신호가 오기 전에는
  // foreground 후보로 두고, listener가 확정 상태를 갱신한다.
  const [appActive, setAppActive] = useState(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
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
  const dataGroupIds = useMemo(() => orderedGroups.map((group) => group.groupId), [orderedGroups]);
  const { hydrated: emojiHydrated, emojiFor } = useGroupCardEmojis({
    userId,
    groupIds: dataGroupIds,
    reloadToken: groupsRevision,
  });
  const { snapshots, ensureBack, retry } = useGroupCardData({
    userId,
    groupIds: dataGroupIds,
    screenFocused: isScreenFocused,
    reloadToken: groupsRevision,
  });
  const pageCount = orderedGroups.length + 1;
  const deckOrderKey = orderedGroups.map((group) => group.groupId).join('\u0000');
  const listRef = useRef<FlatList<GroupSummaryResponse>>(null);
  const activeIdentityRef = useRef<string | null>(orderedGroups[0]?.groupId ?? null);
  const activeIndexRef = useRef(0);
  const previousDeckOrderKeyRef = useRef(deckOrderKey);
  const previousSnapIntervalRef = useRef(snapInterval);
  const orderedGroupsRef = useRef(orderedGroups);
  orderedGroupsRef.current = orderedGroups;
  const roomReturnRef = useRef<GroupRoomReturnContext | null>(null);
  const frontFocusRef = useRef<View | null>(null);
  const roomFocusRef = useRef<View | null>(null);
  const deckAnchorRef = useRef<View | null>(null);
  const activeCardRef = useRef<View | null>(null);
  const guideDecisionEpisodeRef = useRef<number | null>(null);
  const guideReadStateRef = useRef<GroupDeckGuideReadState | null>(null);
  const guideStartGroupsRef = useRef<string | null>(null);
  const guideVisibleRef = useRef(false);
  const guideBlockedRef = useRef(guideBlocked);
  const guideBackGroupIdRef = useRef<string | null>(null);
  const actionPendingRef = useRef(false);
  const pendingFlipRef = useRef<{
    groupId: string;
    trigger: GroupCardFlipTrigger;
  } | null>(null);
  const groupFingerprint = orderedGroups.map((group) => group.groupId).join('|');
  const stableActiveIndex =
    activeStableGroupId === null
      ? orderedGroups.length
      : orderedGroups.findIndex((group) => group.groupId === activeStableGroupId);
  const renderedActiveIndex =
    stableActiveIndex >= 0
      ? stableActiveIndex
      : Math.min(activeIndex, Math.max(0, orderedGroups.length - 1));
  const activeGroupId = orderedGroups[renderedActiveIndex]?.groupId ?? null;
  const guideEligible =
    typeof userId === 'string' &&
    orderedGroups.length > 0 &&
    hydrated &&
    emojiHydrated &&
    guideDataReady &&
    deckLayoutReady &&
    activeAnchorGroupId === activeGroupId &&
    guideScreenFocused &&
    appActive;

  const acceptCardAction = useCallback(
    (group: GroupSummaryResponse, action: 'focus' | 'room' | 'settings') => {
      if (actionPendingRef.current || reorderMenuGroupId !== null) return null;
      actionPendingRef.current = true;
      const interaction = createCardInteractionContext();
      logGroupCardActionClicked({
        action,
        role: group.role === 'OWNER' ? 'owner' : 'member',
        back_source: guideBackGroupIdRef.current === group.groupId ? 'guide' : 'user',
        interaction_id: interaction.interactionId,
      });
      guideBackGroupIdRef.current = null;
      return interaction;
    },
    [reorderMenuGroupId],
  );

  const runCardAction = useCallback(
    (
      group: GroupSummaryResponse,
      action: 'focus' | 'room' | 'settings',
      callback: (interaction: CardInteractionContext) => void,
    ) => {
      const interaction = acceptCardAction(group, action);
      if (!interaction) return;
      try {
        callback(interaction);
      } catch (error) {
        actionPendingRef.current = false;
        throw error;
      }
    },
    [acceptCardAction],
  );

  const wasScreenFocusedRef = useRef(isScreenFocused);
  useEffect(() => {
    if (isScreenFocused && !wasScreenFocusedRef.current) actionPendingRef.current = false;
    wasScreenFocusedRef.current = isScreenFocused;
  }, [isScreenFocused]);

  // 새로고침이 끝나기 전에 이 화면이 사라질 수 있다(그룹이 1건이 되면 GroupScreen이 그룹방으로
  // 갈아끼운다) — 언마운트 뒤 setState를 막는다.
  const mountedRef = useRef(true);
  useEffect(() => {
    guideVisibleRef.current = guideVisible;
  }, [guideVisible]);
  guideBlockedRef.current = guideBlocked;

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (guideVisibleRef.current) logGroupDeckGuideInterrupted({ reason: 'unmount' });
    },
    [],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const active = next === 'active';
      setAppActive(active);
      if (!active && guideVisibleRef.current) {
        guideVisibleRef.current = false;
        setGuideVisible(false);
        setGuideQueued(guideReadStateRef.current !== 'unknown');
        logGroupDeckGuideInterrupted({ reason: 'background' });
      }
    });
    return () => subscription.remove();
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [onRefresh]);

  const focusNode = useCallback((ref: { current: View | null }) => {
    requestAnimationFrame(() => {
      const node = findNodeHandle(ref.current);
      if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
    });
  }, []);

  const completeUserFlipToBack = useCallback(
    (groupId: string, trigger: GroupCardFlipTrigger) => {
      pendingFlipRef.current = null;
      guideBackGroupIdRef.current = null;
      setFlippedGroupId(groupId);
      ensureBack(groupId);
      logGroupCardFlipped({
        to_face: 'back',
        trigger,
        group_count_bucket: groupCountBucket(orderedGroups.length),
      });
      focusNode(roomFocusRef);
    },
    [ensureBack, focusNode, orderedGroups.length],
  );

  const selectPage = useCallback(
    (page: number, trigger: GroupCarouselTrigger = 'indicator_press') => {
      const next = Math.max(0, Math.min(page, pageCount - 1));
      const from = activeIndexRef.current;
      listRef.current?.scrollToOffset({ offset: next * snapInterval, animated: true });
      const nextIdentity = orderedGroups[next]?.groupId ?? null;
      if (pendingFlipRef.current?.groupId !== nextIdentity) pendingFlipRef.current = null;
      activeIdentityRef.current = nextIdentity;
      activeIndexRef.current = next;
      setActiveStableGroupId(nextIdentity);
      setActiveIndex(next);
      setActiveAnchorGroupId(nextIdentity);
      setFlippedGroupId(null);
      guideBackGroupIdRef.current = null;
      if (from !== next) {
        logGroupCarouselPaged({
          trigger,
          from_index: from,
          to_index: next,
          group_count_bucket: groupCountBucket(orderedGroups.length),
        });
      }
    },
    [orderedGroups, pageCount, snapInterval],
  );

  const settleOffset = useCallback(
    (offsetX: number) => {
      const next = Math.max(0, Math.min(Math.round(offsetX / snapInterval), pageCount - 1));
      const nextIdentity = orderedGroups[next]?.groupId ?? null;
      const from = activeIndexRef.current;
      if (activeIdentityRef.current !== nextIdentity) setFlippedGroupId(null);
      activeIdentityRef.current = nextIdentity;
      activeIndexRef.current = next;
      setActiveStableGroupId(nextIdentity);
      setActiveIndex(next);
      setActiveAnchorGroupId(nextIdentity);
      guideBackGroupIdRef.current = null;
      if (from !== next) {
        logGroupCarouselPaged({
          trigger: 'swipe',
          from_index: from,
          to_index: next,
          group_count_bucket: groupCountBucket(orderedGroups.length),
        });
      }
      const pendingFlip = pendingFlipRef.current;
      if (pendingFlip?.groupId === nextIdentity && nextIdentity !== null) {
        completeUserFlipToBack(nextIdentity, pendingFlip.trigger);
      } else {
        pendingFlipRef.current = null;
      }
    },
    [completeUserFlipToBack, orderedGroups, pageCount, snapInterval],
  );

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) =>
      settleOffset(event.nativeEvent.contentOffset.x),
    [settleOffset],
  );

  const onScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const target = event.nativeEvent.targetContentOffset?.x;
      if (typeof target === 'number') settleOffset(target);
    },
    [settleOffset],
  );

  // 회전·폭 변경·서버 순서 변경 뒤에도 index가 아니라 stable groupId로 같은 페이지를 찾는다.
  useEffect(() => {
    const orderChanged = previousDeckOrderKeyRef.current !== deckOrderKey;
    const intervalChanged = previousSnapIntervalRef.current !== snapInterval;
    previousDeckOrderKeyRef.current = deckOrderKey;
    previousSnapIntervalRef.current = snapInterval;
    if (!orderChanged && !intervalChanged) return;
    const identity = activeIdentityRef.current;
    const next =
      identity === null
        ? orderedGroups.length
        : orderedGroups.findIndex((g) => g.groupId === identity);
    if (identity !== null && next < 0) {
      pendingFlipRef.current = null;
      setFlippedGroupId(null);
    }
    const safeIndex =
      next >= 0 ? next : Math.min(activeIndexRef.current, Math.max(0, orderedGroups.length - 1));
    activeIdentityRef.current = orderedGroups[safeIndex]?.groupId ?? null;
    activeIndexRef.current = safeIndex;
    setActiveStableGroupId(orderedGroups[safeIndex]?.groupId ?? null);
    setActiveIndex(safeIndex);
    listRef.current?.scrollToOffset({ offset: safeIndex * snapInterval, animated: false });
  }, [deckOrderKey, orderedGroups, snapInterval]);

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
    activeIndexRef.current = target.index;
    setActiveStableGroupId(target.groupId);
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
  const dragRef = useRef<{ groupId: string; from: number; target: number } | null>(null);
  const edgeDirectionRef = useRef<-1 | 0 | 1>(0);
  const edgeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const respondersRef = useRef(new Map<string, ReturnType<typeof PanResponder.create>>());

  const stopEdgePaging = useCallback(() => {
    edgeDirectionRef.current = 0;
    if (edgeTimerRef.current !== null) clearInterval(edgeTimerRef.current);
    edgeTimerRef.current = null;
  }, []);

  const startEdgePaging = useCallback(
    (direction: -1 | 1) => {
      if (edgeDirectionRef.current === direction && edgeTimerRef.current !== null) return;
      stopEdgePaging();
      edgeDirectionRef.current = direction;
      const page = () => {
        const drag = dragRef.current;
        if (!drag) return;
        const max = orderedGroupsRef.current.length - 1;
        const next = advanceEdgeTarget(drag.target, direction, max);
        if (next === drag.target) return;
        drag.target = next;
        listRef.current?.scrollToOffset({ offset: next * snapInterval, animated: true });
      };
      page();
      edgeTimerRef.current = setInterval(page, EDGE_PAGE_THROTTLE_MS);
    },
    [snapInterval, stopEdgePaging],
  );

  useEffect(() => stopEdgePaging, [stopEdgePaging]);

  const commitMove = useCallback(
    (
      groupId: string,
      targetIndex: number,
      trigger: 'drag' | 'pointer_control' | 'accessibility_action',
    ) => {
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
        activeIndexRef.current = target;
        setActiveStableGroupId(groupId);
        setActiveIndex(target);
        listRef.current?.scrollToOffset({ offset: target * snapInterval, animated: false });
      }
      return committed;
    },
    [commitOrder, snapInterval],
  );

  const handlersFor = useCallback(
    (groupId: string) => {
      const responderKey = `${groupId}:${snapInterval}:${orderedGroupIds.join(',')}:${reorderMenuGroupId ?? ''}`;
      const cached = respondersRef.current.get(responderKey);
      if (cached) return cached.panHandlers;
      const responder = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          if (reorderMenuGroupId !== null) return;
          const from = orderedGroupsRef.current.findIndex((group) => group.groupId === groupId);
          if (from < 0) return;
          dragRef.current = { groupId, from, target: from };
          setDraggingGroupId(groupId);
          setFlippedGroupId(null);
        },
        onPanResponderMove: (_event, gesture) => {
          const drag = dragRef.current;
          if (!drag) return;
          if (Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) < 6) return;
          const max = orderedGroupsRef.current.length - 1;
          const pointerTarget = Math.max(
            0,
            Math.min(drag.from + Math.round(gesture.dx / snapInterval), max),
          );

          const direction =
            gesture.moveX < DRAG_EDGE ? -1 : gesture.moveX > windowWidth - DRAG_EDGE ? 1 : 0;
          if (direction === 0) {
            stopEdgePaging();
            drag.target = pointerTarget;
          } else {
            if (direction < 0) drag.target = Math.min(drag.target, pointerTarget);
            else drag.target = Math.max(drag.target, pointerTarget);
            startEdgePaging(direction);
          }
        },
        onPanResponderRelease: (_event, gesture) => {
          stopEdgePaging();
          const drag = dragRef.current;
          dragRef.current = null;
          setDraggingGroupId(null);
          if (!drag) return;
          if (Math.abs(gesture.dx) < 6 && Math.abs(gesture.dy) < 6) {
            setReorderMenuGroupId(drag.groupId);
            return;
          }
          commitMove(drag.groupId, drag.target, 'drag');
        },
        onPanResponderTerminate: () => {
          stopEdgePaging();
          dragRef.current = null;
          setDraggingGroupId(null);
        },
      });
      respondersRef.current.set(responderKey, responder);
      return responder.panHandlers;
    },
    [
      commitMove,
      orderedGroupIds,
      reorderMenuGroupId,
      snapInterval,
      startEdgePaging,
      stopEdgePaging,
      windowWidth,
    ],
  );

  useEffect(() => {
    respondersRef.current.clear();
  }, [orderedGroupIds, reorderMenuGroupId, snapInterval, windowWidth]);

  const flipToBack = useCallback(
    (groupId: string, trigger: GroupCardFlipTrigger = 'card_tap') => {
      if (draggingGroupId !== null || reorderMenuGroupId !== null) return;
      const index = orderedGroups.findIndex((group) => group.groupId === groupId);
      if (index < 0) return;
      if (activeIdentityRef.current !== groupId) {
        pendingFlipRef.current = { groupId, trigger };
        listRef.current?.scrollToOffset({ offset: index * snapInterval, animated: true });
        return;
      }
      completeUserFlipToBack(groupId, trigger);
    },
    [completeUserFlipToBack, draggingGroupId, orderedGroups, reorderMenuGroupId, snapInterval],
  );

  const flipToFront = useCallback(
    (trigger: GroupCardFlipTrigger = 'card_tap') => {
      if (flippedGroupId === null) return;
      guideBackGroupIdRef.current = null;
      setFlippedGroupId(null);
      logGroupCardFlipped({
        to_face: 'front',
        trigger,
        group_count_bucket: groupCountBucket(orderedGroups.length),
      });
      focusNode(frontFocusRef);
    },
    [flippedGroupId, focusNode, orderedGroups.length],
  );

  // focus episode가 바뀌면 완료 key와 queue 결과를 새로 판정한다. read 전에는 카드 입력을 받지 않는다.
  useEffect(() => {
    if (!guideManaged) {
      setGuideInputReady(true);
      return;
    }
    if (guideDecisionEpisodeRef.current === guideEpisode) return;
    guideDecisionEpisodeRef.current = null;
    guideReadStateRef.current = null;
    setGuideInputReady(false);
    setGuideQueued(false);
    setGuideVisible(false);
  }, [guideEpisode, guideManaged]);

  useEffect(() => {
    if (!guideManaged || guideDataReady || !guideDataFailed) return;
    setGuideInputReady(true);
    setGuideQueued(false);
    setGuideVisible(false);
  }, [guideDataFailed, guideDataReady, guideManaged]);

  useEffect(() => {
    if (!guideEligible || guideDecisionEpisodeRef.current === guideEpisode) return;
    guideDecisionEpisodeRef.current = guideEpisode;
    let canceled = false;
    let settled = false;
    AsyncStorage.getItem(STORAGE_KEYS.guideGroupDeck)
      .then((value) => {
        if (canceled) return;
        settled = true;
        const readState: GroupDeckGuideReadState =
          value === '1' || isGroupDeckGuideCompletedInSession() ? 'completed' : 'incomplete';
        guideReadStateRef.current = readState;
        const decision = resolveGroupDeckGuideDecision(readState, guideBlockedRef.current);
        logGroupCardDeckViewed({
          group_entry: groupEntry,
          group_count_bucket: groupCountBucket(orderedGroups.length),
          guide_state: decision.exposure,
        });
        setGuideQueued(decision.queue);
        setGuideInputReady(true);
      })
      .catch(() => {
        if (canceled) return;
        settled = true;
        guideReadStateRef.current = 'unknown';
        logGroupDeckGuideReadFailed();
        const decision = resolveGroupDeckGuideDecision('unknown', guideBlockedRef.current);
        logGroupCardDeckViewed({
          group_entry: groupEntry,
          group_count_bucket: groupCountBucket(orderedGroups.length),
          guide_state: decision.exposure,
        });
        setGuideQueued(decision.queue);
        setGuideInputReady(true);
      });
    return () => {
      canceled = true;
      if (!settled && guideDecisionEpisodeRef.current === guideEpisode) {
        guideDecisionEpisodeRef.current = null;
      }
    };
  }, [groupEntry, guideEligible, guideEpisode, orderedGroups.length]);

  const startGuide = useCallback(() => {
    const firstGroupId = orderedGroups[0]?.groupId;
    if (!firstGroupId) return;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    activeIdentityRef.current = firstGroupId;
    activeIndexRef.current = 0;
    setActiveStableGroupId(firstGroupId);
    setActiveIndex(0);
    setActiveAnchorGroupId(firstGroupId);
    setFlippedGroupId(null);
    guideStartGroupsRef.current = groupFingerprint;
    guideVisibleRef.current = true;
    setGuideVisible(true);
  }, [groupFingerprint, orderedGroups]);

  useEffect(() => {
    if (!guideQueued || guideVisible || guideBlocked || !guideEligible) return;
    startGuide();
  }, [guideBlocked, guideEligible, guideQueued, guideVisible, startGuide]);

  const interruptGuide = useCallback((reason: 'route' | 'groups_changed' | 'blocking_overlay') => {
    if (!guideVisibleRef.current) return;
    guideVisibleRef.current = false;
    setGuideVisible(false);
    setGuideQueued(guideReadStateRef.current !== 'unknown');
    setFlippedGroupId(null);
    guideBackGroupIdRef.current = null;
    logGroupDeckGuideInterrupted({ reason });
  }, []);

  useEffect(() => {
    if (!guideVisible) return;
    if (!guideScreenFocused) interruptGuide('route');
    else if (guideBlocked) interruptGuide('blocking_overlay');
    else if (guideStartGroupsRef.current !== groupFingerprint) interruptGuide('groups_changed');
  }, [groupFingerprint, guideBlocked, guideScreenFocused, guideVisible, interruptGuide]);

  const guideSteps: GuideStep[] = useMemo(
    () =>
      groupDeckGuideSteps(orderedGroups.length).map((step) => ({
        text: step.text,
        character: GUIDE_CHARACTER[step.character],
        anchor:
          step.anchor === 'deck'
            ? deckAnchorRef
            : step.anchor === 'active-card'
              ? activeCardRef
              : undefined,
        prepare: step.requiresBack
          ? () => {
              const groupId = activeIdentityRef.current ?? orderedGroups[0]?.groupId;
              if (!groupId) return;
              // 사용자 이벤트를 거치지 않는 상태 전환이다. 응답을 기다리지 않고 lazy ensure만 시작한다.
              setFlippedGroupId(groupId);
              guideBackGroupIdRef.current = groupId;
              (onEnsureBack ?? ensureBack)(groupId);
            }
          : undefined,
      })),
    [ensureBack, onEnsureBack, orderedGroups],
  );

  const finishGuide = useCallback(() => {
    const completed = completeGroupDeckGuide(
      () => logTabGuideCompleted({ guide: GROUP_DECK_GUIDE_ID }),
      () => AsyncStorage.setItem(STORAGE_KEYS.guideGroupDeck, '1'),
      logGroupDeckGuideWriteFailed,
    );
    if (!completed) return;
    guideVisibleRef.current = false;
    setGuideVisible(false);
    setGuideQueued(false);
  }, []);

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
        <TouchableOpacity
          style={s.refreshBtn}
          onPress={handleRefresh}
          disabled={refreshing}
          accessibilityRole="button"
          accessibilityLabel="그룹 새로고침"
          testID="group.list.refresh"
        >
          <Ionicons name="refresh" size={18} color={T.inkSub} />
        </TouchableOpacity>
      </View>

      <View
        ref={deckAnchorRef}
        collapsable={false}
        onLayout={() => setDeckLayoutReady(true)}
        pointerEvents={guideInputReady && !guideVisible ? 'auto' : 'none'}
        testID="group.deck.guideAnchor"
      >
        <FlatList
          ref={listRef}
          testID="group.list.items"
          data={orderedGroups}
          keyExtractor={(item) => item.groupId}
          horizontal
          scrollEnabled={
            guideInputReady &&
            !guideVisible &&
            draggingGroupId === null &&
            reorderMenuGroupId === null
          }
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[s.listContent, { paddingHorizontal: SIDE_PEEK }]}
          ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
          snapToInterval={snapInterval}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          onMomentumScrollEnd={onMomentumScrollEnd}
          onScrollEndDrag={onScrollEndDrag}
          ListFooterComponent={
            <View
              style={{ marginLeft: CARD_GAP }}
              accessibilityElementsHidden={renderedActiveIndex !== orderedGroups.length}
              importantForAccessibility={
                renderedActiveIndex === orderedGroups.length ? 'auto' : 'no-hide-descendants'
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
              ref={item.groupId === activeGroupId ? activeCardRef : undefined}
              collapsable={false}
              onLayout={() => {
                if (item.groupId === activeIdentityRef.current)
                  setActiveAnchorGroupId(item.groupId);
              }}
              style={{ width: cardWidth }}
              accessibilityElementsHidden={item.groupId !== activeGroupId}
              importantForAccessibility={
                item.groupId === activeGroupId ? 'auto' : 'no-hide-descendants'
              }
              testID={`group.list.card.${item.groupId}`}
            >
              {flippedGroupId === item.groupId ? (
                <GroupCardBack
                  group={item}
                  position={index + 1}
                  pageCount={pageCount}
                  snapshot={snapshots[item.groupId]}
                  roomRef={activeIdentityRef.current === item.groupId ? roomFocusRef : undefined}
                  onFlipFront={flipToFront}
                  onAccessibilityFlipFront={() => flipToFront('accessibility_action')}
                  onStartFocus={() => {
                    runCardAction(item, 'focus', (interaction) =>
                      onStartFocus(item.groupId, interaction),
                    );
                  }}
                  onOpenSettings={() => {
                    runCardAction(item, 'settings', () => onOpenSettings(item.groupId));
                  }}
                  onOpenRoom={() => {
                    runCardAction(item, 'room', (interaction) => {
                      roomReturnRef.current = {
                        groupId: item.groupId,
                        sourceIndex: index,
                        departureRevision: groupsRevision,
                      };
                      onSelect(item.groupId, interaction);
                    });
                  }}
                  onRetry={(dependency) => retry(item.groupId, dependency)}
                />
              ) : (
                <GroupCardFront
                  group={item}
                  emoji={emojiFor(item.groupId)}
                  position={index + 1}
                  pageCount={pageCount}
                  bodyRef={activeIdentityRef.current === item.groupId ? frontFocusRef : undefined}
                  onFlip={() => flipToBack(item.groupId)}
                  onAccessibilityFlip={() => flipToBack(item.groupId, 'accessibility_action')}
                  reorderHandlers={handlersFor(item.groupId)}
                  canMovePrevious={index > 0}
                  canMoveNext={index < orderedGroups.length - 1}
                  onMoveStep={(step) => {
                    const from = orderedGroupsRef.current.findIndex(
                      (group) => group.groupId === item.groupId,
                    );
                    if (commitMove(item.groupId, from + step, 'accessibility_action'))
                      setFlippedGroupId(null);
                  }}
                />
              )}
              {reorderMenuGroupId === item.groupId && (
                <View style={s.reorderMenu} testID={`group.card.reorderMenu.${item.groupId}`}>
                  <Text style={s.reorderTitle}>순서 변경</Text>
                  {orderedGroups.map((target, targetIndex) => (
                    <TouchableOpacity
                      key={target.groupId}
                      style={s.reorderOption}
                      onPress={() => {
                        commitMove(item.groupId, targetIndex, 'pointer_control');
                        setReorderMenuGroupId(null);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${targetIndex + 1}번째로 이동`}
                      testID={`group.card.reorderTo.${item.groupId}.${targetIndex}`}
                    >
                      <Text style={s.reorderOptionText}>{targetIndex + 1}번째</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}
        />

        {saveFailed && (
          <Text style={s.saveError} accessibilityRole="alert">
            순서를 저장하지 못했어요. 다음 변경 때 다시 시도합니다.
          </Text>
        )}

        <PageIndicator
          pageCount={pageCount}
          activeIndex={renderedActiveIndex}
          pageLabels={[...orderedGroups.map((group) => group.name), '그룹 찾기']}
          disabled={draggingGroupId !== null || reorderMenuGroupId !== null}
          onSelectPage={selectPage}
          onAccessibilitySelectPage={(page) => selectPage(page, 'accessibility_action')}
        />
      </View>

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
        testID="group.list.guide"
        onFinish={finishGuide}
      />
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
  refreshBtn: {
    marginLeft: 'auto',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 1,
  },
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
  reorderMenu: {
    position: 'absolute',
    top: 52,
    right: T.space.md,
    zIndex: 5,
    minWidth: 132,
    padding: T.space.xs,
    borderRadius: 12,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
  },
  reorderTitle: { ...T.text.caption, color: T.inkMuted, padding: T.space.xs },
  reorderOption: { minHeight: 44, justifyContent: 'center', paddingHorizontal: T.space.sm },
  reorderOptionText: { ...T.text.label, color: T.ink },
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
