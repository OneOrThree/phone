import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  AccessibilityInfo,
  AppState,
  FlatList,
  PanResponder,
  RefreshControl,
  ScrollView,
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
import * as ReactNative from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { T } from '@/constants/theme';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
import {
  logGroupCardActionClicked,
  logGroupCardDeckViewed,
  logGroupCardFlipped,
  logGroupCardReordered,
  logGroupCarouselPaged,
  logGroupFindOpened,
  type GroupCountBucket,
  type GroupEntry,
} from '@/services/analyticsEvents';
import {
  createCardInteractionContext,
  type CardInteractionContext,
} from '@/services/cardInteraction';
import { STORAGE_KEYS } from '@/types/storage';
import type { LeagueMemberResponse } from '@/types/api';
import { enterUp } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { todayStrKst } from '@/utils/localDate';
import { FindMoreCard } from './components/FindMoreCard';
import { PageIndicator } from './components/PageIndicator';
import { GroupCardFront } from './components/GroupCardFront';
import { GroupCardBack } from './components/GroupCardBack';
import { GroupCardSummaryAdapter } from './groupCardSummary';
import { GroupFocusPollingController, groupFocusStatusStore } from './groupFocusStatus';
import { useGroupCardOrder } from './useGroupCardOrder';
import {
  DEFAULT_GROUP_CARD_EMOJI,
  groupCardEmojiLabel,
  type GroupCardEmojiBucket,
} from './groupCardEmojiStore';
import {
  isGroupDeckGuideCompletedInSession,
  markGroupDeckGuideCompletedInSession,
  reserveUnknownGroupDeckGuideAttempt,
} from './groupDeckGuideSession';

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

/**
 * 카드 한 장의 최소 높이 — 로딩 스켈레톤(GroupScreen)이 같은 실루엣을 그리도록 공유한다.
 * 앞면·뒷면의 300pt 최소 높이와 반드시 같은 값이어야 데이터 도착 때 화면이 밀리지 않는다.
 */
export const GROUP_CARD_HEIGHT = 300;

// GroupCardSummaryAdapter는 화면별 focus 구독을 직접 소유하지 않는다. GroupFocusStatusStore는
// user/date scope별 구독만 제공하므로, 아래 facade로 조회·재시도만 연결하고 화면 effect에서
// 현재 scope를 구독해 snapshot 갱신을 전달한다.
const groupCardSummaryFocusDependency = {
  getState: (userId: string, date: string) => groupFocusStatusStore.getState(userId, date),
  ensure: (userId: string, date: string) => groupFocusStatusStore.ensure(userId, date),
  retry: (userId: string, date: string) => groupFocusStatusStore.retry(userId, date),
  subscribe: (_listener: () => void) => () => undefined,
};

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
  userId?: string | null;
  cardEmojiByGroupId?: GroupCardEmojiBucket;
  onSelect: (groupId: string, interaction: CardInteractionContext) => void;
  onStartFocus?: (groupId: string, interaction: CardInteractionContext) => void;
  onOpenSettings?: (groupId: string) => void;
  onCreate: () => void;
  onFind: () => void;
  onRefresh: () => Promise<void>;
  onBack?: () => void;
  screenFocused?: boolean;
  entrySource?: GroupEntry;
  viewEpisodeId?: number;
  guideBlocked?: boolean;
  dataReady?: boolean;
  successfulListVersion?: number;
}

function groupCountBucket(count: number): GroupCountBucket {
  if (count === 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2_5';
  if (count <= 10) return '6_10';
  return '11_plus';
}

export default function GroupListScreen({
  groups,
  userId = null,
  cardEmojiByGroupId = {},
  onSelect,
  onStartFocus,
  onOpenSettings,
  onCreate,
  onFind,
  onRefresh,
  onBack,
  screenFocused = true,
  entrySource = 'unknown',
  viewEpisodeId = 0,
  guideBlocked = false,
  dataReady = true,
  successfulListVersion = 0,
}: GroupListScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [refreshing, setRefreshing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [flippedGroupId, setFlippedGroupId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [reorderMenuGroupId, setReorderMenuGroupId] = useState<string | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const cardWidth = Math.max(240, windowWidth - SIDE_PEEK * 2);
  const snapInterval = cardWidth + CARD_GAP;
  const { orderedGroupIds, hydrated, saveFailed, commitOrder } = useGroupCardOrder({
    serverGroupIds: groups.map((group) => group.groupId),
    userId,
    successfulListVersion,
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
  const activeIdentityRef = useRef<string | null>(null);
  const programmaticMomentumCountRef = useRef(0);
  const actionAcceptedRef = useRef(false);
  const roomReturnFocusGroupIdRef = useRef<string | null>(null);
  const roomReturnWasBlurredRef = useRef(false);
  const activeInitializedRef = useRef(false);
  const orderedGroupsRef = useRef(orderedGroups);
  orderedGroupsRef.current = orderedGroups;
  const [date, setDate] = useState(todayStrKst);
  const groupIdsKey = groups.map((group) => group.groupId).join('\u0000');
  const countBucket = groupCountBucket(groups.length);
  const deckViewedEpisodeRef = useRef<number | null>(null);
  const deckViewPendingEpisodeRef = useRef<number | null>(null);
  const [deckInputEpisode, setDeckInputEpisode] = useState<number | null>(null);
  const [deckGuideVisible, setDeckGuideVisible] = useState(false);
  const [guidePrimaryFocusGroupId, setGuidePrimaryFocusGroupId] = useState<string | null>(null);
  const [frontFocusGroupId, setFrontFocusGroupId] = useState<string | null>(null);
  const deckGuideVisibleRef = useRef(false);
  deckGuideVisibleRef.current = deckGuideVisible;
  const viewEpisodeRef = useRef(viewEpisodeId);
  viewEpisodeRef.current = viewEpisodeId;
  const guideInterruptedEpisodeRef = useRef<number | null>(null);
  const guideBackGroupIdRef = useRef<string | null>(null);
  const deckGuideAnchorRef = useRef<View | null>(null);
  const activeCardGuideAnchorRef = useRef<View | null>(null);
  const reorderFirstOptionRef = useRef<ComponentRef<typeof TouchableOpacity>>(null);
  const reorderGripRefs = useRef(new Map<string, View>());
  const frontDisclosureRefs = useRef(new Map<string, View>());
  const [, refreshSummary] = useState(0);
  const summaryAdapterRef = useRef<GroupCardSummaryAdapter<LeagueMemberResponse[]> | null>(null);
  if (summaryAdapterRef.current === null) {
    summaryAdapterRef.current = new GroupCardSummaryAdapter(groupCardSummaryFocusDependency);
  }
  const summaryAdapter = summaryAdapterRef.current;
  const focusController = useMemo(
    () =>
      userId ? new GroupFocusPollingController({ store: groupFocusStatusStore, userId }) : null,
    [userId],
  );
  const retryBack = useCallback(
    async (groupId: string) => {
      await Promise.all([
        summaryAdapter.retry(groupId, 'detail'),
        summaryAdapter.retry(groupId, 'announcements'),
        summaryAdapter.retry(groupId, 'challenges'),
        summaryAdapter.retry(groupId, 'focus'),
      ]);
    },
    [summaryAdapter],
  );
  const invalidateBack = useCallback(() => {
    // 최신 scoped cache는 public invalidate API 대신 scope 밖 key를 prune한다. null로 한 번
    // 내렸다가 현재 성공 목록 scope를 복원하면, 늦은 이전 응답도 버리면서 다음 retry가 새 요청을 연다.
    const groupIds = groupIdsKey ? groupIdsKey.split('\u0000') : [];
    summaryAdapter.setScope(null);
    summaryAdapter.setScope(userId ? { userId, date, groupIds } : null);
  }, [date, groupIdsKey, summaryAdapter, userId]);

  // 새로고침이 끝나기 전에 이 화면이 사라질 수 있다(그룹이 1건이 되면 GroupScreen이 그룹방으로
  // 갈아끼운다) — 언마운트 뒤 setState를 막는다.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const active = next === 'active';
      setAppActive(active);
      if (!active && deckGuideVisibleRef.current) {
        deckGuideVisibleRef.current = false;
        guideInterruptedEpisodeRef.current = viewEpisodeRef.current;
        guideBackGroupIdRef.current = null;
        setDeckGuideVisible(false);
        setFlippedGroupId(null);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setDate(todayStrKst()), 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const groupIds = groupIdsKey ? groupIdsKey.split('\u0000') : [];
    summaryAdapter.setScope(userId ? { userId, date, groupIds } : null);
    const update = () => refreshSummary((revision) => revision + 1);
    const unsubscribeSummary = summaryAdapter.subscribe(update);
    const unsubscribeFocus = userId
      ? groupFocusStatusStore.subscribe(userId, date, update)
      : () => undefined;
    return () => {
      unsubscribeSummary();
      unsubscribeFocus();
    };
  }, [date, groupIdsKey, summaryAdapter, userId]);

  const previousDateRef = useRef(date);
  useEffect(() => {
    if (previousDateRef.current === date) return;
    previousDateRef.current = date;
    if (flippedGroupId === null) return;
    // 날짜 scope 교체로 폐기된 뒷면 dependency와 focus 상태를 열린 카드에서 즉시 다시 채운다.
    summaryAdapter.ensureBack(flippedGroupId);
    focusController?.notifyFocusFlowReturn();
  }, [date, flippedGroupId, focusController, summaryAdapter]);

  const previousScreenFocusedRef = useRef(screenFocused);
  useEffect(() => {
    const returned = screenFocused && !previousScreenFocusedRef.current;
    previousScreenFocusedRef.current = screenFocused;
    if (!returned) return;
    invalidateBack();
    if (flippedGroupId !== null) retryBack(flippedGroupId).catch(() => undefined);
  }, [flippedGroupId, invalidateBack, retryBack, screenFocused]);

  useEffect(() => {
    focusController?.setLifecycle({
      screenFocused,
      appActive,
      hasGroups: groups.length > 0,
    });
  }, [appActive, focusController, groups.length, screenFocused]);

  useEffect(() => () => focusController?.dispose(), [focusController]);

  useEffect(() => {
    if (screenFocused) actionAcceptedRef.current = false;
    else if (roomReturnFocusGroupIdRef.current !== null) roomReturnWasBlurredRef.current = true;
  }, [screenFocused]);

  // 성공 목록과 로컬 순서가 확정된 뒤 focus episode마다 완료 key를 읽어 실제 guide 상태를 기록한다.
  useEffect(() => {
    if (
      !hydrated ||
      !screenFocused ||
      !appActive ||
      !dataReady ||
      guideInterruptedEpisodeRef.current === viewEpisodeId ||
      deckViewedEpisodeRef.current === viewEpisodeId ||
      deckViewPendingEpisodeRef.current === viewEpisodeId
    )
      return;
    deckViewPendingEpisodeRef.current = viewEpisodeId;
    let canceled = false;
    const recordViewed = (guideState: 'shown' | 'pending' | 'completed' | 'unknown') => {
      if (canceled) return;
      logGroupCardDeckViewed({
        group_count_bucket: countBucket,
        group_entry: entrySource,
        guide_state: guideState,
      });
      deckViewedEpisodeRef.current = viewEpisodeId;
      deckViewPendingEpisodeRef.current = null;
      setDeckInputEpisode(viewEpisodeId);
    };
    if (!userId) {
      setDeckGuideVisible(false);
      recordViewed('unknown');
      return;
    }
    AsyncStorage.getItem(STORAGE_KEYS.guideGroupDeck)
      .then((value) => {
        const incomplete = value !== '1' && !isGroupDeckGuideCompletedInSession();
        setDeckGuideVisible(incomplete);
        recordViewed(incomplete ? (guideBlocked ? 'pending' : 'shown') : 'completed');
      })
      .catch(() => {
        setDeckGuideVisible(reserveUnknownGroupDeckGuideAttempt());
        recordViewed('unknown');
      });
    return () => {
      canceled = true;
      if (deckViewPendingEpisodeRef.current === viewEpisodeId) {
        deckViewPendingEpisodeRef.current = null;
      }
    };
  }, [
    appActive,
    countBucket,
    dataReady,
    entrySource,
    guideBlocked,
    hydrated,
    screenFocused,
    userId,
    viewEpisodeId,
  ]);

  // 새 episode의 전체 목록 성공은 guide 판정에 필요하지만, 이미 한 번 입력을 연 덱은 재조회
  // 실패 중에도 유지한다. 기존 데이터가 있는 오류를 영구 hydrating으로 바꾸지 않는다.
  const deckInputReady = screenFocused && deckInputEpisode !== null;

  const deckGuideSteps: GuideStep[] = useMemo(
    () => [
      {
        text: '내 그룹이 카드로 모였어. 같이 둘러보자!',
        character: require('@/assets/character_hi.png'),
      },
      {
        text:
          orderedGroups.length >= 2
            ? '옆으로 넘기면 다른 그룹을 볼 수 있어.'
            : '이 카드가 내 그룹이야. 그룹이 늘면 옆으로 넘길 수 있어.',
        character: require('@/assets/character_study.png'),
        anchor: deckGuideAnchorRef,
      },
      {
        text: '카드를 탭하면 같은 자리에서 오늘의 방 상태를 볼 수 있어.',
        character: require('@/assets/character_study.png'),
        anchor: activeCardGuideAnchorRef,
      },
      {
        text: '여기서 바로 집중하거나 방 전체를 열어봐.',
        character: require('@/assets/character_happy.png'),
        anchor: activeCardGuideAnchorRef,
        prepare: async () => {
          const groupId = activeIdentityRef.current ?? orderedGroups[0]?.groupId;
          if (!userId || !groupId) return;
          setFlippedGroupId(groupId);
          guideBackGroupIdRef.current = groupId;
          summaryAdapter.ensureBack(groupId);
          focusController?.activate();
          // conditional back tree와 실제 spotlight anchor layout이 commit된 뒤 측정한다.
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          });
        },
      },
    ],
    [focusController, orderedGroups, summaryAdapter, userId],
  );

  const interruptGuide = useCallback(() => {
    if (!deckGuideVisibleRef.current) return;
    deckGuideVisibleRef.current = false;
    guideInterruptedEpisodeRef.current = viewEpisodeRef.current;
    guideBackGroupIdRef.current = null;
    setDeckGuideVisible(false);
    setFlippedGroupId(null);
  }, []);

  const finishGuide = useCallback(() => {
    const groupId = guideBackGroupIdRef.current;
    markGroupDeckGuideCompletedInSession();
    deckGuideVisibleRef.current = false;
    setDeckGuideVisible(false);
    if (groupId) setGuidePrimaryFocusGroupId(groupId);
  }, []);

  const previousGuideBlockedRef = useRef(guideBlocked);
  useEffect(() => {
    const becameBlocked = guideBlocked && !previousGuideBlockedRef.current;
    previousGuideBlockedRef.current = guideBlocked;
    if (becameBlocked) interruptGuide();
  }, [guideBlocked, interruptGuide]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    invalidateBack();
    try {
      await onRefresh();
      if (flippedGroupId !== null) {
        // 최신 main의 scoped cache에는 전체 invalidate API가 없다. 열린 뒷면의 네 dependency를
        // 명시 retry해, 목록 갱신 뒤 stale snapshot을 재사용하지 않는다.
        await retryBack(flippedGroupId);
      }
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [flippedGroupId, invalidateBack, onRefresh, retryBack]);

  const selectPage = useCallback(
    (page: number) => {
      if (draggingGroupId !== null || reorderMenuGroupId !== null) return;
      const next = Math.max(0, Math.min(page, pageCount - 1));
      if (next === activeIndex) return;
      logGroupCarouselPaged({
        trigger: 'indicator_press',
        from_index: activeIndex,
        to_index: next,
        group_count_bucket: countBucket,
      });
      programmaticMomentumCountRef.current += 1;
      listRef.current?.scrollToOffset({ offset: next * snapInterval, animated: true });
      activeIdentityRef.current = orderedGroups[next]?.groupId ?? null;
      setActiveIndex(next);
      setFlippedGroupId(null);
      guideBackGroupIdRef.current = null;
    },
    [
      activeIndex,
      countBucket,
      draggingGroupId,
      orderedGroups,
      pageCount,
      reorderMenuGroupId,
      snapInterval,
    ],
  );

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.max(
        0,
        Math.min(Math.round(event.nativeEvent.contentOffset.x / snapInterval), pageCount - 1),
      );
      const nextIdentity = orderedGroups[next]?.groupId ?? null;
      const programmatic = dragRef.current !== null || programmaticMomentumCountRef.current > 0;
      if (programmaticMomentumCountRef.current > 0) programmaticMomentumCountRef.current -= 1;
      if (!programmatic && activeIdentityRef.current !== nextIdentity) {
        logGroupCarouselPaged({
          trigger: 'swipe',
          from_index: activeIndex,
          to_index: next,
          group_count_bucket: countBucket,
        });
        setFlippedGroupId(null);
        guideBackGroupIdRef.current = null;
      }
      activeIdentityRef.current = nextIdentity;
      setActiveIndex(next);
    },
    [activeIndex, countBucket, orderedGroups, pageCount, snapInterval],
  );

  // 회전·폭 변경·서버 순서 변경 뒤에도 index가 아니라 stable groupId로 같은 페이지를 찾는다.
  useEffect(() => {
    if (!hydrated) return;
    if (!activeInitializedRef.current) {
      activeInitializedRef.current = true;
      activeIdentityRef.current = orderedGroups[0]?.groupId ?? null;
    }
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
  }, [activeIndex, hydrated, orderedGroups, snapInterval]);

  // grip에서 시작한 포인터만 재정렬이 소유한다. 그동안 FlatList의 수평 pan과 본문 tap은
  // 비활성화되며, release에서 실제 순서가 달라진 경우에만 한 번 commit한다.
  const dragRef = useRef<{ groupId: string; from: number; target: number } | null>(null);
  const lastEdgePageAtRef = useRef(0);
  const respondersRef = useRef(new Map<string, ReturnType<typeof PanResponder.create>>());

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
          group_count_bucket: countBucket,
        });
        activeIdentityRef.current = groupId;
        setActiveIndex(target);
        listRef.current?.scrollToOffset({ offset: target * snapInterval, animated: false });
        if (trigger === 'accessibility_action') {
          const groupName = orderedGroupsRef.current.find(
            (group) => group.groupId === groupId,
          )?.name;
          AccessibilityInfo.announceForAccessibility(
            `${groupName ?? '그룹'} 카드를 ${target + 1}번째로 이동했습니다`,
          );
        }
      }
      return committed;
    },
    [commitOrder, countBucket, snapInterval],
  );

  const handlersFor = useCallback(
    (groupId: string) => {
      // width/snap/order를 key에 포함해 effect 정리 전의 첫 render도 오래된 closure를 재사용하지 않는다.
      const responderKey = `${groupId}:${windowWidth}:${snapInterval}:${orderedGroupIds.join(',')}`;
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
          lastEdgePageAtRef.current = 0;
          setDraggingGroupId(groupId);
          setFlippedGroupId(null);
          guideBackGroupIdRef.current = null;
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
          if (direction === 0) drag.target = pointerTarget;
          if (direction < 0) drag.target = Math.min(drag.target, pointerTarget);
          if (direction > 0) drag.target = Math.max(drag.target, pointerTarget);
          const now = Date.now();
          if (direction !== 0 && now - lastEdgePageAtRef.current >= EDGE_PAGE_THROTTLE_MS) {
            drag.target = Math.max(0, Math.min(drag.target + direction, max));
            lastEdgePageAtRef.current = now;
            programmaticMomentumCountRef.current += 1;
            listRef.current?.scrollToOffset({
              offset: drag.target * snapInterval,
              animated: true,
            });
          }
        },
        onPanResponderRelease: (_event, gesture) => {
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
          const drag = dragRef.current;
          dragRef.current = null;
          setDraggingGroupId(null);
          if (!drag) return;
          activeIdentityRef.current = drag.groupId;
          setActiveIndex(drag.from);
          listRef.current?.scrollToOffset({
            offset: drag.from * snapInterval,
            animated: false,
          });
        },
      });
      respondersRef.current.set(responderKey, responder);
      return responder.panHandlers;
    },
    [commitMove, orderedGroupIds, reorderMenuGroupId, snapInterval, windowWidth],
  );

  useEffect(() => {
    respondersRef.current.clear();
  }, [orderedGroupIds, reorderMenuGroupId, snapInterval, windowWidth]);

  useEffect(() => {
    if (
      reorderMenuGroupId !== null &&
      (!screenFocused || !orderedGroups.some((group) => group.groupId === reorderMenuGroupId))
    ) {
      setReorderMenuGroupId(null);
    }
  }, [orderedGroups, reorderMenuGroupId, screenFocused]);

  useEffect(() => {
    if (reorderMenuGroupId === null) return;
    const frame = requestAnimationFrame(() => {
      const node = ReactNative.findNodeHandle(reorderFirstOptionRef.current);
      if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
    });
    return () => cancelAnimationFrame(frame);
  }, [reorderMenuGroupId]);

  const closeReorderMenu = useCallback((groupId: string, restoreFocus = true) => {
    setReorderMenuGroupId(null);
    if (!restoreFocus) return;
    requestAnimationFrame(() => {
      const node = ReactNative.findNodeHandle(reorderGripRefs.current.get(groupId) ?? null);
      if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
    });
  }, []);

  const flipToBack = useCallback(
    (groupId: string) => {
      if (!userId || draggingGroupId !== null || reorderMenuGroupId !== null) return;
      guideBackGroupIdRef.current = null;
      setFlippedGroupId(groupId);
      summaryAdapter.ensureBack(groupId);
      focusController?.activate();
      logGroupCardFlipped({
        to_face: 'back',
        trigger: 'card_tap',
        group_count_bucket: countBucket,
      });
    },
    [countBucket, draggingGroupId, focusController, reorderMenuGroupId, summaryAdapter, userId],
  );

  const flipToFront = useCallback(
    (groupId: string) => {
      if (flippedGroupId === null) return;
      guideBackGroupIdRef.current = null;
      setFrontFocusGroupId(groupId);
      setFlippedGroupId(null);
      logGroupCardFlipped({
        to_face: 'front',
        trigger: 'card_tap',
        group_count_bucket: countBucket,
      });
    },
    [countBucket, flippedGroupId],
  );

  useEffect(() => {
    if (frontFocusGroupId === null) return;
    const frame = requestAnimationFrame(() => {
      const node = ReactNative.findNodeHandle(
        frontDisclosureRefs.current.get(frontFocusGroupId) ?? null,
      );
      if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
      setFrontFocusGroupId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [frontFocusGroupId]);

  const acceptAction = useCallback(
    (group: GroupSummaryResponse, action: 'focus' | 'room' | 'settings') => {
      if (reorderMenuGroupId !== null || actionAcceptedRef.current) return null;
      actionAcceptedRef.current = true;
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

  const invokeAcceptedAction = useCallback(
    (
      group: GroupSummaryResponse,
      action: 'focus' | 'room' | 'settings',
      invoke: (interaction: CardInteractionContext) => void,
    ) => {
      const interaction = acceptAction(group, action);
      if (!interaction) return;
      try {
        invoke(interaction);
      } catch (error) {
        actionAcceptedRef.current = false;
        throw error;
      }
    },
    [acceptAction],
  );

  if (!hydrated || !deckInputReady) {
    return (
      <View style={s.root} testID="group.list">
        <ActivityIndicator color={T.accent} testID="group.deck.hydrating" />
      </View>
    );
  }

  return (
    <View style={s.root} testID="group.list">
      <View
        style={s.header}
        importantForAccessibility={reorderMenuGroupId ? 'no-hide-descendants' : 'auto'}
        testID="group.list.header"
      >
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
        ref={deckGuideAnchorRef}
        collapsable={false}
        style={s.deckContainer}
        testID="group.deck.guideAnchor"
      >
        <FlatList
          ref={listRef}
          testID="group.list.items"
          data={orderedGroups}
          keyExtractor={(item) => item.groupId}
          horizontal
          CellRendererComponent={GroupListCell}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[s.listContent, { paddingHorizontal: SIDE_PEEK }]}
          ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
          snapToInterval={snapInterval}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          scrollEnabled={draggingGroupId === null && reorderMenuGroupId === null}
          onScrollBeginDrag={() => {
            // 취소되거나 네이티브가 momentum-end를 생략한 programmatic 이동이 다음 사용자 swipe를
            // 삼키지 않도록 실제 손가락 스크롤 시작에서 억제 토큰을 폐기한다.
            programmaticMomentumCountRef.current = 0;
            setFlippedGroupId(null);
            guideBackGroupIdRef.current = null;
          }}
          onMomentumScrollEnd={onMomentumScrollEnd}
          ListFooterComponent={
            <View
              style={{ marginLeft: CARD_GAP }}
              accessible={activeIndex === orderedGroups.length ? undefined : false}
              accessibilityElementsHidden={activeIndex !== orderedGroups.length}
              importantForAccessibility={
                activeIndex === orderedGroups.length ? 'auto' : 'no-hide-descendants'
              }
              pointerEvents={activeIndex === orderedGroups.length ? 'auto' : 'none'}
              testID="group.deck.findMoreWrapper"
            >
              <FindMoreCard
                width={cardWidth}
                position={pageCount}
                pageCount={pageCount}
                onPress={() => {
                  logGroupFindOpened({ entry_point: 'end_card' });
                  onFind();
                }}
              />
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={T.accent}
            />
          }
          renderItem={({ item, index }) => (
            <View
              style={{ width: cardWidth }}
              testID={`group.list.card.${item.groupId}`}
              accessible={index === activeIndex ? undefined : false}
              accessibilityElementsHidden={index !== activeIndex}
              importantForAccessibility={index === activeIndex ? 'auto' : 'no-hide-descendants'}
              pointerEvents={index === activeIndex ? 'auto' : 'none'}
            >
              <View
                ref={index === activeIndex ? activeCardGuideAnchorRef : undefined}
                collapsable={false}
                importantForAccessibility={
                  reorderMenuGroupId === item.groupId ? 'no-hide-descendants' : 'auto'
                }
                testID={`group.card.content.${item.groupId}`}
              >
                {flippedGroupId === item.groupId ? (
                  summaryAdapter.getSnapshot(item.groupId) && (
                    <GroupCardBack
                      group={item}
                      snapshot={summaryAdapter.getSnapshot(item.groupId)!}
                      onFlipBack={() => flipToFront(item.groupId)}
                      onOpenSettings={() => {
                        if (!onOpenSettings) return;
                        invokeAcceptedAction(item, 'settings', () => onOpenSettings(item.groupId));
                      }}
                      onStartFocus={() => {
                        if (!onStartFocus) return;
                        invokeAcceptedAction(item, 'focus', (interaction) =>
                          onStartFocus(item.groupId, interaction),
                        );
                      }}
                      onOpenRoom={() => {
                        invokeAcceptedAction(item, 'room', (interaction) => {
                          roomReturnFocusGroupIdRef.current = item.groupId;
                          roomReturnWasBlurredRef.current = false;
                          try {
                            onSelect(item.groupId, interaction);
                          } catch (error) {
                            roomReturnFocusGroupIdRef.current = null;
                            roomReturnWasBlurredRef.current = false;
                            throw error;
                          }
                        });
                      }}
                      focusRoomOnMount={
                        roomReturnWasBlurredRef.current &&
                        roomReturnFocusGroupIdRef.current === item.groupId
                      }
                      onRoomFocusRestored={() => {
                        roomReturnFocusGroupIdRef.current = null;
                        roomReturnWasBlurredRef.current = false;
                      }}
                      suppressInitialFocus={deckGuideVisible}
                      focusPrimaryOnMount={guidePrimaryFocusGroupId === item.groupId}
                      onPrimaryFocusRestored={() => setGuidePrimaryFocusGroupId(null)}
                      onRetry={(section) => summaryAdapter.retry(item.groupId, section)}
                    />
                  )
                ) : (
                  <GroupCardFront
                    group={item}
                    emoji={cardEmojiByGroupId[item.groupId] ?? DEFAULT_GROUP_CARD_EMOJI}
                    emojiLabel={groupCardEmojiLabel(cardEmojiByGroupId[item.groupId])}
                    position={index + 1}
                    pageCount={pageCount}
                    reorderCount={orderedGroups.length}
                    gripRef={(node) => {
                      if (node) reorderGripRefs.current.set(item.groupId, node);
                      else reorderGripRefs.current.delete(item.groupId);
                    }}
                    disclosureRef={(node) => {
                      if (node) frontDisclosureRefs.current.set(item.groupId, node);
                      else frontDisclosureRefs.current.delete(item.groupId);
                    }}
                    onFlip={() => flipToBack(item.groupId)}
                    reorderHandlers={handlersFor(item.groupId)}
                    canMovePrevious={index > 0}
                    canMoveNext={index < orderedGroups.length - 1}
                    onMoveStep={(step) => {
                      const from = orderedGroupsRef.current.findIndex(
                        (group) => group.groupId === item.groupId,
                      );
                      if (commitMove(item.groupId, from + step, 'accessibility_action')) {
                        setFlippedGroupId(null);
                      }
                    }}
                  />
                )}
              </View>
              {reorderMenuGroupId === item.groupId && (
                <View
                  style={s.reorderMenu}
                  accessibilityViewIsModal
                  onAccessibilityEscape={() => closeReorderMenu(item.groupId)}
                  testID={`group.card.reorderMenu.${item.groupId}`}
                >
                  <Text style={s.reorderTitle}>순서 변경</Text>
                  <ScrollView
                    style={s.reorderOptions}
                    nestedScrollEnabled
                    testID={`group.card.reorderOptions.${item.groupId}`}
                  >
                    {orderedGroups.map((target, targetIndex) => (
                      <TouchableOpacity
                        ref={targetIndex === 0 ? reorderFirstOptionRef : undefined}
                        key={target.groupId}
                        style={s.reorderOption}
                        onPress={() => {
                          commitMove(item.groupId, targetIndex, 'pointer_control');
                          closeReorderMenu(item.groupId);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${targetIndex + 1}번째로 이동`}
                        testID={`group.card.reorderTo.${item.groupId}.${targetIndex}`}
                      >
                        <Text style={s.reorderOptionText}>{targetIndex + 1}번째</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <TouchableOpacity
                    style={s.reorderClose}
                    onPress={() => closeReorderMenu(item.groupId)}
                    accessibilityRole="button"
                    accessibilityLabel="순서 변경 닫기"
                    testID={`group.card.reorderClose.${item.groupId}`}
                  >
                    <Text style={s.reorderCloseText}>완료</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        />
      </View>

      {saveFailed && (
        <Text
          style={s.saveError}
          accessibilityRole="alert"
          importantForAccessibility={reorderMenuGroupId ? 'no-hide-descendants' : 'auto'}
        >
          순서를 저장하지 못했어요. 다음 변경 때 다시 시도합니다.
        </Text>
      )}

      <View
        importantForAccessibility={reorderMenuGroupId ? 'no-hide-descendants' : 'auto'}
        testID="group.deck.controls"
      >
        <PageIndicator
          activeIndex={activeIndex}
          onSelectPage={selectPage}
          pageLabels={[...orderedGroups.map((group) => group.name), '그룹 찾기']}
          pageKeys={[...orderedGroups.map((group) => group.groupId), 'find-more']}
        />
        <TouchableOpacity
          style={s.refreshButton}
          onPress={handleRefresh}
          disabled={refreshing}
          accessibilityRole="button"
          accessibilityLabel={refreshing ? '그룹 새로고침 중' : '그룹 새로고침'}
          accessibilityState={{ busy: refreshing, disabled: refreshing }}
          testID="group.deck.refresh"
        >
          <Ionicons name="refresh" size={18} color={T.inkSub} />
          <Text style={s.refreshText}>{refreshing ? '새로고침 중…' : '새로고침'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── 하단 고정 CTA — 빈 상태(GroupScreen)와 같은 52/r16 규격을 그대로 쓴다 ── */}
      <View
        style={[s.footer, { paddingBottom: insets.bottom + TAB_BAR_SPACE }]}
        importantForAccessibility={reorderMenuGroupId ? 'no-hide-descendants' : 'auto'}
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
          onPress={() => {
            logGroupFindOpened({ entry_point: 'list' });
            onFind();
          }}
          testID="group.list.find"
        >
          <Text style={s.outlineText}>그룹 찾기</Text>
        </TouchableOpacity>
      </View>

      {deckGuideVisible && screenFocused && appActive && !guideBlocked && (
        <TabGuideOverlay
          storageKey={STORAGE_KEYS.guideGroupDeck}
          steps={deckGuideSteps}
          visible
          onFinish={finishGuide}
          onRequestClose={interruptGuide}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  deckContainer: { flex: 1 },

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
  reorderMenu: {
    position: 'absolute',
    top: 52,
    right: T.space.md,
    zIndex: 5,
    minWidth: 132,
    padding: T.space.sm,
    borderRadius: 14,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
  },
  reorderTitle: { ...T.text.caption, color: T.inkMuted, padding: T.space.xs },
  reorderOptions: { maxHeight: 220 },
  reorderOption: { minHeight: 44, justifyContent: 'center', paddingHorizontal: T.space.sm },
  reorderOptionText: { ...T.text.label, color: T.ink },
  reorderClose: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: T.border,
  },
  reorderCloseText: { ...T.text.label, color: T.accent },
  saveError: {
    ...T.text.caption,
    color: T.dangerInk,
    textAlign: 'center',
    paddingTop: T.space.xs,
  },
  refreshButton: {
    minHeight: 44,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.xs,
    paddingHorizontal: T.space.lg,
  },
  refreshText: { ...T.text.caption, color: T.inkSub },
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
