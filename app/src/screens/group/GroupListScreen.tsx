import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as ReactNative from 'react-native';
import {
  AccessibilityInfo,
  AppState,
  FlatList,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
import { T } from '@/constants/theme';
import { STORAGE_KEYS } from '@/types/storage';
import {
  logGroupCardDeckViewed,
  logGroupCardActionClicked,
  logGroupCardFlipped,
  logGroupCarouselPaged,
  logGroupDeckGuideInterrupted,
  logGroupDeckGuideReadFailed,
  logGroupDeckGuideWriteFailed,
  logTabGuideCompleted,
  type GroupEntry,
  type GroupCountBucket,
  type GroupCardFlipTrigger,
  type GroupCarouselTrigger,
} from '@/services/analyticsEvents';
import {
  createCardInteractionContext,
  type CardInteractionContext,
} from '@/services/cardInteraction';
import type { LeagueMemberResponse } from '@/types/api';
import { enterUp } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { FindMoreCard } from './components/FindMoreCard';
import { PageIndicator } from './components/PageIndicator';
import { GroupCardFront } from './components/GroupCardFront';
import { GroupCardBackSummary } from './components/GroupCardBackSummary';
import type { GroupCardSummarySnapshot, GroupDependency } from './groupCardSummary';
import { useGroupCardOrder } from './useGroupCardOrder';
import { useGroupCardEmojis } from './useGroupCardEmojis';
import {
  claimGroupDeckGuideUnknownFallback,
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
export const GROUP_CARD_SIDE_PEEK = 24;
export const GROUP_CARD_GAP = 12;

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
  onSelect: (groupId: string, interaction?: CardInteractionContext) => void;
  onStartFocus?: (groupId: string, interaction: CardInteractionContext) => void;
  onCreate: () => void;
  onFind: () => void;
  onRefresh: () => Promise<void>;
  onBack?: () => void;
  // guide eligibility는 성공 목록만으로 부족하다. 인증·route·overlay queue 상태를 부모가 제공한다.
  userId?: string | null;
  guideBlocked?: boolean;
  guideScreenFocused?: boolean;
  guideEpisode?: number;
  guideDataReady?: boolean;
  guideDataFailed?: boolean;
  groupEntry?: GroupEntry;
  // 사용자 첫 back과 guide 3→4가 공유하는 lazy ensure 경로다.
  onEnsureBack?: (groupId: string) => void;
  onRetryBack?: (groupId: string, dependency: GroupDependency) => void;
  getBackSnapshot?: (groupId: string) => GroupCardSummarySnapshot<LeagueMemberResponse[]> | null;
  cardDataDate?: string;
}

export default function GroupListScreen({
  groups,
  onSelect,
  onStartFocus,
  onCreate,
  onFind,
  onRefresh,
  onBack,
  userId,
  guideBlocked = false,
  guideScreenFocused = true,
  guideEpisode = 0,
  guideDataReady = true,
  guideDataFailed = false,
  groupEntry = 'unknown',
  onEnsureBack,
  onRetryBack,
  getBackSnapshot,
  cardDataDate,
}: GroupListScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [refreshing, setRefreshing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [flippedGroupId, setFlippedGroupId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [reorderMenuGroupId, setReorderMenuGroupId] = useState<string | null>(null);
  const [backSource, setBackSource] = useState<'user' | 'guide'>('user');
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
  const cardWidth = Math.max(240, windowWidth - GROUP_CARD_SIDE_PEEK * 2);
  const snapInterval = cardWidth + GROUP_CARD_GAP;
  const {
    orderedGroupIds,
    hydrated: orderHydrated,
    saveFailed,
    commitOrder,
  } = useGroupCardOrder({
    serverGroupIds: groups.map((group) => group.groupId),
    userId: userId ?? null,
  });
  const orderedGroups = useMemo(() => {
    if (!orderHydrated) return [];
    const byId = new Map(groups.map((group) => [group.groupId, group]));
    return orderedGroupIds.flatMap((groupId) => {
      const group = byId.get(groupId);
      return group ? [group] : [];
    });
  }, [groups, orderHydrated, orderedGroupIds]);
  const orderedGroupIdsForEmoji = useMemo(
    () => orderedGroups.map((group) => group.groupId),
    [orderedGroups],
  );
  const { hydrated: emojiHydrated, emojiFor } = useGroupCardEmojis({
    userId: userId ?? null,
    groupIds: orderedGroupIdsForEmoji,
    reloadToken: guideEpisode,
  });
  const pageCount = orderedGroups.length + 1;
  const groupFingerprint = orderedGroups.map((group) => group.groupId).join('|');
  const listRef = useRef<FlatList<GroupSummaryResponse>>(null);
  const activeIdentityRef = useRef<string | null>(groups[0]?.groupId ?? null);
  const hydratedOrderUserRef = useRef<string | null>(null);
  const orderedGroupsRef = useRef(orderedGroups);
  orderedGroupsRef.current = orderedGroups;
  const activeIndexRef = useRef(0);
  const previousGroupFingerprintRef = useRef(groupFingerprint);
  const previousSnapIntervalRef = useRef(snapInterval);
  const actionPendingRef = useRef(false);
  const previousCardDataDateRef = useRef(cardDataDate);
  const deckAnchorRef = useRef<View | null>(null);
  const activeCardRef = useRef<View | null>(null);
  const frontBodyRef = useRef<View | null>(null);
  const frontFocusPendingRef = useRef(false);
  const backTitleRef = useRef<Text | null>(null);
  const backLayoutWaitersRef = useRef(new Map<string, () => void>());
  const guideDecisionEpisodeRef = useRef<number | null>(null);
  const guideReadStateRef = useRef<GroupDeckGuideReadState | null>(null);
  const guideStartGroupsRef = useRef<string | null>(null);
  const guideVisibleRef = useRef(false);
  const guideBlockedRef = useRef(guideBlocked);
  const activeGroupId = orderedGroups[activeIndex]?.groupId ?? null;
  const guideEligible =
    typeof userId === 'string' &&
    orderedGroups.length > 0 &&
    orderHydrated &&
    emojiHydrated &&
    guideDataReady &&
    deckLayoutReady &&
    activeAnchorGroupId === activeGroupId &&
    guideScreenFocused &&
    appActive;

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

  const selectPage = useCallback(
    (page: number, trigger: GroupCarouselTrigger = 'indicator_press') => {
      const next = Math.max(0, Math.min(page, pageCount - 1));
      listRef.current?.scrollToOffset({ offset: next * snapInterval, animated: true });
      const nextIdentity = orderedGroups[next]?.groupId ?? null;
      const from = activeIndexRef.current;
      if (activeIdentityRef.current !== nextIdentity) {
        setFlippedGroupId(null);
        logGroupCarouselPaged({
          trigger,
          from_index: from,
          to_index: next,
          group_count_bucket: groupCountBucket(orderedGroups.length),
        });
      }
      activeIdentityRef.current = nextIdentity;
      activeIndexRef.current = next;
      setActiveIndex(next);
      setActiveAnchorGroupId(nextIdentity);
    },
    [orderedGroups, pageCount, snapInterval],
  );

  const settleOffset = useCallback(
    (offsetX: number) => {
      const next = Math.max(0, Math.min(Math.round(offsetX / snapInterval), pageCount - 1));
      const nextIdentity = orderedGroups[next]?.groupId ?? null;
      const from = activeIndexRef.current;
      if (activeIdentityRef.current !== nextIdentity) {
        setFlippedGroupId(null);
        logGroupCarouselPaged({
          trigger: 'swipe',
          from_index: from,
          to_index: next,
          group_count_bucket: groupCountBucket(orderedGroups.length),
        });
      }
      activeIdentityRef.current = nextIdentity;
      activeIndexRef.current = next;
      setActiveIndex(next);
      setActiveAnchorGroupId(nextIdentity);
    },
    [orderedGroups, pageCount, snapInterval],
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

  const flipCard = useCallback(
    (groupId: string, trigger: GroupCardFlipTrigger = 'card_tap') => {
      if (draggingGroupId !== null || reorderMenuGroupId !== null) return;
      const index = orderedGroups.findIndex((group) => group.groupId === groupId);
      if (index < 0) return;
      if (activeIdentityRef.current !== groupId) {
        const from = activeIndexRef.current;
        listRef.current?.scrollToOffset({ offset: index * snapInterval, animated: true });
        activeIdentityRef.current = groupId;
        activeIndexRef.current = index;
        setActiveIndex(index);
        setActiveAnchorGroupId(groupId);
        logGroupCarouselPaged({
          trigger: trigger === 'accessibility_action' ? 'accessibility_action' : 'card_tap',
          from_index: from,
          to_index: index,
          group_count_bucket: groupCountBucket(orderedGroups.length),
        });
      }
      setBackSource('user');
      if (trigger === 'accessibility_action') {
        backLayoutWaitersRef.current.set(groupId, () => {
          requestAnimationFrame(() => {
            const node = ReactNative.findNodeHandle(backTitleRef.current);
            if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
          });
        });
      }
      setFlippedGroupId(groupId);
      logGroupCardFlipped({
        to_face: 'back',
        trigger,
        group_count_bucket: groupCountBucket(orderedGroups.length),
      });
      onEnsureBack?.(groupId);
    },
    [draggingGroupId, onEnsureBack, orderedGroups, reorderMenuGroupId, snapInterval],
  );

  const flipCardFront = useCallback(
    (trigger: GroupCardFlipTrigger = 'card_tap') => {
      setBackSource('user');
      frontFocusPendingRef.current = trigger === 'accessibility_action';
      setFlippedGroupId(null);
      logGroupCardFlipped({
        to_face: 'front',
        trigger,
        group_count_bucket: groupCountBucket(orderedGroups.length),
      });
    },
    [orderedGroups.length],
  );

  // 접근성으로 뒷면을 닫은 경우 새 앞면 disclosure button이 commit된 뒤 그 위치로 복귀한다.
  useEffect(() => {
    if (flippedGroupId !== null || !frontFocusPendingRef.current) return;
    frontFocusPendingRef.current = false;
    requestAnimationFrame(() => {
      const node = ReactNative.findNodeHandle(frontBodyRef.current);
      if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
    });
  }, [flippedGroupId]);

  // 회전·폭 변경·서버 순서 변경 뒤에도 index가 아니라 stable groupId로 같은 페이지를 찾는다.
  useEffect(() => {
    if (!orderHydrated) return;
    const orderUser = userId ?? 'anonymous';
    if (hydratedOrderUserRef.current !== orderUser) {
      hydratedOrderUserRef.current = orderUser;
      const firstGroupId = orderedGroups[0]?.groupId ?? null;
      activeIdentityRef.current = firstGroupId;
      activeIndexRef.current = 0;
      setActiveIndex(0);
      setActiveAnchorGroupId(firstGroupId);
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      previousGroupFingerprintRef.current = groupFingerprint;
      previousSnapIntervalRef.current = snapInterval;
      return;
    }
    const orderChanged = previousGroupFingerprintRef.current !== groupFingerprint;
    const intervalChanged = previousSnapIntervalRef.current !== snapInterval;
    previousGroupFingerprintRef.current = groupFingerprint;
    previousSnapIntervalRef.current = snapInterval;
    if (!orderChanged && !intervalChanged) return;

    const identity = activeIdentityRef.current;
    const next =
      identity === null
        ? orderedGroups.length
        : orderedGroups.findIndex((g) => g.groupId === identity);
    const safeIndex =
      next >= 0 ? next : Math.min(activeIndexRef.current, Math.max(0, orderedGroups.length - 1));
    activeIdentityRef.current = orderedGroups[safeIndex]?.groupId ?? null;
    activeIndexRef.current = safeIndex;
    setActiveIndex(safeIndex);
    setActiveAnchorGroupId(orderedGroups[safeIndex]?.groupId ?? null);
    listRef.current?.scrollToOffset({ offset: safeIndex * snapInterval, animated: false });
  }, [groupFingerprint, orderHydrated, orderedGroups, snapInterval, userId]);

  useEffect(() => {
    if (
      reorderMenuGroupId !== null &&
      !orderedGroups.some((group) => group.groupId === reorderMenuGroupId)
    ) {
      setReorderMenuGroupId(null);
    }
  }, [orderedGroups, reorderMenuGroupId]);

  const dragRef = useRef<{ groupId: string; from: number; target: number } | null>(null);
  const respondersRef = useRef(new Map<string, ReturnType<typeof PanResponder.create>>());

  const commitMove = useCallback(
    (groupId: string, targetIndex: number) => {
      const ids = orderedGroupsRef.current.map((group) => group.groupId);
      const from = ids.indexOf(groupId);
      const target = Math.max(0, Math.min(targetIndex, ids.length - 1));
      if (from < 0 || from === target) return false;
      const next = [...ids];
      next.splice(from, 1);
      next.splice(target, 0, groupId);
      if (!commitOrder(next)) return false;
      activeIdentityRef.current = groupId;
      activeIndexRef.current = target;
      setActiveIndex(target);
      setActiveAnchorGroupId(groupId);
      setFlippedGroupId(null);
      listRef.current?.scrollToOffset({ offset: target * snapInterval, animated: false });
      return true;
    },
    [commitOrder, snapInterval],
  );

  const handlersFor = useCallback(
    (groupId: string) => {
      const key = `${groupId}:${snapInterval}:${orderedGroupIds.join(',')}`;
      const cached = respondersRef.current.get(key);
      if (cached) return cached.panHandlers;
      const responder = PanResponder.create({
        onStartShouldSetPanResponder: () => reorderMenuGroupId === null,
        onMoveShouldSetPanResponder: () => reorderMenuGroupId === null,
        onPanResponderGrant: () => {
          const from = orderedGroupsRef.current.findIndex((group) => group.groupId === groupId);
          if (from < 0) return;
          dragRef.current = { groupId, from, target: from };
          setDraggingGroupId(groupId);
          setFlippedGroupId(null);
        },
        onPanResponderMove: (_event, gesture) => {
          const drag = dragRef.current;
          if (!drag || Math.abs(gesture.dx) < 6) return;
          drag.target = Math.max(
            0,
            Math.min(
              drag.from + Math.round(gesture.dx / snapInterval),
              orderedGroupsRef.current.length - 1,
            ),
          );
        },
        onPanResponderRelease: (_event, gesture) => {
          const drag = dragRef.current;
          dragRef.current = null;
          setDraggingGroupId(null);
          if (!drag) return;
          if (Math.abs(gesture.dx) < 6 && Math.abs(gesture.dy) < 6) {
            setReorderMenuGroupId(groupId);
            return;
          }
          commitMove(groupId, drag.target);
        },
        onPanResponderTerminate: () => {
          dragRef.current = null;
          setDraggingGroupId(null);
        },
      });
      respondersRef.current.set(key, responder);
      return responder.panHandlers;
    },
    [commitMove, orderedGroupIds, reorderMenuGroupId, snapInterval],
  );

  useEffect(() => {
    respondersRef.current.clear();
  }, [orderedGroupIds, reorderMenuGroupId, snapInterval]);

  const acceptCardAction = useCallback(
    (
      group: GroupSummaryResponse,
      action: 'focus' | 'room',
      callback: (groupId: string, interaction: CardInteractionContext) => void,
    ) => {
      if (actionPendingRef.current) return;
      actionPendingRef.current = true;
      const interaction = createCardInteractionContext();
      logGroupCardActionClicked({
        action,
        role: group.role === 'OWNER' ? 'owner' : 'member',
        back_source: backSource,
        interaction_id: interaction.interactionId,
      });
      try {
        callback(group.groupId, interaction);
      } catch (error) {
        actionPendingRef.current = false;
        throw error;
      }
    },
    [backSource],
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

  // 최신 목록 판정은 성공할 때까지 보류하되, 재조회 실패로 화면에 남긴 기존 덱까지 잠그지 않는다.
  useEffect(() => {
    if (!guideManaged || guideDataReady || !guideDataFailed) return;
    setGuideInputReady(true);
    setGuideQueued(false);
    setGuideVisible(false);
  }, [guideDataFailed, guideDataReady, guideManaged]);

  // GroupRoom/Focus에서 돌아온 새 focus episode에는 CTA를 다시 받을 수 있어야 한다.
  useEffect(() => {
    actionPendingRef.current = false;
  }, [guideEpisode]);

  useEffect(() => {
    if (previousCardDataDateRef.current === cardDataDate) return;
    previousCardDataDateRef.current = cardDataDate;
    if (!flippedGroupId) return;
    let canceled = false;
    // 부모의 adapter scope effect가 새 날짜를 적용한 다음 열린 카드를 다시 ensure한다.
    Promise.resolve().then(() => {
      if (!canceled) onEnsureBack?.(flippedGroupId);
    });
    return () => {
      canceled = true;
    };
  }, [cardDataDate, flippedGroupId, onEnsureBack]);

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
    if (guideReadStateRef.current === 'unknown' && !claimGroupDeckGuideUnknownFallback()) {
      setGuideQueued(false);
      return;
    }
    const firstGroupId = orderedGroups[0]?.groupId;
    if (!firstGroupId) return;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    activeIdentityRef.current = firstGroupId;
    activeIndexRef.current = 0;
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
              setBackSource('guide');
              return new Promise<void>((resolve) => {
                backLayoutWaitersRef.current.set(groupId, resolve);
                setFlippedGroupId(groupId);
                onEnsureBack?.(groupId);
              });
            }
          : undefined,
      })),
    [onEnsureBack, orderedGroups],
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
    requestAnimationFrame(() => {
      const node = ReactNative.findNodeHandle(backTitleRef.current);
      if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
    });
  }, []);

  return (
    <View style={s.root} testID="group.list">
      <ScrollView
        style={s.scroller}
        contentContainerStyle={s.screenContent}
        alwaysBounceVertical
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={T.accent} />
        }
        testID="group.list.scroller"
      >
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

        <View
          ref={deckAnchorRef}
          collapsable={false}
          onLayout={() => setDeckLayoutReady(true)}
          testID="group.deck.guideAnchor"
        >
          <FlatList
            ref={listRef}
            testID="group.list.items"
            data={orderedGroups}
            keyExtractor={(item) => item.groupId}
            CellRendererComponent={GroupListCell}
            horizontal
            scrollEnabled={
              guideInputReady &&
              !guideVisible &&
              draggingGroupId === null &&
              reorderMenuGroupId === null
            }
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[s.listContent, { paddingHorizontal: GROUP_CARD_SIDE_PEEK }]}
            ItemSeparatorComponent={() => <View style={{ width: GROUP_CARD_GAP }} />}
            snapToInterval={snapInterval}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            onMomentumScrollEnd={onMomentumScrollEnd}
            onScrollEndDrag={onScrollEndDrag}
            ListFooterComponent={
              <View
                style={{ marginLeft: GROUP_CARD_GAP }}
                pointerEvents={guideInputReady && !guideVisible ? 'auto' : 'none'}
                accessibilityElementsHidden={activeIndex !== orderedGroups.length}
                importantForAccessibility={
                  activeIndex === orderedGroups.length ? 'auto' : 'no-hide-descendants'
                }
              >
                <FindMoreCard
                  width={cardWidth}
                  position={orderedGroups.length + 1}
                  pageCount={pageCount}
                  onPress={() => {
                    if (!guideInputReady || guideVisible) return;
                    onFind();
                  }}
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
                pointerEvents={guideInputReady && !guideVisible ? 'auto' : 'none'}
                accessibilityElementsHidden={item.groupId !== activeGroupId}
                importantForAccessibility={
                  item.groupId === activeGroupId ? 'auto' : 'no-hide-descendants'
                }
                style={{ width: cardWidth, height: GROUP_CARD_HEIGHT }}
                testID={`group.list.card.${item.groupId}`}
              >
                {flippedGroupId === item.groupId ? (
                  <GroupCardBackSummary
                    group={item}
                    userId={userId}
                    titleRef={item.groupId === activeGroupId ? backTitleRef : undefined}
                    onLayout={() => {
                      const resolve = backLayoutWaitersRef.current.get(item.groupId);
                      if (!resolve) return;
                      backLayoutWaitersRef.current.delete(item.groupId);
                      resolve();
                    }}
                    snapshot={getBackSnapshot?.(item.groupId) ?? null}
                    onStartFocus={() => {
                      if (onStartFocus) acceptCardAction(item, 'focus', onStartFocus);
                    }}
                    onOpenRoom={() => acceptCardAction(item, 'room', onSelect)}
                    onRetry={(dependency) => onRetryBack?.(item.groupId, dependency)}
                    onFlipFront={() => flipCardFront()}
                    onAccessibilityFlipFront={() => flipCardFront('accessibility_action')}
                  />
                ) : (
                  <GroupCardFront
                    group={item}
                    emoji={emojiFor(item.groupId)}
                    bodyRef={item.groupId === activeGroupId ? frontBodyRef : undefined}
                    position={index + 1}
                    pageCount={pageCount}
                    onFlip={() => flipCard(item.groupId)}
                    onAccessibilityFlip={() => flipCard(item.groupId, 'accessibility_action')}
                    reorderHandlers={handlersFor(item.groupId)}
                    canMovePrevious={index > 0}
                    canMoveNext={index < orderedGroups.length - 1}
                    onMoveStep={(step) => {
                      const from = orderedGroupsRef.current.findIndex(
                        (group) => group.groupId === item.groupId,
                      );
                      commitMove(item.groupId, from + step);
                    }}
                  />
                )}
                {reorderMenuGroupId === item.groupId && (
                  <>
                    <Pressable
                      style={s.reorderDismiss}
                      onPress={() => setReorderMenuGroupId(null)}
                      accessibilityRole="button"
                      accessibilityLabel="순서 변경 취소"
                      testID={`group.card.reorderDismiss.${item.groupId}`}
                    />
                    <View
                      style={s.reorderMenu}
                      accessibilityViewIsModal
                      onAccessibilityEscape={() => setReorderMenuGroupId(null)}
                      testID={`group.card.reorderMenu.${item.groupId}`}
                    >
                      <View style={s.reorderHeader}>
                        <Text style={s.reorderTitle}>순서 변경</Text>
                        <TouchableOpacity
                          onPress={() => setReorderMenuGroupId(null)}
                          accessibilityRole="button"
                          testID={`group.card.reorderDone.${item.groupId}`}
                        >
                          <Text style={s.reorderDoneText}>완료</Text>
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity
                        style={[s.reorderOption, index === 0 && s.reorderOptionDisabled]}
                        disabled={index === 0}
                        onPress={() => {
                          const from = orderedGroupsRef.current.findIndex(
                            (group) => group.groupId === item.groupId,
                          );
                          commitMove(item.groupId, from - 1);
                        }}
                        accessibilityRole="button"
                        testID={`group.card.reorderPrevious.${item.groupId}`}
                      >
                        <Text style={s.reorderOptionText}>앞으로 이동</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          s.reorderOption,
                          index === orderedGroups.length - 1 && s.reorderOptionDisabled,
                        ]}
                        disabled={index === orderedGroups.length - 1}
                        onPress={() => {
                          const from = orderedGroupsRef.current.findIndex(
                            (group) => group.groupId === item.groupId,
                          );
                          commitMove(item.groupId, from + 1);
                        }}
                        accessibilityRole="button"
                        testID={`group.card.reorderNext.${item.groupId}`}
                      >
                        <Text style={s.reorderOptionText}>뒤로 이동</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            )}
          />

          {saveFailed && (
            <Text style={s.saveError} accessibilityRole="alert">
              순서를 저장하지 못했어요. 다음 변경 때 다시 시도하며, 앱을 다시 열면 이전 순서로
              돌아갈 수 있어요.
            </Text>
          )}

          <PageIndicator
            pageLabels={[...orderedGroups.map((group) => group.name), '그룹 찾기']}
            activeIndex={activeIndex}
            disabled={
              !guideInputReady ||
              guideVisible ||
              draggingGroupId !== null ||
              reorderMenuGroupId !== null
            }
            onSelectPage={selectPage}
            onAccessibilitySelectPage={(page) => selectPage(page, 'accessibility_action')}
          />
        </View>
      </ScrollView>

      {/* ── 하단 고정 CTA — 빈 상태(GroupScreen)와 같은 52/r16 규격을 그대로 쓴다 ── */}
      <View
        style={[s.footer, { paddingBottom: insets.bottom + TAB_BAR_SPACE }]}
        testID="group.list.footer"
      >
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
        accessibilityTitle="그룹 카드 안내"
        // blocking sheet와 RN Modal을 같은 commit에 마운트하지 않는다. state interruption은 아래
        // effect가 계측/queue를 정리하되, 렌더 경계에서는 blocker가 즉시 overlay를 내린다.
        visible={guideVisible && !guideBlocked}
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
  scroller: { flex: 1 },
  screenContent: { flexGrow: 1 },

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

  reorderDismiss: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 4,
  },
  reorderMenu: {
    position: 'absolute',
    top: 44,
    right: T.space.md,
    zIndex: 5,
    minWidth: 144,
    padding: T.space.xs,
    borderRadius: 12,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
  },
  reorderHeader: {
    minHeight: 44,
    paddingHorizontal: T.space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reorderTitle: { ...T.text.caption, color: T.inkMuted },
  reorderDoneText: { ...T.text.label, color: T.accent, padding: T.space.xs },
  reorderOption: { minHeight: 44, justifyContent: 'center', paddingHorizontal: T.space.sm },
  reorderOptionDisabled: { opacity: 0.36 },
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
