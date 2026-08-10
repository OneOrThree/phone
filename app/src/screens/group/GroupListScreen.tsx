import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  findNodeHandle,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { FindMoreCard } from './components/FindMoreCard';
import { PageIndicator } from './components/PageIndicator';
import { GroupCardFront } from './components/GroupCardFront';

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

export interface GroupListScreenProps {
  groups: GroupSummaryResponse[];
  onSelect: (groupId: string) => void;
  onCreate: () => void;
  onFind: () => void;
  onRefresh: () => Promise<void>;
  onBack?: () => void;
}

export default function GroupListScreen({
  groups,
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
  const cardWidth = Math.max(240, windowWidth - SIDE_PEEK * 2);
  const snapInterval = cardWidth + CARD_GAP;
  const pageCount = groups.length + 1;
  const listRef = useRef<FlatList<GroupSummaryResponse>>(null);
  const activeIdentityRef = useRef<string | null>(groups[0]?.groupId ?? null);
  const activeIndexRef = useRef(0);
  const orderKey = groups.map((group) => group.groupId).join('\u0000');
  const previousOrderKeyRef = useRef(orderKey);
  const previousSnapIntervalRef = useRef(snapInterval);
  const pendingFlipGroupIdRef = useRef<string | null>(null);
  const pendingFaceFocusRef = useRef<{ groupId: string; face: 'front' | 'back' } | null>(null);
  const frontActionRefs = useRef(new Map<string, View | null>());
  const backTitleRefs = useRef(new Map<string, Text | null>());

  useEffect(() => {
    const pending = pendingFaceFocusRef.current;
    if (!pending) return;
    const expectedFace = flippedGroupId === pending.groupId ? 'back' : 'front';
    if (pending.face !== expectedFace) return;
    pendingFaceFocusRef.current = null;
    const target =
      pending.face === 'back'
        ? backTitleRefs.current.get(pending.groupId)
        : frontActionRefs.current.get(pending.groupId);
    const node = findNodeHandle(target ?? null);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  }, [flippedGroupId]);

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
      const nextIdentity = groups[next]?.groupId ?? null;
      if (pendingFlipGroupIdRef.current !== nextIdentity) pendingFlipGroupIdRef.current = null;
      if (activeIdentityRef.current !== nextIdentity) setFlippedGroupId(null);
      activeIdentityRef.current = nextIdentity;
      activeIndexRef.current = next;
      setActiveIndex(next);
    },
    [groups, pageCount, snapInterval],
  );

  const settleOffset = useCallback(
    (offsetX: number) => {
      const next = Math.max(0, Math.min(Math.round(offsetX / snapInterval), pageCount - 1));
      const nextIdentity = groups[next]?.groupId ?? null;
      if (activeIdentityRef.current !== nextIdentity) setFlippedGroupId(null);
      activeIdentityRef.current = nextIdentity;
      activeIndexRef.current = next;
      setActiveIndex(next);
      if (pendingFlipGroupIdRef.current === nextIdentity) {
        pendingFlipGroupIdRef.current = null;
        pendingFaceFocusRef.current = { groupId: nextIdentity, face: 'back' };
        setFlippedGroupId(nextIdentity);
      } else {
        pendingFlipGroupIdRef.current = null;
      }
    },
    [groups, pageCount, snapInterval],
  );

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) =>
      settleOffset(event.nativeEvent.contentOffset.x),
    [settleOffset],
  );

  const onScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const target = event.nativeEvent.targetContentOffset?.x;
      // iOS가 알려 준 최종 snap 위치만 확정한다. 임시 contentOffset은 momentum 종료가 맡는다.
      if (typeof target === 'number') settleOffset(target);
    },
    [settleOffset],
  );

  const flipCard = useCallback(
    (groupId: string) => {
      const index = groups.findIndex((group) => group.groupId === groupId);
      if (index < 0) return;
      if (activeIdentityRef.current !== groupId) {
        // peek 카드는 앞면으로 중앙에 정착한 뒤 뒤집는다. animated scroll 중 교체하면
        // 이동하는 카드의 뒷면이 먼저 노출되어 한 동작 안의 순서 계약이 깨진다.
        pendingFlipGroupIdRef.current = groupId;
        listRef.current?.scrollToOffset({ offset: index * snapInterval, animated: true });
        return;
      }
      pendingFlipGroupIdRef.current = null;
      pendingFaceFocusRef.current = { groupId, face: 'back' };
      setFlippedGroupId(groupId);
    },
    [groups, snapInterval],
  );

  // 회전·폭 변경·서버 순서 변경 뒤에도 index가 아니라 stable groupId로 같은 페이지를 찾는다.
  useEffect(() => {
    const orderChanged = previousOrderKeyRef.current !== orderKey;
    const intervalChanged = previousSnapIntervalRef.current !== snapInterval;
    previousOrderKeyRef.current = orderKey;
    previousSnapIntervalRef.current = snapInterval;
    if (!orderChanged && !intervalChanged) return;

    const identity = activeIdentityRef.current;
    const next =
      identity === null ? groups.length : groups.findIndex((g) => g.groupId === identity);
    if (identity !== null && next < 0) {
      pendingFlipGroupIdRef.current = null;
      pendingFaceFocusRef.current = null;
      setFlippedGroupId(null);
    }
    const safeIndex =
      next >= 0 ? next : Math.min(activeIndexRef.current, Math.max(0, groups.length - 1));
    activeIdentityRef.current = groups[safeIndex]?.groupId ?? null;
    activeIndexRef.current = safeIndex;
    setActiveIndex(safeIndex);
    listRef.current?.scrollToOffset({ offset: safeIndex * snapInterval, animated: false });
  }, [groups, orderKey, snapInterval]);

  return (
    <View style={s.root} testID="group.list">
      <ScrollView
        style={s.scroller}
        contentContainerStyle={s.screenContent}
        alwaysBounceVertical
        showsVerticalScrollIndicator={false}
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

        <FlatList
          ref={listRef}
          testID="group.list.items"
          data={groups}
          keyExtractor={(item) => item.groupId}
          horizontal
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
              accessibilityElementsHidden={activeIndex !== groups.length}
              importantForAccessibility={
                activeIndex === groups.length ? 'auto' : 'no-hide-descendants'
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
          renderItem={({ item }) => (
            <View
              style={{ width: cardWidth }}
              accessibilityElementsHidden={item.groupId !== groups[activeIndex]?.groupId}
              importantForAccessibility={
                item.groupId === groups[activeIndex]?.groupId ? 'auto' : 'no-hide-descendants'
              }
              testID={`group.list.card.${item.groupId}`}
            >
              {flippedGroupId === item.groupId ? (
                <View style={s.backPlaceholder} testID={`group.card.back.${item.groupId}`}>
                  <Text
                    ref={(node) => {
                      backTitleRefs.current.set(item.groupId, node);
                    }}
                    style={s.backTitle}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    accessible
                    accessibilityRole="header"
                    accessibilityLabel={`${item.name}, ${activeIndex + 1} / ${pageCount}`}
                  >
                    {item.name}
                  </Text>
                  <Text style={s.backDesc}>방 요약을 확인하고 다음 행동을 선택하세요.</Text>
                  <TouchableOpacity
                    style={s.backPrimary}
                    onPress={() => onSelect(item.groupId)}
                    testID={`group.card.room.${item.groupId}`}
                  >
                    <Text style={s.backPrimaryText}>방 전체 보기</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      pendingFaceFocusRef.current = { groupId: item.groupId, face: 'front' };
                      setFlippedGroupId(null);
                    }}
                    testID={`group.card.frontAction.${item.groupId}`}
                  >
                    <Text style={s.backLink}>앞면으로</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <GroupCardFront
                  group={item}
                  pageIndex={groups.findIndex((group) => group.groupId === item.groupId)}
                  pageCount={pageCount}
                  onFlip={() => flipCard(item.groupId)}
                  actionRef={(node) => {
                    frontActionRefs.current.set(item.groupId, node);
                  }}
                />
              )}
            </View>
          )}
        />

        <PageIndicator
          pageLabels={[...groups.map((group) => group.name), '그룹 찾기']}
          activeIndex={activeIndex}
          onSelectPage={selectPage}
        />
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
