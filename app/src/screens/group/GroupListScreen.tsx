import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  AppState,
  FlatList,
  findNodeHandle,
  PanResponder,
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
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
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
import { enterUp } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
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

/**
 * 카드 한 장의 높이 — 앞면·뒷면과 로딩 스켈레톤(GroupScreen)이
 * 같은 가로 덱 실루엣을 쓰도록 공유한다.
 * 아래 s.card의 minHeight로도 걸어 둔다 — 스켈레톤과 실제 카드가 **같은 값에 묶여 있어야**
 * 카드 규격이 바뀔 때 자리표시자만 옛 치수로 남는 일이 없다. 소개(description)가 있는 카드는
 * 이보다 커지므로, 데이터 도착 시 어긋남은 '아래로 늘어나는' 방향뿐이다(위로 줄어드는 점프 없음).
 */
export const GROUP_CARD_HEIGHT = 520;

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
  onBack,
  guideBlocked = false,
  guideScreenFocused = true,
  guideEpisode = 0,
  groupEntry = 'unknown',
  guideDataReady = true,
  guideDataFailed = false,
  onEnsureBack,
}: GroupListScreenProps) {
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeStableGroupId, setActiveStableGroupId] = useState<string | null>(null);
  const [flippedGroupId, setFlippedGroupId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [reorderMenuGroupId, setReorderMenuGroupId] = useState<string | null>(null);
  const reorderMenuGroupIdRef = useRef<string | null>(null);
  reorderMenuGroupIdRef.current = reorderMenuGroupId;
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
    if (!hydrated) return [];
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
  const activeIdentityRef = useRef<string | null>(null);
  const activeIndexRef = useRef(0);
  const previousDeckOrderKeyRef = useRef(deckOrderKey);
  const previousSnapIntervalRef = useRef(snapInterval);
  const hydratedUserRef = useRef<string | null>(null);
  const orderedGroupsRef = useRef(orderedGroups);
  orderedGroupsRef.current = orderedGroups;
  const roomReturnRef = useRef<GroupRoomReturnContext | null>(null);
  const returnFocusTargetRef = useRef<'room' | 'settings'>('room');
  const frontFocusRef = useRef<View | null>(null);
  const backFocusRef = useRef<View | null>(null);
  const roomFocusRef = useRef<View | null>(null);
  const settingsFocusRef = useRef<View | null>(null);
  const deckAnchorRef = useRef<View | null>(null);
  const guideFrontRef = useRef<View | null>(null);
  const guideBackRef = useRef<View | null>(null);
  const guideDecisionEpisodeRef = useRef<number | null>(null);
  const invalidatedGuideEpisodeRef = useRef<number | null>(null);
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
  useEffect(() => {
    guideVisibleRef.current = guideVisible;
  }, [guideVisible]);
  guideBlockedRef.current = guideBlocked;

  useEffect(
    () => () => {
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
      focusNode(backFocusRef);
    },
    [ensureBack, focusNode, orderedGroups.length],
  );

  const selectPage = useCallback(
    (page: number, trigger: GroupCarouselTrigger = 'indicator_press') => {
      if (reorderMenuGroupIdRef.current !== null) return;
      const next = Math.max(0, Math.min(page, pageCount - 1));
      const from = activeIndexRef.current;
      roomReturnRef.current = null;
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
  useLayoutEffect(() => {
    if (!hydrated) return;
    const orderChanged = previousDeckOrderKeyRef.current !== deckOrderKey;
    const intervalChanged = previousSnapIntervalRef.current !== snapInterval;
    const hydrationIdentity = userId ?? 'anonymous';
    const firstHydrationForUser = hydratedUserRef.current !== hydrationIdentity;
    hydratedUserRef.current = hydrationIdentity;
    previousDeckOrderKeyRef.current = deckOrderKey;
    previousSnapIntervalRef.current = snapInterval;
    if (!firstHydrationForUser && !orderChanged && !intervalChanged) return;
    // 로컬 순서를 읽기 전 서버 첫 카드를 활성화하지 않는다. 첫 안정 프레임은 reconciled
    // 순서의 0번을 기준으로 잡아, 저장된 [B,A]에서 잠깐 A를 보였다가 B로 점프하지 않는다.
    const identity = firstHydrationForUser
      ? (orderedGroups[0]?.groupId ?? null)
      : activeIdentityRef.current;
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
  }, [deckOrderKey, hydrated, orderedGroups, snapInterval, userId]);

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
    const returnFocusTarget = returnFocusTargetRef.current;
    roomReturnRef.current = null;
    if (target.kind === 'empty') return;

    activeIdentityRef.current = target.groupId;
    activeIndexRef.current = target.index;
    setActiveStableGroupId(target.groupId);
    setActiveIndex(target.index);
    listRef.current?.scrollToOffset({ offset: target.index * snapInterval, animated: false });
    if (target.kind === 'same_back') {
      setFlippedGroupId(target.groupId);
      focusNode(returnFocusTarget === 'settings' ? settingsFocusRef : roomFocusRef);
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
        onStartShouldSetPanResponder: () => reorderMenuGroupIdRef.current === null,
        onMoveShouldSetPanResponder: () => reorderMenuGroupIdRef.current === null,
        onPanResponderGrant: () => {
          if (reorderMenuGroupIdRef.current !== null) return;
          roomReturnRef.current = null;
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
      roomReturnRef.current = null;
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
    if (
      !guideEligible ||
      invalidatedGuideEpisodeRef.current === guideEpisode ||
      guideDecisionEpisodeRef.current === guideEpisode
    )
      return;
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
    if (!guideScreenFocused) {
      invalidatedGuideEpisodeRef.current = guideEpisode;
      if (guideVisible) interruptGuide('route');
      setGuideQueued(false);
      return;
    }
    if (!guideVisible) return;
    else if (guideBlocked) interruptGuide('blocking_overlay');
    else if (guideStartGroupsRef.current !== groupFingerprint) interruptGuide('groups_changed');
  }, [
    groupFingerprint,
    guideBlocked,
    guideEpisode,
    guideScreenFocused,
    guideVisible,
    interruptGuide,
  ]);

  const guideSteps: GuideStep[] = useMemo(
    () =>
      groupDeckGuideSteps(orderedGroups.length).map((step) => ({
        text: step.text,
        character: GUIDE_CHARACTER[step.character],
        anchor:
          step.anchor === 'deck'
            ? deckAnchorRef
            : step.anchor === 'active-card'
              ? step.requiresBack
                ? guideBackRef
                : guideFrontRef
              : undefined,
        prepare: step.requiresBack
          ? async () => {
              const groupId = activeIdentityRef.current ?? orderedGroups[0]?.groupId;
              if (!groupId) return;
              // 사용자 이벤트를 거치지 않는 상태 전환이다. 응답을 기다리지 않고 lazy ensure만 시작한다.
              setFlippedGroupId(groupId);
              guideBackGroupIdRef.current = groupId;
              (onEnsureBack ?? ensureBack)(groupId);
              // 뒷면 conditional tree가 commit/layout된 뒤 overlay가 실제 face를 측정한다.
              await new Promise<void>((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
              });
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
    // 마지막 단계가 뒷면을 열어 둔 채 끝나므로 오버레이가 포커스를 잃게 하지 않는다.
    // 다음 실제 조작 대상인 뒷면 제목/첫 CTA로 즉시 이어 준다.
    focusNode(backFocusRef);
  }, [focusNode]);

  return (
    <View style={s.root} testID="group.list">
      <View style={s.header}>
        {/* 백버튼 규격은 그룹 스택 화면(GroupCreateScreen·NoticeScreen)의 s.backBtn과 같은 32/r16 */}
        {onBack && (
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => {
              if (reorderMenuGroupIdRef.current === null) onBack();
            }}
            disabled={reorderMenuGroupId !== null}
            activeOpacity={0.7}
            accessibilityLabel="뒤로"
            testID="group.list.back"
          >
            <Ionicons name="chevron-back" size={18} color={T.inkSub} />
          </TouchableOpacity>
        )}
        <Text style={s.headerTitle}>내 그룹</Text>
        <View style={s.headerActions}>
          <TouchableOpacity
            style={s.searchBtn}
            onPress={() => {
              if (reorderMenuGroupIdRef.current === null) onFind();
            }}
            disabled={reorderMenuGroupId !== null}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="그룹 찾기"
            testID="group.list.find"
          >
            <Ionicons name="search" size={22} color={T.inkSub} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.createBtn}
            onPress={() => {
              if (reorderMenuGroupIdRef.current === null) onCreate();
            }}
            disabled={reorderMenuGroupId !== null}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="그룹 만들기"
            testID="group.list.create"
          >
            <Ionicons name="add" size={28} color={T.white} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={s.deckScroller}
        contentContainerStyle={[s.deckScrollerContent, { paddingBottom: insets.bottom + 74 }]}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        directionalLockEnabled
        scrollEnabled={guideInputReady && !guideVisible}
        testID="group.list.scroller"
      >
        <View
          ref={deckAnchorRef}
          collapsable={false}
          onLayout={() => setDeckLayoutReady(true)}
          pointerEvents={guideInputReady && !guideVisible ? 'auto' : 'none'}
          testID="group.deck.guideAnchor"
        >
          {!hydrated || !emojiHydrated ? (
            <SkeletonGroup style={s.deckSkeleton} testID="group.deck.hydrating">
              <Skeleton w={cardWidth} h={GROUP_CARD_HEIGHT} radius={22} />
              <Skeleton w={36} h={GROUP_CARD_HEIGHT} radius={22} />
            </SkeletonGroup>
          ) : (
            <>
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
                contentContainerStyle={[s.listContent, { paddingHorizontal: SIDE_PEEK }]}
                ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
                snapToInterval={snapInterval}
                snapToAlignment="start"
                decelerationRate="fast"
                disableIntervalMomentum
                onScrollBeginDrag={() => {
                  roomReturnRef.current = null;
                }}
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
                      onPress={() => {
                        if (reorderMenuGroupIdRef.current === null) onFind();
                      }}
                      focusable={renderedActiveIndex === orderedGroups.length}
                    />
                  </View>
                }
                renderItem={({ item, index }) => (
                  <View
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
                        userId={userId}
                        cardRef={item.groupId === activeGroupId ? guideBackRef : undefined}
                        position={index + 1}
                        pageCount={pageCount}
                        snapshot={snapshots[item.groupId]}
                        roomRef={
                          activeIdentityRef.current === item.groupId ? roomFocusRef : undefined
                        }
                        backFocusRef={
                          activeIdentityRef.current === item.groupId ? backFocusRef : undefined
                        }
                        settingsRef={
                          activeIdentityRef.current === item.groupId ? settingsFocusRef : undefined
                        }
                        onFlipFront={flipToFront}
                        onAccessibilityFlipFront={() => flipToFront('accessibility_action')}
                        onStartFocus={() => {
                          runCardAction(item, 'focus', (interaction) =>
                            onStartFocus(item.groupId, interaction),
                          );
                        }}
                        onOpenSettings={() => {
                          runCardAction(item, 'settings', () => {
                            roomReturnRef.current = {
                              groupId: item.groupId,
                              sourceIndex: index,
                              departureRevision: groupsRevision,
                            };
                            returnFocusTargetRef.current = 'settings';
                            onOpenSettings(item.groupId);
                          });
                        }}
                        onOpenRoom={() => {
                          runCardAction(item, 'room', (interaction) => {
                            roomReturnRef.current = {
                              groupId: item.groupId,
                              sourceIndex: index,
                              departureRevision: groupsRevision,
                            };
                            returnFocusTargetRef.current = 'room';
                            onSelect(item.groupId, interaction);
                          });
                        }}
                        onRetry={(dependency) => retry(item.groupId, dependency)}
                      />
                    ) : (
                      <GroupCardFront
                        group={item}
                        cardRef={item.groupId === activeGroupId ? guideFrontRef : undefined}
                        emoji={emojiFor(item.groupId)}
                        position={index + 1}
                        pageCount={pageCount}
                        active={item.groupId === activeGroupId}
                        bodyRef={
                          activeIdentityRef.current === item.groupId ? frontFocusRef : undefined
                        }
                        onFlip={() => flipToBack(item.groupId)}
                        onAccessibilityFlip={() => flipToBack(item.groupId, 'accessibility_action')}
                        reorderHandlers={handlersFor(item.groupId)}
                        canMovePrevious={index > 0}
                        canMoveNext={index < orderedGroups.length - 1}
                        onMoveStep={(step) => {
                          if (reorderMenuGroupIdRef.current !== null) return;
                          roomReturnRef.current = null;
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
                        <ScrollView
                          style={s.reorderOptions}
                          nestedScrollEnabled
                          showsVerticalScrollIndicator
                          testID={`group.card.reorderOptions.${item.groupId}`}
                        >
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
                        </ScrollView>
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
            </>
          )}
        </View>
      </ScrollView>

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
  deckScroller: { flex: 1 },
  deckScrollerContent: { flexGrow: 1 },

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
  headerActions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
  },
  searchBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
  },
  createBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
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
  deckSkeleton: {
    flexDirection: 'row',
    gap: CARD_GAP,
    paddingHorizontal: SIDE_PEEK,
    paddingBottom: T.space.md + 44,
    overflow: 'hidden',
  },

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
    maxHeight: 240,
  },
  reorderTitle: { ...T.text.caption, color: T.inkMuted, padding: T.space.xs },
  reorderOptions: { maxHeight: 196 },
  reorderOption: { minHeight: 44, justifyContent: 'center', paddingHorizontal: T.space.sm },
  reorderOptionText: { ...T.text.label, color: T.ink },
  saveError: {
    ...T.text.caption,
    color: T.dangerInk,
    textAlign: 'center',
    paddingTop: T.space.xs,
  },
});
