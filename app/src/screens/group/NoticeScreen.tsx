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

  const [notices, setNotices] = useState<GroupAnnouncementResponse[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 시트는 작성·수정 공용이다 — editing이 null이면 새 공지, 있으면 그 공지를 고친다.
  const [composeOpen, setComposeOpen] = useState(false);
  const [editing, setEditing] = useState<GroupAnnouncementResponse | null>(null);

  // 요청 시퀀스 — 당겨서 새로고침·작성 직후 재조회·'다시 시도'가 겹치면 늦게 도착한 이전 응답이
  // 최신 목록을 덮을 수 있다. 최신 요청의 결과만 반영한다(useFriends.ts의 requestSeqRef 패턴).
  const requestSeqRef = useRef(0);

  const fetchNotices = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setErrorMsg(null);
    try {
      // 서버 정렬(createdAt DESC)을 그대로 신뢰한다.
      const rows = await getAnnouncements(groupId);
      if (seq !== requestSeqRef.current) return;
      setNotices(rows);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setErrorMsg(listErrorMessage(e));
    }
  }, [groupId]);

  useEffect(() => {
    logGroupTabViewed({ tab: 'notice' });
  }, []);

  useEffect(() => {
    fetchNotices();
  }, [fetchNotices]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
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
    fetchNotices();
  }, [fetchNotices]);

  function confirmDelete(notice: GroupAnnouncementResponse) {
    Alert.alert('공지 삭제', `"${notice.title}" 공지를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAnnouncement(groupId, notice.id);
            fetchNotices();
          } catch (e) {
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
        <Text style={s.cardTitle}>{notice.title}</Text>
        <Text style={s.cardContent} numberOfLines={3}>
          {notice.content}
        </Text>
        <Text style={s.cardDate}>{formatNoticeDate(notice.createdAt)}</Text>
      </>
    );
  }

  const header = (
    <View style={s.header}>
      <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
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
      />
    ) : null;

  // ── 최초 로딩 — 중앙 스피너(§5-4). 새로고침은 RefreshControl이 맡는다. ──
  if (notices === null && errorMsg === null) {
    return (
      <SafeAreaView style={s.root} edges={['top']}>
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
      <SafeAreaView style={s.root} edges={['top']}>
        {header}
        <View style={s.center}>
          <Text style={s.emptyTitle}>{errorMsg}</Text>
          <Text style={s.emptyDesc}>잠시 후 다시 시도해주세요.</Text>
          <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={() => fetchNotices()}>
            <Text style={s.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const list = notices ?? [];

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {header}

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          s.listContent,
          { paddingBottom: insets.bottom + 96 },
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
        ListHeaderComponent={errorMsg !== null ? <Text style={s.notice}>{errorMsg}</Text> : null}
        ListEmptyComponent={
          <View style={s.center}>
            <Text style={s.emptyTitle}>등록된 공지가 없어요</Text>
            {canWrite && <Text style={s.emptyDesc}>+ 버튼으로 첫 공지를 남겨보세요</Text>}
          </View>
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
          style={[s.fab, { bottom: insets.bottom + T.space.xl }]}
          activeOpacity={0.85}
          onPress={() => openCompose(null)}
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
  emptyTitle: { ...T.text.subtitle, color: T.ink, textAlign: 'center' },
  emptyDesc: {
    ...T.text.body,
    color: T.inkSub,
    marginTop: T.space.sm,
    textAlign: 'center',
  },
  retryBtn: {
    height: 48,
    paddingHorizontal: T.space.xxl,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
    marginTop: T.space.xl,
  },
  retryText: { ...T.text.subtitle, color: T.white },

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
    width: 56,
    height: 56,
    borderRadius: 28,
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
