import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  FlatList,
  RefreshControl,
  ScrollView,
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
  logGroupCardDeckViewed,
  logGroupDeckGuideInterrupted,
  logGroupDeckGuideReadFailed,
  logGroupDeckGuideWriteFailed,
  logTabGuideCompleted,
  type GroupEntry,
  type GroupCountBucket,
} from '@/services/analyticsEvents';
import type { LeagueMemberResponse } from '@/types/api';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { FindMoreCard } from './components/FindMoreCard';
import { PageIndicator } from './components/PageIndicator';
import { GroupCardFront } from './components/GroupCardFront';
import { GroupCardBackSummary } from './components/GroupCardBackSummary';
import type { GroupCardSummarySnapshot } from './groupCardSummary';
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
  onSelect: (groupId: string) => void;
  onCreate: () => void;
  onFind: () => void;
  onRefresh: () => Promise<void>;
  onBack?: () => void;
  // guide eligibility는 성공 목록만으로 부족하다. 인증·route·overlay queue 상태를 부모가 제공한다.
  userId?: string | null;
  guideBlocked?: boolean;
  guideScreenFocused?: boolean;
  guideEpisode?: number;
  groupEntry?: GroupEntry;
  // 사용자 첫 back과 guide 3→4가 공유하는 lazy ensure 경로다.
  onEnsureBack?: (groupId: string) => void;
  getBackSnapshot?: (groupId: string) => GroupCardSummarySnapshot<LeagueMemberResponse[]> | null;
}

export default function GroupListScreen({
  groups,
  onSelect,
  onCreate,
  onFind,
  onRefresh,
  onBack,
  userId,
  guideBlocked = false,
  guideScreenFocused = true,
  guideEpisode = 0,
  groupEntry = 'unknown',
  onEnsureBack,
  getBackSnapshot,
}: GroupListScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [refreshing, setRefreshing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [flippedGroupId, setFlippedGroupId] = useState<string | null>(null);
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
  const pageCount = groups.length + 1;
  const listRef = useRef<FlatList<GroupSummaryResponse>>(null);
  const activeIdentityRef = useRef<string | null>(groups[0]?.groupId ?? null);
  const deckAnchorRef = useRef<View | null>(null);
  const activeCardRef = useRef<View | null>(null);
  const guideDecisionEpisodeRef = useRef<number | null>(null);
  const guideReadStateRef = useRef<GroupDeckGuideReadState | null>(null);
  const guideStartGroupsRef = useRef<string | null>(null);
  const guideVisibleRef = useRef(false);
  const guideBlockedRef = useRef(guideBlocked);
  const groupFingerprint = groups.map((group) => group.groupId).join('|');
  const activeGroupId = groups[activeIndex]?.groupId ?? null;
  const guideEligible =
    typeof userId === 'string' &&
    groups.length > 0 &&
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
    (page: number) => {
      const next = Math.max(0, Math.min(page, pageCount - 1));
      listRef.current?.scrollToOffset({ offset: next * snapInterval, animated: true });
      const nextIdentity = groups[next]?.groupId ?? null;
      if (activeIdentityRef.current !== nextIdentity) setFlippedGroupId(null);
      activeIdentityRef.current = nextIdentity;
      setActiveIndex(next);
      setActiveAnchorGroupId(nextIdentity);
    },
    [groups, pageCount, snapInterval],
  );

  const settlePage = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.max(
        0,
        Math.min(Math.round(event.nativeEvent.contentOffset.x / snapInterval), pageCount - 1),
      );
      const nextIdentity = groups[next]?.groupId ?? null;
      if (activeIdentityRef.current !== nextIdentity) setFlippedGroupId(null);
      activeIdentityRef.current = nextIdentity;
      setActiveIndex(next);
      setActiveAnchorGroupId(nextIdentity);
    },
    [groups, pageCount, snapInterval],
  );

  const flipCard = useCallback(
    (groupId: string) => {
      const index = groups.findIndex((group) => group.groupId === groupId);
      if (index < 0) return;
      if (activeIdentityRef.current !== groupId) {
        listRef.current?.scrollToOffset({ offset: index * snapInterval, animated: true });
        activeIdentityRef.current = groupId;
        setActiveIndex(index);
        setActiveAnchorGroupId(groupId);
      }
      setFlippedGroupId(groupId);
      onEnsureBack?.(groupId);
    },
    [groups, onEnsureBack, snapInterval],
  );

  // 회전·폭 변경·서버 순서 변경 뒤에도 index가 아니라 stable groupId로 같은 페이지를 찾는다.
  useEffect(() => {
    const identity = activeIdentityRef.current;
    const next =
      identity === null ? groups.length : groups.findIndex((g) => g.groupId === identity);
    const safeIndex = next >= 0 ? next : Math.min(activeIndex, Math.max(0, groups.length - 1));
    activeIdentityRef.current = groups[safeIndex]?.groupId ?? null;
    setActiveIndex(safeIndex);
    listRef.current?.scrollToOffset({ offset: safeIndex * snapInterval, animated: false });
  }, [activeIndex, groups, snapInterval]);

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
          group_count_bucket: groupCountBucket(groups.length),
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
          group_count_bucket: groupCountBucket(groups.length),
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
  }, [groupEntry, groups.length, guideEligible, guideEpisode]);

  const startGuide = useCallback(() => {
    const firstGroupId = groups[0]?.groupId;
    if (!firstGroupId) return;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    activeIdentityRef.current = firstGroupId;
    setActiveIndex(0);
    setActiveAnchorGroupId(firstGroupId);
    setFlippedGroupId(null);
    guideStartGroupsRef.current = groupFingerprint;
    guideVisibleRef.current = true;
    setGuideVisible(true);
  }, [groupFingerprint, groups]);

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
      groupDeckGuideSteps(groups.length).map((step) => ({
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
              const groupId = activeIdentityRef.current ?? groups[0]?.groupId;
              if (!groupId) return;
              // 사용자 이벤트를 거치지 않는 상태 전환이다. 응답을 기다리지 않고 lazy ensure만 시작한다.
              setFlippedGroupId(groupId);
              onEnsureBack?.(groupId);
            }
          : undefined,
      })),
    [groups, onEnsureBack],
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
    <ScrollView
      style={s.root}
      contentContainerStyle={s.screenContent}
      alwaysBounceVertical
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={T.accent} />
      }
      testID="group.list"
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
          data={groups}
          keyExtractor={(item) => item.groupId}
          horizontal
          scrollEnabled={guideInputReady && !guideVisible}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[s.listContent, { paddingHorizontal: SIDE_PEEK }]}
          ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
          snapToInterval={snapInterval}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          onMomentumScrollEnd={settlePage}
          onScrollEndDrag={settlePage}
          ListFooterComponent={
            <View style={{ marginLeft: CARD_GAP }}>
              <FindMoreCard width={cardWidth} onPress={onFind} />
            </View>
          }
          renderItem={({ item }) => (
            <View
              ref={item.groupId === activeGroupId ? activeCardRef : undefined}
              collapsable={false}
              onLayout={() => {
                if (item.groupId === activeIdentityRef.current)
                  setActiveAnchorGroupId(item.groupId);
              }}
              pointerEvents={guideInputReady && !guideVisible ? 'auto' : 'none'}
              style={{ width: cardWidth }}
              testID={`group.list.card.${item.groupId}`}
            >
              {flippedGroupId === item.groupId ? (
                <GroupCardBackSummary
                  group={item}
                  snapshot={getBackSnapshot?.(item.groupId) ?? null}
                  onOpenRoom={() => onSelect(item.groupId)}
                  onFlipFront={() => setFlippedGroupId(null)}
                />
              ) : (
                <GroupCardFront group={item} onFlip={() => flipCard(item.groupId)} />
              )}
            </View>
          )}
        />

        <PageIndicator pageCount={pageCount} activeIndex={activeIndex} onSelectPage={selectPage} />
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
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
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
