import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { deleteAnnouncement, getAnnouncements, groupErrorCode } from '@/services/groupApi';
import type { GroupAnnouncementResponse } from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';
import { logGroupTabViewed } from '@/services/analyticsEvents';
import { useToast } from '@/store/ToastContext';
import NoticeComposeSheet from './components/NoticeComposeSheet';

// 공지 화면 (root stack 'GroupNotice') — 명세 docs/app/group-plan.md §6-5.
// 베이스는 legacy NoticeTab을 복사해 현행화한 것이다(legacyTheme→T, 직접 api 호출→groupApi,
// 로컬 interface→@/types/dto/group). ❌ @/legacy import 금지(app/.claude/CLAUDE.md).
//
//   진입 → getAnnouncements() → 실패 [에러+재시도] / 빈 배열 [빈 상태] / 목록
//
// · 목록은 서버가 createdAt DESC로 내려주므로 **앱에서 재정렬하지 않는다**.
// · 작성/수정/삭제 진입점은 route.params.canWrite === false면 아예 렌더하지 않는다 —
//   NOTICE_FORBIDDEN(403)은 화면에서 예방하는 게 원칙이다(§3-2).

// 작성 FAB 규격 — 리스트 하단 여백을 여기서 파생시킨다(FAB에 마지막 카드가 가리지 않게).
const FAB_SIZE = 56;
const FAB_BOTTOM = T.space.xl;

type NoticeRoute = RouteProp<V2RootStackParamList, 'GroupNotice'>;

// '7월 29일' 표기(§6-5 시안). 파싱 실패한 값은 조용히 비운다.
function formatNoticeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// 목록 조회 실패 문구 — HTTP status가 아니라 서버 code로 분기한다(§3-2).
function listErrorMessage(e: unknown): string {
  switch (groupErrorCode(e)) {
    case 'NOT_FOUND':
      return '사라진 그룹이에요.';
    case 'MEMBER_ONLY':
      return '그룹원만 공지를 볼 수 있어요.';
    default:
      return '공지를 불러오지 못했어요.';
  }
}

// 삭제 실패 문구 — 모르는 code는 공통 문구로 떨어뜨린다(§5-2).
function deleteErrorMessage(e: unknown): string {
  switch (groupErrorCode(e)) {
    case 'NOT_FOUND':
      return '이미 삭제된 공지예요.';
    case 'NOTICE_FORBIDDEN':
      return '공지를 관리할 권한이 없어요.';
    case 'MEMBER_ONLY':
      return '그룹원만 이용할 수 있어요.';
    default:
      return '공지 삭제에 실패했어요. 잠시 후 다시 시도해주세요.';
  }
}

export default function NoticeScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { groupId, canWrite } = useRoute<NoticeRoute>().params;
  const { show } = useToast();

  const [notices, setNotices] = useState<GroupAnnouncementResponse[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 시트는 작성·수정 공용이다 — editing이 null이면 새 공지, 있으면 그 공지를 고친다.
  const [composeOpen, setComposeOpen] = useState(false);
  const [editing, setEditing] = useState<GroupAnnouncementResponse | null>(null);
  // 등록 성공 직후의 재조회가 끝나기 전인가 — 그 구간에는 빈 상태 안내를 세우지 않는다.
  // (등록은 성공했는데 목록은 아직 []라, 느린 GET 동안 '등록된 공지가 없어요'가 다시 떠서
  //  방금 올린 공지가 사라진 줄 알고 같은 공지를 또 쓰게 된다. 조회 실패 분기는 GET이 끝난
  //  뒤에만 이 자리를 대신하므로 조회 **중**은 여전히 빈 상태였다.)
  const [transitioning, setTransitioning] = useState(false);

  // 요청 시퀀스 — 당겨서 새로고침·작성 직후 재조회·'다시 시도'가 겹치면 늦게 도착한 이전 응답이
  // 최신 목록을 덮을 수 있다. 최신 요청의 결과만 반영한다(useFriends.ts의 requestSeqRef 패턴).
  const requestSeqRef = useRef(0);

  // 반환값: 이 호출이 아직 최신인가(늦게 끝난 요청이 새로고침 표시를 되돌리지 않게).
  const fetchNotices = useCallback(async (): Promise<boolean> => {
    const seq = ++requestSeqRef.current;
    setErrorMsg(null);
    try {
      // 서버 정렬(createdAt DESC)을 그대로 신뢰한다.
      const rows = await getAnnouncements(groupId);
      if (seq !== requestSeqRef.current) return false;
      setNotices(rows);
    } catch (e) {
      if (seq !== requestSeqRef.current) return false;
      setErrorMsg(listErrorMessage(e));
    }
    // 성공이든 실패든 **최신 조회가 끝나면** 전이도 끝난다 — 실패는 아래 에러+다시 시도가
    // 빈 상태 자리를 대신하므로 여기서 더 붙잡을 이유가 없다. 반대로 stale로 끝난 호출에서
    // 풀면(더 새로운 조회가 진행 중) 그 조회가 도착하기 전에 빈 상태가 다시 뜬다.
    setTransitioning(false);
    return true;
  }, [groupId]);

  useEffect(() => {
    logGroupTabViewed({ tab: 'notice' });
  }, []);

  // cleanup에서 시퀀스를 올려 진행 중이던 요청을 무효화한다(언마운트 뒤 setState 방지).
  useEffect(() => {
    fetchNotices();
    return () => {
      // 노드 참조가 아니라 요청 카운터라 cleanup 시점의 값을 그대로 올리는 게 맞다
      // (react-hooks/exhaustive-deps의 ref 경고는 DOM 노드 ref를 겨냥한 것).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestSeqRef.current++;
    };
  }, [fetchNotices]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // stale(false) 여부와 무관하게 내린다 — 당겨서 새로고침 중에 작성·수정·삭제의 재조회가
    // 끼어들면 이 호출은 stale로 끝나는데, 그 후속 조회는 refreshing을 건드리지 않아
    // RefreshControl이 화면을 다시 열 때까지 계속 돈다(GroupRoomScreen:onRefresh와 같은 판단).
    await fetchNotices();
    setRefreshing(false);
  }, [fetchNotices]);

  function openCompose(target: GroupAnnouncementResponse | null) {
    setEditing(target);
    setComposeOpen(true);
  }

  function closeCompose() {
    setComposeOpen(false);
    setEditing(null);
  }

  const onSaved = useCallback(() => {
    setComposeOpen(false);
    setEditing(null);
    // 서버에는 이미 공지가 있다 — 재조회가 끝날 때까지 빈 상태를 세우지 않는다(transitioning 주석).
    setTransitioning(true);
    fetchNotices();
  }, [fetchNotices]);

  // 수정하려던 공지가 이미 없어진 경우(다른 관리자가 먼저 삭제) — 시트를 닫고 목록을 다시 맞춘다.
  // 시트에 문구만 띄우면 이 화면은 포커스 재조회가 없어 사라진 카드가 남고 같은 수정을 반복하게
  // 된다(삭제 404를 재조회로 맞추는 confirmDelete와 같은 규칙).
  const onEditingGone = useCallback(() => {
    setComposeOpen(false);
    setEditing(null);
    fetchNotices();
    // 재시도해도 같은 결과인 종결 통보 — 조치가 없으므로 tone:'error' 토스트로 알린다(정책 D19).
    // 시트(NoticeComposeSheet)는 SheetShell 기본형(asModal=false)이라 배너를 가리지 않지만,
    // 순서는 그대로 **닫은 뒤** 알리는 쪽을 지킨다.
    show({ message: '이미 삭제된 공지라 수정할 수 없어요', tone: 'error' });
  }, [fetchNotices, show]);

  function confirmDelete(notice: GroupAnnouncementResponse) {
    // 확인 Alert 형식은 앱 관행대로 (동작명, 질문) — 대상에 인용부호를 쓰지 않는다.
    Alert.alert('공지 삭제', `${notice.title} 공지를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAnnouncement(groupId, notice.id);
            fetchNotices();
          } catch (e) {
            // NOT_FOUND는 '다른 관리자가 먼저 지웠다'는 뜻이라 결과가 삭제 성공과 같다.
            // 문구만 띄우고 끝내면 이 화면은 포커스 재조회가 없어 사라진 카드가 목록에 그대로
            // 남고, 사용자는 당겨서 새로고침하기 전까지 같은 카드를 계속 열어 지우려 든다.
            // (그룹 자체가 사라진 404여도 재조회가 '사라진 그룹이에요.'로 화면을 맞춰 준다.)
            if (groupErrorCode(e) === 'NOT_FOUND') fetchNotices();
            Alert.alert('삭제 실패', deleteErrorMessage(e));
          }
        },
      },
    ]);
  }

  // 카드 롱프레스 액션 — 수정·삭제(§6-5). canWrite일 때만 붙는다.
  function openCardMenu(notice: GroupAnnouncementResponse) {
    Alert.alert(notice.title, '이 공지를 어떻게 할까요?', [
      { text: '수정', onPress: () => openCompose(notice) },
      { text: '삭제', style: 'destructive', onPress: () => confirmDelete(notice) },
      { text: '취소', style: 'cancel' },
    ]);
  }

  function renderCardBody(notice: GroupAnnouncementResponse) {
    return (
      <>
        <Text style={s.cardTitle} numberOfLines={2}>
          {notice.title}
        </Text>
        <Text style={s.cardContent} numberOfLines={3}>
          {notice.content}
        </Text>
        <Text style={s.cardDate}>{formatNoticeDate(notice.createdAt)}</Text>
      </>
    );
  }

  const header = (
    <View style={s.header}>
      <TouchableOpacity
        style={s.backBtn}
        onPress={() => navigation.goBack()}
        activeOpacity={0.7}
        accessibilityLabel="뒤로"
      >
        <Ionicons name="chevron-back" size={18} color={T.inkSub} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>공지</Text>
    </View>
  );

  // 작성 FAB + 시트는 canWrite일 때만 존재한다(403 예방, §6-5).
  const composeSheet =
    canWrite && composeOpen ? (
      <NoticeComposeSheet
        groupId={groupId}
        editing={editing}
        onClose={closeCompose}
        onSaved={onSaved}
        onEditingGone={onEditingGone}
      />
    ) : null;

  // 에러 + 다시 시도 블록 — 최초 조회 실패(전면)와 '목록이 빈 채로 재조회가 실패한' 경우가 같이 쓴다.
  function errorState(msg: string) {
    return (
      <View style={s.center}>
        <Text style={s.emptyTitle}>{msg}</Text>
        <Text style={s.emptyDesc}>잠시 후 다시 시도해주세요.</Text>
        <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={() => fetchNotices()}>
          <Text style={s.retryText}>다시 시도</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── 최초 로딩 — 중앙 스피너(§5-4). 새로고침은 RefreshControl이 맡는다. ──
  if (notices === null && errorMsg === null) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.notice.screen">
        {header}
        <View style={s.center}>
          <ActivityIndicator color={T.accent} />
        </View>
      </SafeAreaView>
    );
  }

  // ── 에러 + 다시 시도 ──
  if (notices === null && errorMsg !== null) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.notice.screen">
        {header}
        {errorState(errorMsg)}
      </SafeAreaView>
    );
  }

  const list = notices ?? [];

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="group.notice.screen">
      {header}

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          s.listContent,
          { paddingBottom: insets.bottom + FAB_BOTTOM + FAB_SIZE + T.space.xl },
          list.length === 0 && s.listEmptyContent,
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.accent} />
        }
        // 목록이 이미 있는 상태의 재조회 실패는 전면 에러 화면 조건(notices === null)에 걸리지 않아
        // 그대로 무음이 된다 — 공지를 쓰고 재조회가 실패하면 방금 쓴 공지가 목록에 없고 알림도 없어
        // 사용자가 같은 공지를 다시 등록한다. 리스트 상단 인라인 배너로 알린다
        // (GroupFindSheet의 s.notice와 같은 규격 — 시트 안 액션 실패는 인라인이라는 규칙과 동일).
        // 목록이 비어 있을 때는 배너 대신 빈 상태 자리를 에러+재시도가 통째로 대신한다.
        ListHeaderComponent={
          errorMsg !== null && list.length > 0 ? <Text style={s.notice}>{errorMsg}</Text> : null
        }
        // 빈 목록 + 재조회 실패는 '공지가 없다'가 아니라 '모른다'다 — 첫 공지 등록 직후 재조회가
        // 실패한 상황에서 '등록된 공지가 없어요 / 첫 공지를 남겨보세요'를 그대로 두면 방금 올린
        // 공지를 한 번 더 쓰게 된다. 이때는 에러+다시 시도로 바꿔 재조회 쪽으로 유도한다.
        // 재조회가 **아직 도는 중**(transitioning)일 때도 같은 이유로 빈 상태를 세우지 않는다.
        // (FAB은 남긴다 — 목록을 못 읽은 게 곧 쓰지 말라는 뜻은 아니다.)
        ListEmptyComponent={
          errorMsg !== null ? (
            errorState(errorMsg)
          ) : transitioning ? (
            <View style={s.center}>
              <ActivityIndicator color={T.accent} />
            </View>
          ) : (
            <View style={s.center}>
              <Text style={s.emptyTitle}>등록된 공지가 없어요</Text>
              {canWrite && <Text style={s.emptyDesc}>+ 버튼으로 첫 공지를 남겨보세요</Text>}
            </View>
          )
        }
        renderItem={({ item }) =>
          canWrite ? (
            <TouchableOpacity
              style={s.card}
              activeOpacity={0.85}
              onLongPress={() => openCardMenu(item)}
              delayLongPress={300}
            >
              {renderCardBody(item)}
            </TouchableOpacity>
          ) : (
            <View style={s.card}>{renderCardBody(item)}</View>
          )
        }
      />

      {canWrite && (
        <TouchableOpacity
          style={[s.fab, { bottom: insets.bottom + FAB_BOTTOM }]}
          activeOpacity={0.85}
          onPress={() => openCompose(null)}
          accessibilityLabel="공지 쓰기"
          testID="group.notice.compose"
        >
          <Ionicons name="add" size={28} color={T.white} />
        </TouchableOpacity>
      )}

      {composeSheet}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.sm,
    paddingBottom: T.space.md,
  },
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
  headerTitle: { ...T.text.heading, fontWeight: '800', color: T.ink },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: T.space.xxl,
  },
  // 화면 전체를 차지하는 에러/빈 상태 헤드라인은 T.text.title(26/800) — 그룹 3화면 공통 위계.
  emptyTitle: { ...T.text.title, color: T.ink, textAlign: 'center' },
  emptyDesc: {
    ...T.text.body,
    color: T.inkSub,
    marginTop: T.space.sm,
    textAlign: 'center',
  },
  // 인라인 재시도 = 48 / r16 / px xxl — 그룹 탭·그룹방과 같은 값(§G-4)
  retryBtn: {
    minHeight: 48,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.xxl,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
    marginTop: T.space.xl,
  },
  retryText: { ...T.text.label, color: T.white },

  // 재조회 실패 인라인 배너 — GroupFindSheet의 s.notice와 같은 규격
  notice: { ...T.text.caption, color: T.dangerInk },

  listContent: { paddingHorizontal: T.space.xl, paddingTop: T.space.xs, gap: T.space.md },
  listEmptyContent: { flexGrow: 1 },

  card: {
    backgroundColor: T.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.border,
    padding: T.space.lg,
    gap: T.space.xs,
  },
  cardTitle: { ...T.text.subtitle, color: T.ink },
  cardContent: { ...T.text.body, color: T.inkSub },
  cardDate: { ...T.text.caption, color: T.inkMuted, marginTop: T.space.xs },

  fab: {
    position: 'absolute',
    right: T.space.xl,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
    shadowColor: T.shadow,
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});
