import { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T, inkBox } from '@/constants/theme';
import { api } from '@/services/api';
import { useUser } from '@/store/UserContext';
import type { Group } from '@/types/api';

// 그룹 상세 — 화면에서 쓰는 공지 권한 필드 추가
interface GroupDetail extends Group {
  noticeGrantedUserIds?: number[];
  [key: string]: unknown;
}

// 공지
interface Notice {
  id: number;
  title: string;
  content: string;
  createdAt?: string;
}

interface NoticeTabProps {
  group: GroupDetail | null;
  groupId: number;
}

function formatDate(instant: string | null | undefined) {
  if (!instant) return '';
  const d = new Date(instant);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
}

export default function NoticeTab({ group, groupId }: NoticeTabProps) {
  const { userId: myUserId } = useUser();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [writeVisible, setWriteVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null); // null = 신규, number = 수정 중
  const [submitting, setSubmitting] = useState(false);
  const insets = useSafeAreaInsets();

  const isOwner = group?.members?.some((m) => m.userId === myUserId && m.role === 'OWNER') ?? false;
  const canWrite =
    isOwner || (myUserId != null && (group?.noticeGrantedUserIds ?? []).includes(myUserId));

  async function fetchNotices() {
    setLoading(true);
    try {
      const res = await api.get<Notice[]>(`/api/v1/groups/${groupId}/announcements`);
      const data = res.data;
      setNotices(data);
    } catch {
      // 조용히 실패 처리
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchNotices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  function openWrite() {
    setEditingId(null);
    setTitle('');
    setContent('');
    setWriteVisible(true);
  }

  function openEdit(notice: Notice) {
    setEditingId(notice.id);
    setTitle(notice.title);
    setContent(notice.content);
    setWriteVisible(true);
  }

  async function handleSubmit() {
    if (!title.trim() || !content.trim()) {
      Alert.alert('입력 오류', '제목과 내용을 모두 입력해주세요');
      return;
    }
    setSubmitting(true);
    try {
      const isEdit = editingId !== null;
      const url = isEdit
        ? `/api/v1/groups/${groupId}/announcements/${editingId}`
        : `/api/v1/groups/${groupId}/announcements`;
      const body = { title: title.trim(), content: content.trim() };
      if (isEdit) {
        await api.put(url, body);
      } else {
        await api.post(url, body);
      }
      setWriteVisible(false);
      fetchNotices();
    } catch {
      Alert.alert(
        '오류',
        `공지 ${editingId !== null ? '수정' : '등록'}에 실패했어요. 다시 시도해주세요.`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleDelete(notice: Notice) {
    Alert.alert('공지 삭제', `"${notice.title}" 공지를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/api/v1/groups/${groupId}/announcements/${notice.id}`);
            fetchNotices();
          } catch {
            Alert.alert('오류', '공지 삭제에 실패했어요. 다시 시도해주세요.');
          }
        },
      },
    ]);
  }

  return (
    <View style={s.root}>
      {loading ? (
        <ActivityIndicator size="large" color={T.ink} style={s.loader} />
      ) : (
        <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
          {notices.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyText}>등록된 공지가 없어요</Text>
            </View>
          ) : (
            notices.map((notice, index) => (
              <View key={notice.id} style={[s.card, inkBox(T.paper)]}>
                <View style={s.cardHeader}>
                  <Text style={s.cardMeta}>
                    공지 #{index + 1} · {formatDate(notice.createdAt)}
                  </Text>
                  {canWrite && (
                    <View style={s.cardActions}>
                      <TouchableOpacity
                        onPress={() => openEdit(notice)}
                        hitSlop={{ top: 8, right: 4, bottom: 8, left: 4 }}
                      >
                        <Text style={s.actionEdit}>수정</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDelete(notice)}
                        hitSlop={{ top: 8, right: 4, bottom: 8, left: 4 }}
                      >
                        <Text style={s.actionDelete}>삭제</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                <Text style={s.cardTitle}>{notice.title}</Text>
                <Text style={s.cardContent} numberOfLines={2}>
                  {notice.content}
                </Text>
              </View>
            ))
          )}
          <View style={s.listBottom} />
        </ScrollView>
      )}

      {/* FAB — 방장 및 권한 부여된 멤버에게 노출 */}
      {canWrite && (
        <TouchableOpacity style={s.fab} onPress={openWrite} activeOpacity={0.8}>
          <Text style={s.fabText}>+</Text>
        </TouchableOpacity>
      )}

      {/* 공지 작성/수정 모달 */}
      <Modal
        visible={writeVisible}
        animationType="slide"
        onRequestClose={() => setWriteVisible(false)}
      >
        <KeyboardAvoidingView
          style={s.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* 헤더 */}
          <View style={[s.modalHeader, { paddingTop: insets.top + 8 }]}>
            <TouchableOpacity
              onPress={() => setWriteVisible(false)}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              style={s.headerSide}
            >
              <Text style={s.cancelText}>취소</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>{editingId !== null ? '공지 수정' : '공지 작성'}</Text>
            <View style={s.headerSide} />
          </View>

          <ScrollView style={s.modalBody} keyboardShouldPersistTaps="handled">
            {/* 방장 전용 배지 */}
            <View style={s.ownerBadge}>
              <Text style={s.ownerBadgeText}>⭐ 방장 전용</Text>
            </View>

            {/* 제목 */}
            <Text style={s.fieldLabel}>제목</Text>
            <View style={[s.inputBox, inkBox(T.paper)]}>
              <TextInput
                style={s.titleInput}
                placeholder="제목 입력 (최대 100자)"
                placeholderTextColor={T.inkLight}
                value={title}
                onChangeText={(t) => setTitle(t.slice(0, 100))}
                maxLength={100}
              />
              <Text style={s.counter}>{title.length}/100</Text>
            </View>

            {/* 내용 */}
            <Text style={s.fieldLabel}>내용</Text>
            <View style={[s.contentBox, inkBox(T.paper)]}>
              <TextInput
                style={s.contentInput}
                placeholder={'공지 내용을 입력하세요.\n(최대 500자)'}
                placeholderTextColor={T.inkLight}
                value={content}
                onChangeText={(t) => setContent(t.slice(0, 500))}
                maxLength={500}
                multiline
                textAlignVertical="top"
              />
              <Text style={[s.counter, s.counterBottom]}>{content.length}/500</Text>
            </View>
          </ScrollView>

          {/* 등록/수정 버튼 */}
          <TouchableOpacity
            style={[s.submitBtn, { marginBottom: insets.bottom + 16 }, submitting && s.btnDisabled]}
            onPress={handleSubmit}
            activeOpacity={0.8}
            disabled={submitting}
          >
            <Text style={s.submitBtnText}>
              {submitting
                ? editingId !== null
                  ? '수정 중...'
                  : '등록 중...'
                : editingId !== null
                  ? '수정하기'
                  : '등록하기'}
            </Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  loader: { marginTop: 60 },

  list: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  listBottom: { height: 100 },

  empty: { marginTop: 80, alignItems: 'center' },
  emptyText: { fontSize: 14, fontWeight: '700', color: T.inkLight },

  card: {
    padding: 16,
    marginBottom: 12,
    gap: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardMeta: { fontSize: 12, fontWeight: '600', color: T.inkLight },
  cardActions: { flexDirection: 'row', gap: 12 },
  actionEdit: { fontSize: 12, fontWeight: '700', color: T.inkMed },
  actionDelete: { fontSize: 12, fontWeight: '700', color: '#ef4444' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: T.ink },
  cardContent: { fontSize: 13, fontWeight: '500', color: T.inkMed, lineHeight: 18 },

  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: T.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: { fontSize: 28, color: T.paper, lineHeight: 32 },

  // 모달
  modalRoot: { flex: 1, backgroundColor: T.paper },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: T.ink,
  },
  headerSide: { width: 56 },
  cancelText: { fontSize: 15, fontWeight: '700', color: T.inkMed },
  modalTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '900',
    color: T.ink,
  },

  modalBody: { flex: 1, paddingHorizontal: 20 },

  ownerBadge: {
    marginTop: 20,
    marginBottom: 24,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: T.paperDark,
    borderWidth: 1.5,
    borderColor: T.ink,
  },
  ownerBadgeText: { fontSize: 13, fontWeight: '700', color: T.ink },

  fieldLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: T.inkMed,
    marginBottom: 8,
  },

  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
  },
  titleInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: T.ink,
  },
  counter: { fontSize: 12, fontWeight: '600', color: T.inkLight, marginLeft: 8 },

  contentBox: {
    padding: 14,
    marginBottom: 20,
  },
  contentInput: {
    fontSize: 14,
    fontWeight: '500',
    color: T.ink,
    minHeight: 200,
    lineHeight: 20,
  },
  counterBottom: { marginLeft: 0, marginTop: 8, textAlign: 'right' },

  submitBtn: {
    marginHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 8,
    backgroundColor: T.ink,
    alignItems: 'center',
  },
  submitBtnText: { fontSize: 15, fontWeight: '800', color: T.paper },
  btnDisabled: { opacity: 0.4 },
});
