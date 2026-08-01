import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import { useUser } from '@/store/UserContext';
import {
  getAnnouncements,
  getGroupDetail,
  groupErrorCode,
  withdrawGroup,
} from '@/services/groupApi';
import { logGroupInviteShared } from '@/services/analyticsEvents';
import { buildInviteLink } from '@/utils/inviteLink';
import type {
  GroupAnnouncementResponse,
  GroupDetailMemberResponse,
  GroupDetailResponse,
  GroupSummaryResponse,
} from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';
import MemberTile from './components/MemberTile';

// 그룹방 — 명세 docs/app/group-plan.md §6-4.
//
// 형태: 탭 셸 없는 단일 ScrollView. **별도 라우트가 아니라 GroupScreen 안에서 렌더된다**
//      (그룹 1개 전제라 목록 화면이 없다 — §0).
// 레이아웃: 헤더(이름 · 비공개 자물쇠 · n/m · ⋯) → 초대 링크 카드 → 공지(최근 3건 + 모두보기)
//          → 멤버 3열 그리드(MemberTile + '＋ 초대' 타일)
//
// ❌ detail.code · codeExpiresAt은 읽지 않는다 — 코드 개념 폐기(§3-1-5).

// 플로팅 탭바가 가리는 하단 여백(§5-1 — 탭 화면 공통 기준)
const TAB_BAR_SPACE = 74;
// 멤버 그리드 열 수
const COLS = 3;
// 공지 섹션에 노출하는 최근 공지 수(나머지는 '모두보기')
const NOTICE_PREVIEW = 3;

// ISO 시각 → '오늘' / '어제' / 'n일 전' / '7월 29일'. 공지 카드 캡션용(§6-4 목업).
function fmtNoticeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.floor((startOf(new Date()) - startOf(d)) / 86400000);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// 멤버 그리드 한 칸 — 멤버 타일 또는 마지막의 '＋ 초대' 타일.
type GridCell = { kind: 'member'; member: GroupDetailMemberResponse } | { kind: 'invite' };

// 리스트를 n개씩 잘라 행 배열로 만든다(3열 그리드 — flexWrap 대신 행 단위로 그려
// 마지막 행에도 같은 폭이 유지되게 한다).
function chunk<Item>(items: Item[], size: number): Item[][] {
  const rows: Item[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

export interface GroupRoomScreenProps {
  groupId: string;
  // 탭 진입점이 가진 요약(getMyGroups[0]) — 상세 응답 도착 전 헤더를 먼저 그리는 용도(선택).
  summary?: GroupSummaryResponse;
  // 그룹 나가기 성공 시 호출 — 부모(GroupScreen)가 재조회해 빈 상태로 되돌린다.
  onLeft: () => void;
}

export default function GroupRoomScreen({ groupId, summary, onLeft }: GroupRoomScreenProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { userId } = useUser();

  const [detail, setDetail] = useState<GroupDetailResponse | null>(null);
  const [notices, setNotices] = useState<GroupAnnouncementResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // 요청 시퀀스 — 당겨서 새로고침 중 '다시 시도'를 누르거나 연타하면 reload()·onRefresh()가
  // 같은 load()를 각자 부른다. 늦게 도착한 이전 응답이 최신 응답을 덮지 않게 최신 것만 반영한다
  // (useFriends.ts의 requestSeqRef와 같은 패턴). 언마운트 후 setState도 함께 막힌다.
  const requestSeqRef = useRef(0);

  // 상세 + 공지 병렬 조회. 공지는 실패해도 방을 비우지 않는다(빈 목록으로 떨어뜨림) —
  // 방의 뼈대는 상세 응답이다. date는 groupApi가 todayStr()을 붙인다(§3-1-1).
  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setError(false);
    try {
      const [d, list] = await Promise.all([
        getGroupDetail(groupId),
        getAnnouncements(groupId).catch(() => [] as GroupAnnouncementResponse[]),
      ]);
      if (seq !== requestSeqRef.current) return;
      setDetail(d);
      setNotices(list);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      // 이미 그룹이 사라졌거나 내가 멤버가 아니면 방을 잡고 있을 이유가 없다 —
      // 부모가 재조회해 빈 상태로 되돌린다(§3-2).
      const code = groupErrorCode(e);
      if (code === 'MEMBER_ONLY' || code === 'NOT_FOUND') {
        onLeft();
        return;
      }
      setError(true);
    }
  }, [groupId, onLeft]);

  // 최초 진입·재시도 — 스피너를 세우고 조회한다(당겨서 새로고침은 RefreshControl이 표시).
  const reload = useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // 포커스마다 재조회 — 공지를 쓰고(GroupNotice는 루트 스택 push라 이 화면이 언마운트되지 않는다)
  // 돌아왔을 때 공지 카드·멤버별 오늘 집중분이 옛 데이터로 남는 문제를 닫는다.
  // 마운트 1회 useEffect였을 땐 당겨서 새로고침 말고는 반영 경로가 없었다.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  // 내 권한 판정 — 상세 응답에 내 role이 없어 멤버 목록에서 직접 계산한다(§6-4).
  const me = userId ? detail?.members.find((m) => m.userId === userId) : undefined;
  const canWriteNotice =
    me?.role === 'OWNER' || (!!userId && !!detail?.noticeGrantedUserIds.includes(userId));

  const name = detail?.name ?? summary?.name ?? '내 그룹';
  const memberCount = detail?.members.length ?? summary?.currentMembers ?? 0;
  const maxMembers = detail?.maxMembers ?? summary?.maxMembers ?? 0;
  const isPrivate = detail?.isPrivate ?? summary?.isPrivate ?? false;
  const isFull = maxMembers > 0 && memberCount >= maxMembers;

  // 초대 — 외부로 나가는 링크는 항상 https 웹 링크다(§5-5).
  const onInvite = useCallback(async () => {
    try {
      const result = await Share.share({
        message: `gromo 그룹 "${name}"에 초대합니다\n${buildInviteLink(groupId)}`,
      });
      // 취소(dismissedAction)까지 공유로 집계하지 않는다.
      if (result.action === Share.sharedAction) logGroupInviteShared();
    } catch {
      // 공유 시트를 못 띄운 경우 — 사용자에게 알릴 것이 없어 조용히 무시한다.
    }
  }, [groupId, name]);

  const openNotice = useCallback(() => {
    navigation.navigate('GroupNotice', { groupId, canWrite: canWriteNotice });
  }, [navigation, groupId, canWriteNotice]);

  const doLeave = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await withdrawGroup(groupId);
      onLeft();
    } catch (e) {
      switch (groupErrorCode(e)) {
        case 'HOST_WITHDRAW':
          // 방장 위임 UI가 없으므로 안내로 끝낸다(알려진 제약 §14).
          Alert.alert(
            '방장은 나갈 수 없어요',
            '그룹을 이어갈 사람에게 방장을 넘겨야 해요.\n방장 넘기기는 준비 중이에요.',
          );
          break;
        case 'NOT_FOUND':
        case 'MEMBER_ONLY':
          // 이미 빠져 있는 상태 — 성공과 같게 취급한다.
          onLeft();
          break;
        default:
          Alert.alert('그룹 나가기 실패', '잠시 후 다시 시도해주세요.');
      }
    } finally {
      setLeaving(false);
    }
  }, [groupId, leaving, onLeft]);

  const confirmLeave = useCallback(() => {
    setMenuOpen(false);
    Alert.alert('그룹 나가기', `'${name}'에서 나갈까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '나가기', style: 'destructive', onPress: () => doLeave() },
    ]);
  }, [name, doLeave]);

  // ── 최초 로딩 — 중앙 스피너(§5-4) ──
  if (loading && !detail) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={T.accent} />
      </View>
    );
  }

  // ── 에러 + 다시 시도 ──
  if (error && !detail) {
    return (
      <View style={s.center}>
        <Text style={s.errorTitle}>그룹을 불러오지 못했어요</Text>
        <Text style={s.errorDesc}>잠시 후 다시 시도해주세요.</Text>
        <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={reload}>
          <Text style={s.retryText}>다시 시도</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 멤버 순서는 서버가 준 그대로 둔다(앱에서 재정렬하지 않음).
  // '＋ 초대' 타일까지 한 흐름으로 배치하려고 셀 배열로 만든 뒤 3개씩 잘라 행으로 그린다.
  const members = detail?.members ?? [];
  const cells: GridCell[] = [
    ...members.map((m): GridCell => ({ kind: 'member', member: m })),
    { kind: 'invite' },
  ];
  const memberRows = chunk(cells, COLS);

  return (
    <>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + TAB_BAR_SPACE + T.space.md },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.accent} />
        }
      >
        {/* ── 헤더 ── */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.title} numberOfLines={1}>
              {name}
            </Text>
            {isPrivate && <Ionicons name="lock-closed" size={15} color={T.inkSub} />}
            <Text style={s.count}>
              {memberCount}/{maxMembers}
            </Text>
          </View>
          <TouchableOpacity
            style={s.moreBtn}
            activeOpacity={0.7}
            onPress={() => setMenuOpen(true)}
            accessibilityLabel="그룹 메뉴"
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={T.ink} />
          </TouchableOpacity>
        </View>

        {/* ── 초대 링크 카드 — 비공개방에선 유일한 입구라 상단에 고정한다(§6-4) ── */}
        <TouchableOpacity
          style={[s.inviteCard, isFull && s.inviteCardOff]}
          activeOpacity={0.85}
          disabled={isFull}
          onPress={() => onInvite()}
        >
          <View style={s.inviteIcon}>
            <Ionicons name="link" size={16} color={isFull ? T.inkMuted : T.accent} />
          </View>
          <View style={s.inviteTexts}>
            <Text style={[s.inviteTitle, isFull && s.inviteTitleOff]}>초대 링크로 친구 부르기</Text>
            <Text style={s.inviteCaption}>
              {isFull
                ? '정원이 가득 찼어요'
                : isPrivate
                  ? '비공개 그룹이라 링크로만 들어올 수 있어요'
                  : '링크를 받은 친구는 바로 참여할 수 있어요'}
            </Text>
          </View>
          {!isFull && <Ionicons name="share-outline" size={18} color={T.inkSub} />}
        </TouchableOpacity>

        {/* ── 공지 ── */}
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>📌 공지</Text>
          {notices.length > 0 && (
            <TouchableOpacity activeOpacity={0.7} onPress={openNotice}>
              <Text style={s.moreLink}>모두보기</Text>
            </TouchableOpacity>
          )}
        </View>

        {notices.length === 0 ? (
          <View style={s.emptyNotice}>
            <Text style={s.emptyNoticeText}>아직 공지가 없어요</Text>
            {canWriteNotice && (
              <TouchableOpacity style={s.writeBtn} activeOpacity={0.85} onPress={openNotice}>
                <Text style={s.writeText}>공지 쓰기</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={s.noticeList}>
            {notices.slice(0, NOTICE_PREVIEW).map((n) => (
              <TouchableOpacity
                key={n.id}
                style={s.noticeCard}
                activeOpacity={0.85}
                onPress={openNotice}
              >
                <Text style={s.noticeTitle} numberOfLines={1}>
                  {n.title}
                </Text>
                <Text style={s.noticeDate}>{fmtNoticeDate(n.createdAt)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── 멤버 ── */}
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>멤버</Text>
        </View>
        <View style={s.grid}>
          {memberRows.map((row, rowIdx) => (
            <View key={`row-${rowIdx}`} style={s.gridRow}>
              {row.map((cell) =>
                cell.kind === 'invite' ? (
                  <TouchableOpacity
                    key="invite"
                    style={[s.inviteTile, isFull && s.inviteTileOff]}
                    activeOpacity={0.85}
                    disabled={isFull}
                    onPress={() => onInvite()}
                  >
                    <Ionicons name="add" size={22} color={isFull ? T.inkMuted : T.accent} />
                    <Text style={[s.inviteTileText, isFull && s.inviteTileTextOff]}>
                      {isFull ? '정원 가득' : '초대'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <MemberTile
                    key={cell.member.userId}
                    nickname={cell.member.nickname}
                    focusTimeMinutes={cell.member.focusTimeMinutes}
                    isOwner={cell.member.role === 'OWNER'}
                  />
                ),
              )}
              {/* 마지막 행 빈 칸 — 남는 칸을 채워 타일 폭을 고정한다 */}
              {Array.from({ length: COLS - row.length }).map((_, i) => (
                <View key={`pad-${i}`} style={s.gridPad} />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ── '⋯' 액션시트 ── */}
      {menuOpen && (
        <SheetShell onClose={() => setMenuOpen(false)} asModal>
          <Text style={s.menuTitle}>{name}</Text>
          <TouchableOpacity style={s.menuItem} activeOpacity={0.7} onPress={confirmLeave}>
            <Ionicons name="exit-outline" size={18} color={T.accentAlt} />
            <Text style={s.menuDanger}>그룹 나가기</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.menuItem}
            activeOpacity={0.7}
            onPress={() => setMenuOpen(false)}
          >
            <Text style={s.menuText}>닫기</Text>
          </TouchableOpacity>
        </SheetShell>
      )}
    </>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: T.space.lg, gap: T.space.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: T.space.xxl },
  errorTitle: { ...T.text.subtitle, color: T.ink, textAlign: 'center' },
  errorDesc: { ...T.text.body, color: T.inkSub, marginTop: T.space.xs, textAlign: 'center' },
  retryBtn: {
    marginTop: T.space.lg,
    height: 44,
    paddingHorizontal: T.space.xxl,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  retryText: { ...T.text.label, color: T.white },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  title: { ...T.text.heading, color: T.ink, flexShrink: 1 },
  count: { ...T.text.caption, color: T.inkSub },
  moreBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
  },

  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
    padding: T.space.lg,
  },
  inviteCardOff: { backgroundColor: T.paperAlt, borderColor: T.paperAlt },
  inviteIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accentBg,
  },
  inviteTexts: { flex: 1, gap: 2 },
  inviteTitle: { ...T.text.label, color: T.ink },
  inviteTitleOff: { color: T.inkMuted },
  inviteCaption: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: T.space.xs,
  },
  sectionTitle: { ...T.text.label, color: T.ink },
  moreLink: { ...T.text.caption, color: T.link },

  noticeList: { gap: T.space.sm },
  noticeCard: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    gap: 2,
  },
  noticeTitle: { ...T.text.label, color: T.ink },
  noticeDate: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  emptyNotice: {
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingVertical: T.space.xl,
    paddingHorizontal: T.space.lg,
  },
  emptyNoticeText: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  writeBtn: {
    height: 40,
    paddingHorizontal: T.space.xl,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  writeText: { ...T.text.label, color: T.white },

  grid: { gap: T.space.md },
  gridRow: { flexDirection: 'row', gap: T.space.md },
  gridPad: { flex: 1 },
  inviteTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.xs,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: T.borderDark,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.sm,
  },
  inviteTileOff: { borderColor: T.border, backgroundColor: T.paperAlt },
  inviteTileText: { ...T.text.caption, color: T.accent },
  inviteTileTextOff: { color: T.inkMuted },

  menuTitle: { ...T.text.label, color: T.inkMuted, marginBottom: T.space.sm },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    height: 52,
  },
  menuDanger: { ...T.text.subtitle, color: T.accentAlt },
  menuText: { ...T.text.subtitle, color: T.ink },
});
