import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import type { GroupSummaryResponse } from '@/types/dto/group';

// 그룹 목록 — 명세 docs/app/group-plan-2.md §3-1.
//
// 형태: 헤더 + 카드 FlatList + 하단 고정 CTA 2개(만들기·찾기). 카드는 그룹방 헤더와 같은 정보를
//      한 줄로 압축한다 — 이름 · 비공개 자물쇠 · 내가 방장이면 배지 · n/m 인원.
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
  const [refreshing, setRefreshing] = useState(false);

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
        testID="group.list.items"
        data={groups}
        keyExtractor={(item) => item.groupId}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={T.accent} />
        }
        renderItem={({ item }) => {
          // 소개(F6) — 비었으면(null·미포함·공백뿐) 줄을 아예 그리지 않아 카드 높이가 흔들리지 않는다.
          const desc = item.description?.trim();
          return (
            <TouchableOpacity
              style={s.card}
              activeOpacity={0.85}
              onPress={() => onSelect(item.groupId)}
              testID={`group.list.card.${item.groupId}`}
            >
              <View style={s.cardBody}>
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
                  {/* 방장 표시 — 멤버 타일과 같은 왕관(자물쇠 아이콘은 그대로 둔다) */}
                  {item.role === 'OWNER' && (
                    <MaterialCommunityIcons
                      name="crown"
                      size={16}
                      color={T.accent}
                      accessibilityLabel="내가 방장"
                    />
                  )}
                </View>
                {desc ? (
                  <Text
                    style={s.cardDesc}
                    numberOfLines={2}
                    testID={`group.list.card.${item.groupId}.desc`}
                  >
                    {desc}
                  </Text>
                ) : null}
              </View>
              <Text style={s.cardCount}>
                {item.currentMembers}/{item.maxMembers}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={T.inkMuted} />
            </TouchableOpacity>
          );
        }}
      />

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

  listContent: { paddingHorizontal: T.space.xl, paddingBottom: T.space.md, gap: T.space.md },

  // 카드 표면은 T.paperAlt — 그룹 탭 배경이 흰 캔버스(T.paperLight)라 T.white 카드는 묻힌다
  // (그룹방의 초대·공지 카드와 같은 기준).
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.lg,
  },
  // 카드 좌측 본문 — 제목 줄 위, 소개 줄(있을 때) 아래를 세로로 쌓는다.
  cardBody: { flex: 1, gap: 2, minWidth: 0 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  cardName: { ...T.text.subtitle, color: T.ink, flexShrink: 1 },
  // 소개 — 이름(subtitle/ink)보다 한 단계 약한 caption/inkSub. 1~2줄 말줄임.
  cardDesc: { ...T.text.caption, color: T.inkSub },
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
