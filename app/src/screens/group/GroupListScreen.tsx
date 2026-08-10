import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
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
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { enterUp } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { FindMoreCard } from './components/FindMoreCard';
import { PageIndicator } from './components/PageIndicator';

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

/**
 * 카드 한 장의 최소 높이 — 로딩 스켈레톤(GroupScreen)이 같은 실루엣을 그리도록 공유하는 상수.
 * 내역: paddingVertical 16×2 + borderWidth 1×2 + 이름 한 줄(T.text.subtitle 19pt ≈ 23) = 58.
 * 아래 s.card의 minHeight로도 걸어 둔다 — 스켈레톤과 실제 카드가 **같은 값에 묶여 있어야**
 * 카드 규격이 바뀔 때 자리표시자만 옛 치수로 남는 일이 없다. 소개(description)가 있는 카드는
 * 이보다 커지므로, 데이터 도착 시 어긋남은 '아래로 늘어나는' 방향뿐이다(위로 줄어드는 점프 없음).
 */
export const GROUP_CARD_HEIGHT = 58;

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
  onSelect: (groupId: string) => void;
  onCreate: () => void;
  onFind: () => void;
  onRefresh: () => Promise<void>;
  onBack?: () => void;
  // 단계별 개발 중인 덱은 명시적으로 켠 테스트/통합 화면에서만 노출한다.
  enableCardDeck?: boolean;
}

export default function GroupListScreen({
  groups,
  onSelect,
  onCreate,
  onFind,
  onRefresh,
  onBack,
  enableCardDeck = false,
}: GroupListScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [refreshing, setRefreshing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(groups[0]?.groupId ?? null);
  const cardWidth = Math.max(240, windowWidth - SIDE_PEEK * 2);
  const snapInterval = cardWidth + CARD_GAP;
  const pageCount = groups.length + 1;
  const groupFingerprint = groups.map((group) => group.groupId).join('|');
  const listRef = useRef<FlatList<GroupSummaryResponse>>(null);
  const activeIdentityRef = useRef<string | null>(groups[0]?.groupId ?? null);
  const activeIndexRef = useRef(0);
  const previousGroupFingerprintRef = useRef(groupFingerprint);
  const previousSnapIntervalRef = useRef(snapInterval);
  const previousEnableCardDeckRef = useRef(enableCardDeck);
  const stableActiveIndex =
    activeGroupId === null ? groups.length : groups.findIndex((g) => g.groupId === activeGroupId);
  const renderedActiveIndex =
    stableActiveIndex >= 0
      ? stableActiveIndex
      : Math.min(activeIndex, Math.max(0, groups.length - 1));

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
      listRef.current?.scrollToOffset({ offset: next * snapInterval, animated: true });
      activeIdentityRef.current = groups[next]?.groupId ?? null;
      setActiveGroupId(groups[next]?.groupId ?? null);
      activeIndexRef.current = next;
      setActiveIndex(next);
    },
    [groups, pageCount, snapInterval],
  );

  const settlePage = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.max(
        0,
        Math.min(Math.round(event.nativeEvent.contentOffset.x / snapInterval), pageCount - 1),
      );
      activeIdentityRef.current = groups[next]?.groupId ?? null;
      setActiveGroupId(groups[next]?.groupId ?? null);
      activeIndexRef.current = next;
      setActiveIndex(next);
    },
    [groups, pageCount, snapInterval],
  );

  // 회전·폭 변경·서버 순서 변경 뒤에도 index가 아니라 stable groupId로 같은 페이지를 찾는다.
  useEffect(() => {
    const reactivated = enableCardDeck && !previousEnableCardDeckRef.current;
    previousEnableCardDeckRef.current = enableCardDeck;
    if (!enableCardDeck) return;
    const orderChanged = previousGroupFingerprintRef.current !== groupFingerprint;
    const intervalChanged = previousSnapIntervalRef.current !== snapInterval;
    previousGroupFingerprintRef.current = groupFingerprint;
    previousSnapIntervalRef.current = snapInterval;
    if (!orderChanged && !intervalChanged && !reactivated) return;

    const identity = activeIdentityRef.current;
    const next =
      identity === null ? groups.length : groups.findIndex((g) => g.groupId === identity);
    const safeIndex =
      next >= 0 ? next : Math.min(activeIndexRef.current, Math.max(0, groups.length - 1));
    activeIdentityRef.current = groups[safeIndex]?.groupId ?? null;
    setActiveGroupId(groups[safeIndex]?.groupId ?? null);
    activeIndexRef.current = safeIndex;
    setActiveIndex(safeIndex);
    listRef.current?.scrollToOffset({ offset: safeIndex * snapInterval, animated: false });
  }, [enableCardDeck, groupFingerprint, groups, snapInterval]);

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={T.accent} />
  );
  const groupList = (
    <FlatList
      ref={listRef}
      testID="group.list.items"
      data={groups}
      keyExtractor={(item) => item.groupId}
      horizontal={enableCardDeck}
      showsHorizontalScrollIndicator={false}
      CellRendererComponent={GroupListCell}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={
        enableCardDeck ? [s.listContent, { paddingHorizontal: SIDE_PEEK }] : s.legacyListContent
      }
      ItemSeparatorComponent={
        enableCardDeck ? () => <View style={{ width: CARD_GAP }} /> : undefined
      }
      snapToInterval={enableCardDeck ? snapInterval : undefined}
      snapToAlignment={enableCardDeck ? 'start' : undefined}
      decelerationRate={enableCardDeck ? 'fast' : 'normal'}
      disableIntervalMomentum={enableCardDeck}
      onMomentumScrollEnd={enableCardDeck ? settlePage : undefined}
      onScrollEndDrag={enableCardDeck ? settlePage : undefined}
      ListFooterComponent={
        enableCardDeck ? (
          <View
            style={{ marginLeft: CARD_GAP }}
            pointerEvents={renderedActiveIndex === groups.length ? 'auto' : 'none'}
            accessibilityElementsHidden={renderedActiveIndex !== groups.length}
            importantForAccessibility={
              renderedActiveIndex === groups.length ? 'auto' : 'no-hide-descendants'
            }
            testID="group.deck.findMorePage"
          >
            <FindMoreCard
              width={cardWidth}
              position={pageCount}
              pageCount={pageCount}
              onPress={onFind}
              focusable={renderedActiveIndex === groups.length}
            />
          </View>
        ) : null
      }
      refreshControl={enableCardDeck ? undefined : refreshControl}
      renderItem={({ item, index }) => {
        const active = !enableCardDeck || index === renderedActiveIndex;
        return (
          <View
            pointerEvents={active ? 'auto' : 'none'}
            accessibilityElementsHidden={!active}
            importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
            testID={`group.list.cardPage.${item.groupId}`}
          >
            <TouchableOpacity
              style={[s.card, enableCardDeck ? [s.deckCard, { width: cardWidth }] : s.legacyCard]}
              activeOpacity={0.85}
              onPress={() => onSelect(item.groupId)}
              focusable={active}
              accessibilityRole="button"
              accessibilityLabel={
                enableCardDeck
                  ? `${item.name}${item.description ? `, ${item.description}` : ''}, ${item.isPrivate ? '비밀방' : '공개방'}, ${item.role === 'OWNER' ? '방장' : '멤버'}, ${item.currentMembers}/${item.maxMembers}명, 현재 ${index + 1}/${pageCount} 페이지`
                  : undefined
              }
              testID={`group.list.card.${item.groupId}`}
            >
              <View style={s.cardMain}>
                <View style={s.cardTitleRow}>
                  <Text style={s.cardName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.isPrivate && (
                    <Ionicons
                      name="lock-closed"
                      size={14}
                      color={T.inkSub}
                      accessibilityLabel="비공개 그룹"
                    />
                  )}
                  {item.role === 'OWNER' && (
                    <MaterialCommunityIcons
                      name="crown"
                      size={16}
                      color={T.accent}
                      accessibilityLabel="내가 방장"
                    />
                  )}
                </View>
                {!!item.description && (
                  <Text style={s.cardDesc} numberOfLines={2}>
                    {item.description}
                  </Text>
                )}
              </View>
              <View style={s.cardRight}>
                <Text style={s.cardCount}>
                  {item.currentMembers}/{item.maxMembers}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={T.inkMuted} />
              </View>
            </TouchableOpacity>
          </View>
        );
      }}
    />
  );

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

      {enableCardDeck ? (
        <ScrollView
          style={s.deckRefreshHost}
          contentContainerStyle={s.deckRefreshContent}
          refreshControl={refreshControl}
          testID="group.deck.refresh"
        >
          {groupList}
          <PageIndicator
            pageLabels={[...groups.map((group) => group.name), '그룹 찾기']}
            activeIndex={renderedActiveIndex}
            onSelectPage={selectPage}
          />
        </ScrollView>
      ) : (
        groupList
      )}

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
  deckRefreshHost: { flex: 1 },
  deckRefreshContent: { flexGrow: 1 },
  legacyListContent: {
    paddingHorizontal: T.space.xl,
    paddingBottom: T.space.md,
    gap: T.space.md,
  },

  // 카드 표면은 T.paperAlt — 그룹 탭 배경이 흰 캔버스(T.paperLight)라 T.white 카드는 묻힌다
  // (그룹방의 초대·공지 카드와 같은 기준).
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    // 로딩 스켈레톤과 같은 실루엣을 보장하는 하한 (위 GROUP_CARD_HEIGHT 주석 참고)
    minHeight: GROUP_CARD_HEIGHT,
    gap: T.space.md,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.lg,
  },
  legacyCard: { minHeight: 58 },
  deckCard: { minHeight: 220 },
  cardMain: { flex: 1, gap: 4, minWidth: 0 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  cardName: { ...T.text.subtitle, color: T.ink, flexShrink: 1 },
  cardDesc: { ...T.text.caption, color: T.inkSub },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  cardCount: { ...T.text.caption, color: T.inkSub, fontVariant: ['tabular-nums'] },

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
