import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
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
import { todayStr } from '@/utils/localDate';
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
  // 초대 시트가 이 화면 위에 떠 있는가 — 떠 있으면 '⋯' 메뉴를 내린다(아래 이펙트 주석 참고).
  inviteOpen?: boolean;
}

export default function GroupRoomScreen({
  groupId,
  summary,
  onLeft,
  inviteOpen,
}: GroupRoomScreenProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { userId } = useUser();

  const [detail, setDetail] = useState<GroupDetailResponse | null>(null);
  // null = 아직 한 번도 못 받음. '공지 없음(빈 배열)'과 '공지 조회 실패'를 구분한다 —
  // 실패를 []로 뭉개면 이미 있는 공지가 사라진 자리에 '아직 공지가 없어요'가 떠서 같은 공지를 또 쓴다.
  const [notices, setNotices] = useState<GroupAnnouncementResponse[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [noticeError, setNoticeError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // 요청 시퀀스 — 당겨서 새로고침 중 '다시 시도'를 누르거나 연타하면 reload()·onRefresh()가
  // 같은 load()를 각자 부른다. 늦게 도착한 이전 응답이 최신 응답을 덮지 않게 최신 것만 반영한다
  // (useFriends.ts의 requestSeqRef와 같은 패턴). 포커스 cleanup·언마운트에서도 올려 무효화한다.
  const requestSeqRef = useRef(0);
  // 화면이 포커스돼 있는가 — 포그라운드 복귀 시 재조회 여부 판정에 쓴다(탭 화면은 언마운트되지 않는다).
  const focusedRef = useRef(false);
  // 마지막으로 성공한 조회의 기준 날짜. 자정을 넘겨 복귀하면 '오늘 집중분'이 전날 값이라 강제 재조회한다.
  const loadedDateRef = useRef<string | null>(null);

  // 상세 + 공지 병렬 조회. 두 요청의 실패를 **각각** 다룬다(allSettled) —
  // 상세 실패는 기존 방 데이터를 보존한 채 배너로, 공지 실패는 공지 섹션에서만 알린다.
  // date는 멤버 '오늘 집중분'의 기준일이라 여기서 직접 만들어 보관까지 한다(§3-1-1).
  // 반환값: 이 호출이 아직 최신인가(늦게 끝난 요청이 로딩 플래그를 되돌리지 않게).
  const load = useCallback(async (): Promise<boolean> => {
    const seq = ++requestSeqRef.current;
    const date = todayStr();
    setError(false);
    const [detailResult, noticeResult] = await Promise.allSettled([
      getGroupDetail(groupId, date),
      getAnnouncements(groupId),
    ]);
    if (seq !== requestSeqRef.current) return false;

    if (detailResult.status === 'fulfilled') {
      setDetail(detailResult.value);
      loadedDateRef.current = date;
    } else {
      // 이미 그룹이 사라졌거나 내가 멤버가 아니면 방을 잡고 있을 이유가 없다 —
      // 부모가 빈 상태로 되돌린다(§3-2).
      const code = groupErrorCode(detailResult.reason);
      if (code === 'MEMBER_ONLY' || code === 'NOT_FOUND') {
        // 부모가 이 화면을 내린다 — 로딩 플래그를 되돌릴 대상이 없으므로 최신 아님으로 반환한다.
        onLeft();
        return false;
      }
      setError(true);
    }

    if (noticeResult.status === 'fulfilled') {
      setNotices(noticeResult.value);
      setNoticeError(false);
    } else {
      setNoticeError(true); // 기존 공지는 그대로 둔다
    }
    return true;
  }, [groupId, onLeft]);

  // 최초 진입·재시도 — 스피너를 세우고 조회한다(당겨서 새로고침은 RefreshControl이 표시).
  const reload = useCallback(() => {
    setLoading(true);
    load().then((fresh) => {
      if (fresh) setLoading(false);
    });
  }, [load]);

  // 포커스마다 재조회 — 공지를 쓰고(GroupNotice는 루트 스택 push라 이 화면이 언마운트되지 않는다)
  // 돌아왔을 때 공지 카드·멤버별 오늘 집중분이 옛 데이터로 남는 문제를 닫는다.
  // 마운트 1회 useEffect였을 땐 당겨서 새로고침 말고는 반영 경로가 없었다.
  // cleanup에서 시퀀스를 올려 진행 중이던 요청을 무효화한다(화면을 떠난 뒤 setState·onLeft 방지).
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      reload();
      return () => {
        focusedRef.current = false;
        requestSeqRef.current++;
      };
    }, [reload]),
  );

  // 포그라운드 복귀 — 포커스는 유지된 채라 useFocusEffect가 다시 돌지 않는다.
  // 화면이 떠 있으면 재조회하고, 자정을 넘겼으면 포커스 여부와 무관하게 새 date로 다시 부른다.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (focusedRef.current || loadedDateRef.current !== todayStr()) reload();
    });
    return () => sub.remove();
  }, [reload]);

  // 초대 링크가 도착하면 '⋯' 메뉴를 내린다 — 초대 시트와 이 메뉴는 둘 다 SheetShell asModal(RN
  // 네이티브 Modal)이라 동시에 뜨면 딤이 2겹으로 포개진다. GroupScreen이 링크 수신 시 찾기 시트를
  // 내리는 것과 같은 배타 처리이고, 링크로 들어온 초대가 우선이라 이쪽 메뉴를 접는다.
  useEffect(() => {
    if (inviteOpen) setMenuOpen(false);
  }, [inviteOpen]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // fresh 여부와 무관하게 내린다 — 당겨서 새로고침 중에 탭 포커스 복귀·포그라운드 복귀의
    // reload()가 끼어들면 이 호출은 stale(fresh=false)로 끝나는데, 최신 reload()는 loading만
    // 해제하므로 fresh일 때만 내리면 RefreshControl이 영원히 돈다.
    // stale로 끝났다는 건 더 새로운 조회가 진행 중이라는 뜻이라, 표시는 그쪽 스피너가 맡는다.
    load().then(() => setRefreshing(false));
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
      // 취소(dismissedAction)까지 공유로 집계하지 않는다 — 단 그 구분은 iOS에서만 가능하다.
      // 안드로이드는 시트를 그냥 닫아도 sharedAction으로 끝나 완료를 확인할 수 없어
      // confirmed:false(공유 시도)로 남긴다(analyticsEvents.logGroupInviteShared 주석).
      if (result.action === Share.sharedAction) {
        logGroupInviteShared({ share_method: 'share_sheet', confirmed: Platform.OS === 'ios' });
      }
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
    // 확인 Alert 형식은 앱 관행대로 (동작명, 질문) — 대상에 인용부호를 쓰지 않는다.
    Alert.alert('그룹 나가기', `${name}에서 나갈까요?`, [
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
  const noticeList = notices ?? [];
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
        testID="group.room.scroll"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.accent} />
        }
      >
        {/* ── 재조회 실패 배너 — 기존 데이터를 지우지 않고 '지금 보는 값이 옛것'임을 알린다 ── */}
        {error && !!detail && (
          <View style={s.banner}>
            <Text style={s.bannerText}>최신 정보를 불러오지 못했어요</Text>
            <TouchableOpacity onPress={reload} hitSlop={12} activeOpacity={0.7}>
              <Text style={s.bannerRetry}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        )}

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
          <Text style={s.sectionTitle}>공지</Text>
          {noticeList.length > 0 && (
            <TouchableOpacity
              style={s.moreRow}
              activeOpacity={0.7}
              onPress={openNotice}
              hitSlop={12}
            >
              <Text style={s.moreLink}>모두보기</Text>
              <Ionicons name="chevron-forward" size={11} color={T.accent} />
            </TouchableOpacity>
          )}
        </View>

        {/* 공지를 한 번도 못 받은 채 실패 — '없음'과 구분해서 알린다. 이 상태에선 작성 진입을 막는다
            (서버엔 이미 공지가 있는데 없다고 보고 같은 공지를 또 쓰는 것을 예방). */}
        {notices === null && noticeError ? (
          <View style={s.emptyNotice}>
            <Text style={s.emptyNoticeText}>공지를 불러오지 못했어요</Text>
            <TouchableOpacity style={s.writeBtn} activeOpacity={0.85} onPress={reload}>
              <Text style={s.writeText}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        ) : noticeList.length === 0 ? (
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
            {/* 목록은 있는데 갱신만 실패 — 기존 공지를 그대로 두고 한 줄로 알린다. */}
            {noticeError && <Text style={s.bannerText}>공지를 새로고침하지 못했어요</Text>}
            {noticeList.slice(0, NOTICE_PREVIEW).map((n) => (
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
      {/* '닫기' 행은 두지 않는다 — 앱의 SheetShell 시트 4종 모두 딤 탭으로만 닫고,
          아이콘 없는 행이라 위 행과 글자 시작선도 어긋났다. */}
      {/* inviteOpen까지 함께 보는 이유: 위 이펙트는 렌더 뒤에 돌아 한 프레임 동안 두 Modal이 겹친다. */}
      {menuOpen && !inviteOpen && (
        <SheetShell onClose={() => setMenuOpen(false)} asModal>
          <Text style={s.menuTitle}>{name}</Text>
          <TouchableOpacity style={s.menuItem} activeOpacity={0.7} onPress={confirmLeave}>
            <Ionicons name="exit-outline" size={18} color={T.accentAlt} />
            <Text style={s.menuDanger}>그룹 나가기</Text>
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
  // 화면 전체를 차지하는 에러/빈 상태 헤드라인은 T.text.title(26/800) — 그룹 탭·리그와 같은 위계.
  // 카드 안 빈 상태(emptyNoticeText)는 caption을 유지한다.
  errorTitle: { ...T.text.title, color: T.ink, textAlign: 'center' },
  errorDesc: { ...T.text.body, color: T.inkSub, marginTop: T.space.xs, textAlign: 'center' },
  // 인라인 재시도 = 48 / r16 / px xxl — 그룹 탭·공지 화면과 같은 값(§G-4)
  retryBtn: {
    marginTop: T.space.lg,
    height: 48,
    paddingHorizontal: T.space.xxl,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  retryText: { ...T.text.label, color: T.white },

  // 재조회 실패 인라인 배너 — 문구는 그룹 화면 공통 s.notice 규격(caption/dangerInk),
  // 재시도 링크는 '모두보기'와 같은 accent 링크 규격(§G-4).
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bannerText: { ...T.text.caption, color: T.dangerInk },
  bannerRetry: { ...T.text.caption, color: T.accent },

  // 헤더 블록만 좌우 20(T.space.xl) — 홈·리그·전체 탭의 화면 제목과 시작선을 맞춘다.
  // content는 16(T.space.lg)이라 차이 4pt를 여기서 더한다(리그도 헤더 xl / 리스트 lg).
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.space.xs,
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  title: { ...T.text.title, color: T.ink, flexShrink: 1 },
  count: { ...T.text.caption, color: T.inkSub, fontVariant: ['tabular-nums'] },
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

  // 카드 표면은 T.paperAlt — 화면 배경이 흰 캔버스(T.paperLight)로 바뀌어 T.white 카드는 묻힌다.
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.paperAlt,
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
  // '모두보기' — 홈의 '자세히' 링크와 같은 규격(label + chevron 11). 터치 타깃은 hitSlop 12로 보강.
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  moreLink: { ...T.text.label, color: T.accent },

  noticeList: { gap: T.space.sm },
  noticeCard: {
    backgroundColor: T.paperAlt,
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
    backgroundColor: T.paperAlt,
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
