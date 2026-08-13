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
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
import { tabBarSafeBottom } from '@/components/tabBarLayout';
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
import { M, enterUp } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { hapticMedium } from '@/utils/haptics';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { FindMoreCard } from './components/FindMoreCard';
import { PageIndicator } from './components/PageIndicator';
import { GroupCardFront } from './components/GroupCardFront';
import { GroupCardBack } from './components/GroupCardBack';
import { GROUP_CARD_FLIP_SAFE_INSET, GroupCardFlip } from './components/GroupCardFlip';
import { useGroupCardOrder } from './useGroupCardOrder';
import { useGroupCardEmojis } from './useGroupCardEmojis';
import { useGroupCardData } from './useGroupCardData';
import { resolveGroupRoomReturn, type GroupRoomReturnContext } from './groupRoomReturn';
import {
  GROUP_DECK_GUIDE_ID,
  claimGroupDeckGuideUnknownFallback,
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
export const EDGE_PAGE_THROTTLE_MS = 850;
export const REORDER_HOLD_MS = 300;
const REORDER_HOLD_CANCEL_SLOP = 12;

export function advanceEdgeTarget(current: number, direction: -1 | 1, max: number): number {
  return Math.max(0, Math.min(current + direction, max));
}

export function isProgrammaticMomentum(
  targetOffset: number | null,
  settledOffset: number,
): boolean {
  return targetOffset !== null && Math.abs(targetOffset - settledOffset) < 1;
}

export function shouldClaimReorderDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) >= 6 && Math.abs(dx) > Math.abs(dy);
}

interface ReorderPreview {
  groupId: string;
  from: number;
  target: number;
  /** 화면에 고정된 drag overlay가 손가락을 따라갈 실제 이동량. */
  fingerTranslateX: number;
  /** source/target 사이 슬롯을 계산하는 논리 이동량(edge paging 보정 포함). */
  translateX: number;
}

interface DeckBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ProgrammaticScrollEpisode {
  generation: number;
  offsets: number[];
}

export function isPointInsideDeck(
  moveX: number,
  moveY: number,
  bounds: DeckBounds | null,
): boolean {
  if (!bounds || !Number.isFinite(moveX) || !Number.isFinite(moveY)) return false;
  return (
    moveX >= bounds.x &&
    moveX <= bounds.x + bounds.width &&
    moveY >= bounds.y &&
    moveY <= bounds.y + bounds.height
  );
}

export function resolveReorderTranslation(
  index: number,
  preview: Pick<ReorderPreview, 'from' | 'target' | 'translateX'> | null,
  snapInterval: number,
): number {
  if (!preview) return 0;
  if (index === preview.from) return preview.translateX;
  if (preview.from < preview.target && index > preview.from && index <= preview.target)
    return -snapInterval;
  if (preview.target < preview.from && index >= preview.target && index < preview.from)
    return snapInterval;
  return 0;
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
export const GROUP_LIST_HEADER_HEIGHT = 68;
const GROUP_CARD_INDICATOR_HEIGHT = 44;
// 카드 밖에서 항상 차지하는 세로 공간: 플립 투영 여백 + FlatList 하단 간격 +
// 인디케이터 최소 터치 영역 + 인디케이터 하단 간격.
export const GROUP_CARD_DECK_CHROME_HEIGHT =
  GROUP_CARD_FLIP_SAFE_INSET * 2 + T.space.md + GROUP_CARD_INDICATOR_HEIGHT + T.space.md;

/** 첫 layout 전에도 실제 SafeArea+헤더 구조로 덱 viewport를 예측해 520pt 중간 프레임을 막는다. */
export function estimateGroupDeckViewportHeight(windowHeight: number, topInset: number): number {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return 0;
  return Math.max(0, windowHeight - Math.max(0, topInset) - GROUP_LIST_HEADER_HEIGHT);
}

/**
 * 카드가 탭바 위의 가용 세로를 대부분 채우되, 플립 투영 여백과 indicator를 먼저 예약한다.
 * 카드 본체는 가용 높이의 90%를 상한으로 삼고, 작은 화면에서는 기존 최소 높이를 지킨다.
 * 최소 높이가 예약 공간보다 큰 화면에서는 ScrollView로 카드 하단과 indicator에 접근한다.
 */
export function resolveGroupCardHeight(viewportHeight: number, bottomInset: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return GROUP_CARD_HEIGHT;
  const availableAboveTabBar = Math.max(0, viewportHeight - tabBarSafeBottom(bottomInset));
  const availableForCard = Math.max(0, availableAboveTabBar - GROUP_CARD_DECK_CHROME_HEIGHT);
  const proportionalCardHeight = Math.floor(availableAboveTabBar * 0.9);
  return Math.max(GROUP_CARD_HEIGHT, Math.min(proportionalCardHeight, availableForCard));
}

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

function ReorderMotionCard({
  width,
  translateX,
  dragging,
  reordering,
  groupId,
  children,
}: {
  width: number;
  translateX: number;
  dragging: boolean;
  reordering: boolean;
  groupId: string;
  children: ReactNode;
}) {
  const motion = useMotion();
  const x = useSharedValue(translateX);

  useLayoutEffect(() => {
    // 손가락을 따라가는 카드는 아래 정적 transform으로 지연 없이 붙인다. drop 뒤에는 실제
    // FlatList 슬롯도 함께 바뀌므로 잔여 transform을 즉시 0으로 지워 이중 이동을 막는다.
    if (!reordering) x.value = 0;
    else if (!dragging) x.value = motion.spring(translateX, M.spring.snappy);
  }, [dragging, motion, reordering, translateX, x]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <Animated.View
      style={[{ width }, dragging && s.draggingSource, !dragging && animatedStyle]}
      testID={`group.card.reorderMotion.${groupId}`}
    >
      <View testID={`group.card.reorderSurface.${groupId}`}>{children}</View>
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
  onFind: (entryPoint: 'list' | 'header' | 'end_card') => void;
  onStartFocus?: (groupId: string, interaction: CardInteractionContext) => void;
  onOpenSettings?: (groupId: string) => void;
  onInvite?: (groupId: string, groupName: string) => void;
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
  /** 최초 목록 로딩에서 이미 측정한 덱 높이를 넘겨 loading→ready 규격을 한 프레임도 끊지 않는다. */
  initialDeckViewportHeight?: number;
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
  onStartFocus = () => undefined,
  onOpenSettings = () => undefined,
  onInvite = () => undefined,
  onBack,
  guideBlocked = false,
  guideScreenFocused = true,
  guideEpisode = 0,
  groupEntry = 'unknown',
  guideDataReady = true,
  guideDataFailed = false,
  onEnsureBack,
  initialDeckViewportHeight,
}: GroupListScreenProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [deckViewportHeight, setDeckViewportHeight] = useState(
    () => initialDeckViewportHeight ?? estimateGroupDeckViewportHeight(windowHeight, insets.top),
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeStableGroupId, setActiveStableGroupId] = useState<string | null>(null);
  const [flippedGroupId, setFlippedGroupId] = useState<string | null>(null);
  const flippedGroupIdRef = useRef<string | null>(null);
  flippedGroupIdRef.current = flippedGroupId;
  const [flipAnimating, setFlipAnimating] = useState(false);
  const [summaryScrollActive, setSummaryScrollActive] = useState(false);
  const [skipFlipTransition, setSkipFlipTransition] = useState(false);
  const flipAnimatingRef = useRef(false);
  flipAnimatingRef.current = flipAnimating;
  const [holdingGroupId, setHoldingGroupId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [reorderPreview, setReorderPreview] = useState<ReorderPreview | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const refreshRequestRef = useRef(0);
  const draggingGroupIdRef = useRef<string | null>(null);
  draggingGroupIdRef.current = draggingGroupId;
  const holdingGroupIdRef = useRef<string | null>(null);
  holdingGroupIdRef.current = holdingGroupId;
  const reorderBusy = holdingGroupId !== null || draggingGroupId !== null;
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
  const cardHeight = resolveGroupCardHeight(deckViewportHeight, insets.bottom);
  const snapInterval = cardWidth + CARD_GAP;
  const reorderStep = snapInterval;
  const { orderedGroupIds, hydrated, saveFailed, commitOrder } = useGroupCardOrder({
    serverGroupIds: groups.map((group) => group.groupId),
    userId,
    successfulListVersion: groupsRevision,
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
  const refreshGroups = useCallback(() => {
    // iOS는 RefreshControl.enabled를 무시하므로 handler에서도 순서 변경 episode를 잠근다.
    if (
      refreshingRef.current ||
      flipAnimatingRef.current ||
      holdingGroupIdRef.current !== null ||
      draggingGroupIdRef.current !== null
    )
      return;
    const request = ++refreshRequestRef.current;
    refreshingRef.current = true;
    setRefreshing(true);
    Promise.resolve()
      .then(onRefresh)
      .catch(() => undefined)
      .finally(() => {
        if (request !== refreshRequestRef.current) return;
        refreshingRef.current = false;
        setRefreshing(false);
      });
  }, [onRefresh]);
  useEffect(
    () => () => {
      refreshRequestRef.current++;
      refreshingRef.current = false;
    },
    [],
  );
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
  const mountedRef = useRef(true);
  const reorderGripRefs = useRef(new Map<string, View>());
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
  // edge paging 한 episode가 여러 animated scroll을 만들 수 있다. 마지막 offset 하나만 보관하면
  // release 뒤 늦게 도착한 앞선 momentum을 사용자 swipe로 오인하므로 generation별로 전부 둔다.
  const programmaticScrollEpisodesRef = useRef<ProgrammaticScrollEpisode[]>([]);
  const currentProgrammaticTargetRef = useRef<number | null>(null);
  const dragGenerationRef = useRef(0);
  const dragRef = useRef<
    | (ReorderPreview & {
        generation: number;
        activationDx: number;
        activationDy: number;
        lastGestureDx: number;
        sourceOrder: string[];
      })
    | null
  >(null);
  const holdRef = useRef<{
    groupId: string;
    startedAt: number;
    latestDx: number;
    latestDy: number;
  } | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edgeDirectionRef = useRef<-1 | 0 | 1>(0);
  const edgeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const respondersRef = useRef(new Map<string, ReturnType<typeof PanResponder.create>>());
  const deckBoundsRef = useRef<DeckBounds | null>(null);
  const cancelDragRef = useRef<(updateState?: boolean) => void>(() => undefined);
  const dragSettleFrameRef = useRef<number | null>(null);
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
  const indicatorActiveIndex = reorderPreview?.target ?? renderedActiveIndex;
  const indicatorGroups = useMemo(() => {
    if (!reorderPreview) return orderedGroups;
    const next = [...orderedGroups];
    const from = next.findIndex((group) => group.groupId === reorderPreview.groupId);
    if (from < 0) return next;
    const [dragged] = next.splice(from, 1);
    if (dragged) next.splice(reorderPreview.target, 0, dragged);
    return next;
  }, [orderedGroups, reorderPreview]);

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
      if (
        actionPendingRef.current ||
        holdingGroupIdRef.current !== null ||
        draggingGroupIdRef.current !== null
      )
        return null;
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
    [],
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
      if (!active) cancelDragRef.current();
      if (!active && guideVisibleRef.current) {
        guideVisibleRef.current = false;
        setGuideVisible(false);
        setGuideQueued(guideReadStateRef.current !== 'unknown');
        logGroupDeckGuideInterrupted({ reason: 'background' });
      }
    });
    return () => subscription?.remove();
  }, []);

  const focusNode = useCallback((ref: { current: View | null }) => {
    requestAnimationFrame(() => {
      if (!mountedRef.current || ref.current === null) return;
      const node = findNodeHandle(ref.current);
      if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
    });
  }, []);

  useEffect(
    () => () => {
      mountedRef.current = false;
      cancelDragRef.current(false);
      programmaticScrollEpisodesRef.current = [];
      if (dragSettleFrameRef.current !== null) {
        cancelAnimationFrame(dragSettleFrameRef.current);
        dragSettleFrameRef.current = null;
      }
    },
    [],
  );

  const handleFlipTransition = useCallback((transitioning: boolean) => {
    setFlipAnimating(transitioning);
  }, []);

  const handleFlipTransitionComplete = useCallback(
    (face: 'front' | 'back', groupId: string) => {
      if (
        !mountedRef.current ||
        !wasScreenFocusedRef.current ||
        guideVisibleRef.current ||
        guideBlockedRef.current ||
        activeIdentityRef.current !== groupId
      )
        return;
      const groupName = orderedGroupsRef.current.find((group) => group.groupId === groupId)?.name;
      AccessibilityInfo.announceForAccessibility(
        `${groupName ?? '그룹'} 카드 ${face === 'back' ? '뒷면' : '앞면'}입니다`,
      );
      focusNode(face === 'back' ? backFocusRef : frontFocusRef);
    },
    [focusNode],
  );

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
    },
    [ensureBack, orderedGroups.length],
  );

  const registerProgrammaticOffset = useCallback((generation: number, offset: number) => {
    const episodes = programmaticScrollEpisodesRef.current;
    let episode = episodes.find((candidate) => candidate.generation === generation);
    if (!episode) {
      episode = { generation, offsets: [] };
      episodes.push(episode);
    }
    if (!episode.offsets.some((candidate) => isProgrammaticMomentum(candidate, offset))) {
      episode.offsets.push(offset);
    }
  }, []);

  const consumeProgrammaticOffset = useCallback((offset: number): boolean => {
    const episodes = programmaticScrollEpisodesRef.current;
    for (let episodeIndex = 0; episodeIndex < episodes.length; episodeIndex++) {
      const episode = episodes[episodeIndex];
      const offsetIndex = episode.offsets.findIndex((candidate) =>
        isProgrammaticMomentum(candidate, offset),
      );
      if (offsetIndex < 0) continue;
      episode.offsets.splice(offsetIndex, 1);
      if (episode.offsets.length === 0) episodes.splice(episodeIndex, 1);
      return true;
    }
    return false;
  }, []);

  const selectPage = useCallback(
    (page: number, trigger: GroupCarouselTrigger = 'indicator_press') => {
      if (
        holdingGroupIdRef.current !== null ||
        draggingGroupIdRef.current !== null ||
        flipAnimatingRef.current
      )
        return;
      const next = Math.max(0, Math.min(page, pageCount - 1));
      const from = activeIndexRef.current;
      roomReturnRef.current = null;
      const targetOffset = next * snapInterval;
      currentProgrammaticTargetRef.current = targetOffset;
      listRef.current?.scrollToOffset({ offset: targetOffset, animated: true });
      const nextIdentity = orderedGroups[next]?.groupId ?? null;
      const identityChanged = activeIdentityRef.current !== nextIdentity;
      if (pendingFlipRef.current?.groupId !== nextIdentity) pendingFlipRef.current = null;
      activeIdentityRef.current = nextIdentity;
      activeIndexRef.current = next;
      setActiveStableGroupId(nextIdentity);
      setActiveIndex(next);
      setActiveAnchorGroupId(nextIdentity);
      if (identityChanged) {
        setFlippedGroupId(null);
        guideBackGroupIdRef.current = null;
      }
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
    (offsetX: number, logSwipe = true) => {
      const next = Math.max(0, Math.min(Math.round(offsetX / snapInterval), pageCount - 1));
      const nextIdentity = orderedGroups[next]?.groupId ?? null;
      const from = activeIndexRef.current;
      const identityChanged = activeIdentityRef.current !== nextIdentity;
      if (identityChanged) {
        setFlippedGroupId(null);
        guideBackGroupIdRef.current = null;
      }
      activeIdentityRef.current = nextIdentity;
      activeIndexRef.current = next;
      setActiveStableGroupId(nextIdentity);
      setActiveIndex(next);
      setActiveAnchorGroupId(nextIdentity);
      if (from !== next && logSwipe) {
        logGroupCarouselPaged({
          trigger: 'swipe',
          from_index: from,
          to_index: next,
          group_count_bucket: groupCountBucket(orderedGroups.length),
        });
        AccessibilityInfo.announceForAccessibility(
          `${orderedGroups[next]?.name ?? '그룹 찾기'}, ${next + 1} / ${pageCount} 페이지`,
        );
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
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (dragSettleFrameRef.current !== null) {
        cancelAnimationFrame(dragSettleFrameRef.current);
        dragSettleFrameRef.current = null;
      }
      const offsetX = event.nativeEvent.contentOffset.x;
      const currentTarget = currentProgrammaticTargetRef.current;
      if (currentTarget !== null && isProgrammaticMomentum(currentTarget, offsetX)) {
        currentProgrammaticTargetRef.current = null;
        // 같은 offset이 옛 edge episode에도 있더라도 현재 navigation이 우선 소유한다.
        consumeProgrammaticOffset(offsetX);
        if (draggingGroupIdRef.current === null) settleOffset(offsetX, false);
        return;
      }
      const isProgrammatic = consumeProgrammaticOffset(offsetX);
      // edge paging은 overlay 아래 슬롯만 이동시키는 내부 스크롤이다. 여기서 일반 캐러셀
      // settle을 실행하면 활성 identity가 옆 카드로 바뀐다.
      if (draggingGroupIdRef.current !== null) return;
      // drag edge paging의 늦은 momentum 완료는 release/rollback이 확정한 stable identity를
      // 덮어쓰면 안 된다. 사용자 swipe만 일반 settle 경로로 보낸다.
      if (!isProgrammatic) settleOffset(offsetX);
    },
    [consumeProgrammaticOffset, settleOffset],
  );

  const onScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const target = event.nativeEvent.targetContentOffset?.x;
      if (typeof target === 'number') {
        settleOffset(target);
        return;
      }
      const fallbackOffset = event.nativeEvent.contentOffset.x;
      if (dragSettleFrameRef.current !== null) {
        cancelAnimationFrame(dragSettleFrameRef.current);
      }
      // Android의 비관성 drag는 momentum 이벤트가 없으므로 다음 프레임에 현재 offset을
      // 확정한다. 관성이 시작되면 onMomentumScrollBegin에서 이 예약을 취소한다.
      dragSettleFrameRef.current = requestAnimationFrame(() => {
        dragSettleFrameRef.current = null;
        if (mountedRef.current) settleOffset(fallbackOffset);
      });
    },
    [settleOffset],
  );

  const onMomentumScrollBegin = useCallback(() => {
    if (dragSettleFrameRef.current === null) return;
    cancelAnimationFrame(dragSettleFrameRef.current);
    dragSettleFrameRef.current = null;
  }, []);

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

  const measureDeckBounds = useCallback(() => {
    deckAnchorRef.current?.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      deckBoundsRef.current = { x, y, width, height };
    });
  }, []);

  const handleDeckLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { x, y, width, height } = event.nativeEvent.layout;
      // measureInWindow 응답 전 한 프레임과 host measurement가 없는 테스트 환경의 보수적 fallback.
      deckBoundsRef.current = { x: x + insets.left, y: y + insets.top, width, height };
      measureDeckBounds();
    },
    [insets.left, insets.top, measureDeckBounds],
  );

  const cancelHold = useCallback((updateState = true) => {
    if (holdTimerRef.current !== null) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    holdRef.current = null;
    holdingGroupIdRef.current = null;
    if (updateState) setHoldingGroupId(null);
  }, []);

  const activateHeldDrag = useCallback(
    (groupId: string) => {
      const hold = holdRef.current;
      if (
        hold?.groupId !== groupId ||
        refreshingRef.current ||
        flipAnimatingRef.current ||
        draggingGroupIdRef.current !== null
      ) {
        cancelHold();
        return;
      }

      const from = orderedGroupsRef.current.findIndex((group) => group.groupId === groupId);
      if (from < 0) {
        cancelHold();
        return;
      }

      holdTimerRef.current = null;
      holdRef.current = null;
      holdingGroupIdRef.current = null;
      setHoldingGroupId(null);
      measureDeckBounds();
      roomReturnRef.current = null;
      pendingFlipRef.current = null;
      const sourceOrder = orderedGroupsRef.current.map((group) => group.groupId);
      dragRef.current = {
        generation: ++dragGenerationRef.current,
        groupId,
        from,
        target: from,
        fingerTranslateX: 0,
        translateX: 0,
        activationDx: hold.latestDx,
        activationDy: hold.latestDy,
        lastGestureDx: 0,
        sourceOrder,
      };
      draggingGroupIdRef.current = groupId;
      setDraggingGroupId(groupId);
      setReorderPreview({
        groupId,
        from,
        target: from,
        fingerTranslateX: 0,
        translateX: 0,
      });
      setFlippedGroupId(null);
      hapticMedium();
    },
    [cancelHold, measureDeckBounds],
  );

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
        // FlatList도 한 페이지 이동하므로 슬롯 판정용 논리 이동량에는 같은 거리를 누적한다.
        // 손가락을 따르는 overlay는 fingerTranslateX만 써서 자동 paging의 보정을 받지 않는다.
        drag.translateX += direction * reorderStep;
        setReorderPreview({
          groupId: drag.groupId,
          from: drag.from,
          target: drag.target,
          fingerTranslateX: drag.fingerTranslateX,
          translateX: drag.translateX,
        });
        const offset = next * snapInterval;
        registerProgrammaticOffset(drag.generation, offset);
        listRef.current?.scrollToOffset({ offset, animated: true });
      };
      page();
      edgeTimerRef.current = setInterval(page, EDGE_PAGE_THROTTLE_MS);
    },
    [registerProgrammaticOffset, reorderStep, snapInterval, stopEdgePaging],
  );

  const commitMove = useCallback(
    (groupId: string, targetIndex: number, trigger: 'drag' | 'accessibility_action') => {
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
        currentProgrammaticTargetRef.current = null;
        const groupName = orderedGroupsRef.current.find((group) => group.groupId === groupId)?.name;
        AccessibilityInfo.announceForAccessibility(
          `${groupName ?? '그룹'} 카드를 ${target + 1}번째로 이동했습니다`,
        );
        requestAnimationFrame(() => {
          if (!mountedRef.current) return;
          // commitOrder의 새 data가 FlatList에 반영된 다음 이동해야, 새 0번 카드가 화면에 남고
          // indicator만 target을 가리키는 불일치가 생기지 않는다.
          listRef.current?.scrollToOffset({ offset: target * snapInterval, animated: false });
          const node = findNodeHandle(reorderGripRefs.current.get(groupId) ?? null);
          if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
        });
      }
      return committed;
    },
    [commitOrder, snapInterval],
  );

  const rollbackDrag = useCallback(
    (drag: Pick<ReorderPreview, 'groupId' | 'from'>) => {
      const currentIndex = orderedGroupsRef.current.findIndex(
        (group) => group.groupId === drag.groupId,
      );
      if (currentIndex < 0) return;
      // 서버 reconcile이 drag 도중 들어왔어도 옛 index가 아니라 stable groupId의 현재 슬롯으로 복귀한다.
      activeIdentityRef.current = drag.groupId;
      activeIndexRef.current = currentIndex;
      setActiveStableGroupId(drag.groupId);
      setActiveIndex(currentIndex);
      currentProgrammaticTargetRef.current = null;
      listRef.current?.scrollToOffset({
        offset: currentIndex * snapInterval,
        animated: false,
      });
    },
    [snapInterval],
  );

  const cancelDrag = useCallback(
    (updateState = true) => {
      cancelHold(updateState);
      stopEdgePaging();
      const drag = dragRef.current;
      dragRef.current = null;
      draggingGroupIdRef.current = null;
      if (updateState) {
        setDraggingGroupId(null);
        setReorderPreview(null);
        if (drag) rollbackDrag(drag);
      }
    },
    [cancelHold, rollbackDrag, stopEdgePaging],
  );
  cancelDragRef.current = cancelDrag;

  useEffect(() => {
    if (!isScreenFocused) cancelDrag();
  }, [cancelDrag, isScreenFocused]);

  const handlersFor = useCallback(
    (groupId: string) => {
      const responderKey = `${groupId}:${snapInterval}:${orderedGroupIds.join(',')}`;
      const cached = respondersRef.current.get(responderKey);
      if (cached) return cached.panHandlers;
      const responder = PanResponder.create({
        // 핸들은 touch-down부터 episode를 소유한다. 그래야 움직이기 전 0.3초 hold를 측정하면서
        // 원형 게이지를 보여 줄 수 있고, hold 중 부모 carousel이 먼저 swipe를 가져가지 않는다.
        onStartShouldSetPanResponder: () =>
          !refreshingRef.current &&
          !flipAnimatingRef.current &&
          holdingGroupIdRef.current === null &&
          draggingGroupIdRef.current === null,
        onMoveShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: () => false,
        // 0.3초가 지난 뒤 손가락이 움직여도 부모 FlatList가 responder를 가져가면 같은 touch의
        // drag episode가 끊긴다. 핸들에서 시작한 episode는 release까지 핸들이 소유한다.
        onPanResponderTerminationRequest: () =>
          holdRef.current?.groupId !== groupId && dragRef.current?.groupId !== groupId,
        onPanResponderGrant: () => {
          if (
            refreshingRef.current ||
            flipAnimatingRef.current ||
            holdingGroupIdRef.current !== null ||
            draggingGroupIdRef.current !== null
          )
            return;
          holdRef.current = { groupId, startedAt: Date.now(), latestDx: 0, latestDy: 0 };
          holdingGroupIdRef.current = groupId;
          setHoldingGroupId(groupId);
          holdTimerRef.current = setTimeout(() => activateHeldDrag(groupId), REORDER_HOLD_MS);
        },
        onPanResponderMove: (_event, gesture) => {
          const hold = holdRef.current;
          if (hold?.groupId === groupId) {
            // JS 타이머와 native move 이벤트가 0.3초 경계에서 같은 프레임에 몰릴 수 있다.
            // 이미 시간이 찼다면 move를 취소 신호로 보지 않고, 이 이벤트에서 바로 drag로
            // 승격한 뒤 아래 로직까지 계속 흘려 손가락의 첫 이동도 놓치지 않는다.
            if (Date.now() - hold.startedAt >= REORDER_HOLD_MS) {
              activateHeldDrag(groupId);
            } else {
              hold.latestDx = gesture.dx;
              hold.latestDy = gesture.dy;
              if (
                Math.abs(gesture.dx) > REORDER_HOLD_CANCEL_SLOP ||
                Math.abs(gesture.dy) > REORDER_HOLD_CANCEL_SLOP
              )
                cancelHold();
              return;
            }
          }

          const drag = dragRef.current;
          if (!drag) return;
          const translatedDx = gesture.dx - drag.activationDx;
          const deltaX = translatedDx - drag.lastGestureDx;
          drag.lastGestureDx = translatedDx;
          drag.fingerTranslateX = translatedDx;
          drag.translateX += deltaX;
          const max = orderedGroupsRef.current.length - 1;
          // 큰 카드 기준 반 슬롯을 넘겼을 때 다음 위치를 미리 보여 준다.
          const pointerTarget = Math.max(
            0,
            Math.min(drag.from + Math.round(drag.translateX / reorderStep), max),
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
          setReorderPreview({
            groupId: drag.groupId,
            from: drag.from,
            target: drag.target,
            fingerTranslateX: drag.fingerTranslateX,
            translateX: drag.translateX,
          });
        },
        onPanResponderRelease: (_event, gesture) => {
          if (holdRef.current?.groupId === groupId) {
            cancelHold();
            return;
          }
          stopEdgePaging();
          const drag = dragRef.current;
          dragRef.current = null;
          draggingGroupIdRef.current = null;
          setDraggingGroupId(null);
          setReorderPreview(null);
          if (!drag) return;
          const translatedDx = gesture.dx - drag.activationDx;
          const translatedDy = gesture.dy - drag.activationDy;
          // claim 뒤 원점으로 되돌리거나 세로/경계 밖에서 놓는 것은 모두 같은 rollback이다.
          if (
            !shouldClaimReorderDrag(translatedDx, translatedDy) ||
            !isPointInsideDeck(gesture.moveX, gesture.moveY, deckBoundsRef.current)
          ) {
            rollbackDrag(drag);
            return;
          }
          const currentOrder = orderedGroupsRef.current.map((group) => group.groupId);
          if (
            currentOrder.length !== drag.sourceOrder.length ||
            currentOrder.some((currentGroupId, index) => currentGroupId !== drag.sourceOrder[index])
          ) {
            rollbackDrag(drag);
            return;
          }
          const committed = commitMove(drag.groupId, drag.target, 'drag');
          if (!committed) rollbackDrag(drag);
        },
        onPanResponderTerminate: () => cancelDrag(),
      });
      respondersRef.current.set(responderKey, responder);
      return responder.panHandlers;
    },
    [
      commitMove,
      activateHeldDrag,
      cancelHold,
      cancelDrag,
      orderedGroupIds,
      rollbackDrag,
      reorderStep,
      snapInterval,
      startEdgePaging,
      stopEdgePaging,
      windowWidth,
    ],
  );

  useEffect(() => {
    respondersRef.current.clear();
    if (holdingGroupIdRef.current !== null || draggingGroupIdRef.current !== null) cancelDrag();
  }, [cancelDrag, orderedGroupIds, snapInterval, windowWidth]);

  const flipToBack = useCallback(
    (groupId: string, trigger: GroupCardFlipTrigger = 'card_tap') => {
      if (reorderBusy) return;
      roomReturnRef.current = null;
      const index = orderedGroups.findIndex((group) => group.groupId === groupId);
      if (index < 0) return;
      if (activeIdentityRef.current !== groupId) {
        pendingFlipRef.current = { groupId, trigger };
        const targetOffset = index * snapInterval;
        currentProgrammaticTargetRef.current = targetOffset;
        listRef.current?.scrollToOffset({ offset: targetOffset, animated: true });
        return;
      }
      completeUserFlipToBack(groupId, trigger);
    },
    [completeUserFlipToBack, orderedGroups, reorderBusy, snapInterval],
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
    },
    [flippedGroupId, orderedGroups.length],
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
    if (guideReadStateRef.current === 'unknown' && !claimGroupDeckGuideUnknownFallback()) {
      setGuideQueued(false);
      return;
    }
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

  const dragOverlayGroup =
    reorderPreview === null
      ? null
      : (orderedGroups.find((group) => group.groupId === reorderPreview.groupId) ?? null);

  return (
    <View style={s.root} testID="group.list">
      <View style={s.header}>
        {/* 백버튼 규격은 그룹 스택 화면(GroupCreateScreen·NoticeScreen)의 s.backBtn과 같은 32/r16 */}
        {onBack && (
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => {
              if (holdingGroupIdRef.current === null && draggingGroupIdRef.current === null)
                onBack();
            }}
            disabled={reorderBusy}
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
              if (holdingGroupIdRef.current === null && draggingGroupIdRef.current === null)
                onFind('header');
            }}
            disabled={reorderBusy}
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
              if (holdingGroupIdRef.current === null && draggingGroupIdRef.current === null)
                onCreate();
            }}
            disabled={reorderBusy}
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
        contentContainerStyle={[
          s.deckScrollerContent,
          { paddingBottom: tabBarSafeBottom(insets.bottom) },
        ]}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        directionalLockEnabled
        onLayout={(event) => {
          const next = event.nativeEvent.layout.height;
          setDeckViewportHeight((current) => (current === next ? current : next));
        }}
        scrollEnabled={
          guideInputReady && !guideVisible && !flipAnimating && !reorderBusy && !summaryScrollActive
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshGroups}
            enabled={
              guideInputReady &&
              !guideVisible &&
              !flipAnimating &&
              !reorderBusy &&
              !summaryScrollActive
            }
            tintColor={T.accent}
            colors={[T.accent]}
          />
        }
        testID="group.list.scroller"
      >
        <View
          ref={deckAnchorRef}
          collapsable={false}
          style={s.deckAnchor}
          onLayout={(event) => {
            setDeckLayoutReady(true);
            handleDeckLayout(event);
          }}
          pointerEvents={guideInputReady && !guideVisible && !flipAnimating ? 'auto' : 'none'}
          testID="group.deck.guideAnchor"
        >
          {!hydrated || !emojiHydrated ? (
            <SkeletonGroup style={s.deckSkeleton} testID="group.deck.hydrating">
              <View testID="group.deck.hydrating.cardSurface">
                <Skeleton w={cardWidth} h={cardHeight} radius={22} />
              </View>
              <View testID="group.deck.hydrating.peekSurface">
                <Skeleton w={cardWidth} h={cardHeight} radius={22} />
              </View>
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
                // 잡은 카드는 아래 overlay가 소유한다. source 셀을 끝까지 살리려고 windowSize를
                // 전체 그룹 수로 키우지 않아 FlatList의 기본 가상화 범위를 그대로 보존한다.
                scrollEnabled={guideInputReady && !guideVisible && !flipAnimating && !reorderBusy}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[s.listContent, { paddingHorizontal: SIDE_PEEK }]}
                ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
                snapToInterval={snapInterval}
                snapToAlignment="start"
                decelerationRate="fast"
                disableIntervalMomentum
                onScrollBeginDrag={() => {
                  // 실제 사용자 swipe가 시작되면 이전 edge episode의 유실된 completion은 더 이상
                  // 도착할 수 없다. 남은 programmatic offset을 여기서만 폐기한다.
                  programmaticScrollEpisodesRef.current = [];
                  currentProgrammaticTargetRef.current = null;
                  roomReturnRef.current = null;
                  pendingFlipRef.current = null;
                  guideBackGroupIdRef.current = null;
                  setSkipFlipTransition(true);
                  setFlippedGroupId(null);
                  requestAnimationFrame(() => {
                    if (mountedRef.current) setSkipFlipTransition(false);
                  });
                }}
                onMomentumScrollEnd={onMomentumScrollEnd}
                onMomentumScrollBegin={onMomentumScrollBegin}
                onScrollEndDrag={onScrollEndDrag}
                ListFooterComponent={
                  <View
                    style={[
                      s.cardStage,
                      {
                        marginLeft: CARD_GAP,
                        height: cardHeight + GROUP_CARD_FLIP_SAFE_INSET * 2,
                      },
                    ]}
                    accessibilityElementsHidden={renderedActiveIndex !== orderedGroups.length}
                    importantForAccessibility={
                      renderedActiveIndex === orderedGroups.length ? 'auto' : 'no-hide-descendants'
                    }
                  >
                    <View>
                      <FindMoreCard
                        width={cardWidth}
                        minHeight={cardHeight}
                        position={pageCount}
                        pageCount={pageCount}
                        onPress={() => {
                          if (
                            holdingGroupIdRef.current === null &&
                            draggingGroupIdRef.current === null
                          )
                            onFind('end_card');
                        }}
                        focusable={renderedActiveIndex === orderedGroups.length}
                      />
                    </View>
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
                    <ReorderMotionCard
                      width={cardWidth}
                      groupId={item.groupId}
                      dragging={reorderPreview?.groupId === item.groupId}
                      reordering={reorderPreview !== null}
                      translateX={resolveReorderTranslation(index, reorderPreview, snapInterval)}
                    >
                      <GroupCardFlip
                        groupId={item.groupId}
                        minHeight={cardHeight}
                        flipped={flippedGroupId === item.groupId}
                        skipTransition={skipFlipTransition}
                        onTransitioningChange={
                          item.groupId === activeGroupId ? handleFlipTransition : undefined
                        }
                        onTransitionComplete={
                          item.groupId === activeGroupId ? handleFlipTransitionComplete : undefined
                        }
                        back={
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
                              activeIdentityRef.current === item.groupId
                                ? settingsFocusRef
                                : undefined
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
                            onInvite={() => onInvite(item.groupId, item.name)}
                            onSummaryScrollActivityChange={setSummaryScrollActive}
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
                        }
                        front={
                          <GroupCardFront
                            group={item}
                            cardRef={item.groupId === activeGroupId ? guideFrontRef : undefined}
                            emoji={emojiFor(item.groupId)}
                            position={index + 1}
                            pageCount={pageCount}
                            reorderCount={orderedGroups.length}
                            reorderHoldMs={REORDER_HOLD_MS}
                            reorderState={
                              draggingGroupId === item.groupId
                                ? 'active'
                                : holdingGroupId === item.groupId
                                  ? 'holding'
                                  : 'idle'
                            }
                            active={item.groupId === activeGroupId}
                            bodyRef={
                              activeIdentityRef.current === item.groupId ? frontFocusRef : undefined
                            }
                            gripRef={(node) => {
                              if (node) reorderGripRefs.current.set(item.groupId, node);
                              else reorderGripRefs.current.delete(item.groupId);
                            }}
                            onFlip={() => flipToBack(item.groupId)}
                            onAccessibilityFlip={() =>
                              flipToBack(item.groupId, 'accessibility_action')
                            }
                            reorderHandlers={
                              item.groupId === activeGroupId ? handlersFor(item.groupId) : undefined
                            }
                            canMovePrevious={index > 0}
                            canMoveNext={index < orderedGroups.length - 1}
                            onMoveStep={(step) => {
                              if (
                                holdingGroupIdRef.current !== null ||
                                draggingGroupIdRef.current !== null
                              )
                                return;
                              roomReturnRef.current = null;
                              const from = orderedGroupsRef.current.findIndex(
                                (group) => group.groupId === item.groupId,
                              );
                              if (commitMove(item.groupId, from + step, 'accessibility_action'))
                                setFlippedGroupId(null);
                            }}
                          />
                        }
                      />
                    </ReorderMotionCard>
                  </View>
                )}
              />

              {dragOverlayGroup && reorderPreview && (
                <View
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={[
                    s.dragOverlay,
                    {
                      left: SIDE_PEEK,
                      width: cardWidth,
                      height: cardHeight + GROUP_CARD_FLIP_SAFE_INSET * 2,
                      transform: [{ translateX: reorderPreview.fingerTranslateX }],
                    },
                  ]}
                  testID={`group.card.dragOverlay.${dragOverlayGroup.groupId}`}
                >
                  <View style={{ height: cardHeight }}>
                    <GroupCardFront
                      group={dragOverlayGroup}
                      emoji={emojiFor(dragOverlayGroup.groupId)}
                      position={reorderPreview.target + 1}
                      pageCount={pageCount}
                      reorderCount={orderedGroups.length}
                      reorderHoldMs={REORDER_HOLD_MS}
                      reorderState="active"
                      active={false}
                      onFlip={() => undefined}
                    />
                  </View>
                </View>
              )}
              {saveFailed && (
                <Text style={s.saveError} accessibilityRole="alert">
                  순서를 저장하지 못했어요. 다음 변경 때 다시 시도하며, 앱을 다시 열면 이전 순서로
                  돌아갈 수 있어요.
                </Text>
              )}

              <PageIndicator
                pageCount={pageCount}
                activeIndex={indicatorActiveIndex}
                pageLabels={[...indicatorGroups.map((group) => group.name), '그룹 찾기']}
                disabled={flipAnimating || reorderBusy}
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
        accessibilityTitle="그룹 카드 안내"
        // blocking sheet와 RN Modal을 같은 commit에 마운트하지 않는다. interruption effect는
        // 계측·queue를 정리하고, 렌더 경계에서는 blocker가 overlay를 즉시 내린다.
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
  deckScroller: { flex: 1 },
  deckScrollerContent: { flexGrow: 1 },
  deckAnchor: { position: 'relative' },
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
  cardStage: { justifyContent: 'center' },
  deckSkeleton: {
    flexDirection: 'row',
    gap: CARD_GAP,
    paddingHorizontal: SIDE_PEEK,
    paddingTop: GROUP_CARD_FLIP_SAFE_INSET,
    paddingBottom: T.space.md + 44 + GROUP_CARD_FLIP_SAFE_INSET,
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
  draggingSource: { opacity: 0 },
  dragOverlay: {
    position: 'absolute',
    top: 0,
    zIndex: 10,
    justifyContent: 'center',
    elevation: 10,
  },
  saveError: {
    ...T.text.caption,
    color: T.dangerInk,
    textAlign: 'center',
    paddingTop: T.space.xs,
  },
});
