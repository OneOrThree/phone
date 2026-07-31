import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import { createAnnouncement, groupErrorCode, updateAnnouncement } from '@/services/groupApi';
import type { GroupAnnouncementResponse } from '@/types/dto/group';

// 공지 작성·수정 시트 — 명세 docs/app/group-plan.md §6-5.
// 작성과 수정이 같은 시트다 — editing 유무로만 갈린다(부모 NoticeScreen이 editingId를 쥔다).
//
// 검증: 제목 ≤ 100자(서버 제약, §3-2) · 제목·본문 모두 필수. 둘 중 하나라도 비면 저장 버튼 비활성.
// NOTICE_FORBIDDEN(403)은 작성 진입점 자체를 감춰 예방하는 게 원칙이라 여기선 공통 문구로 충분하다.

const TITLE_MAX = 100;

export interface NoticeComposeSheetProps {
  groupId: string;
  // 수정 모드일 때 대상 공지. 없거나 null이면 새 공지 작성.
  editing?: GroupAnnouncementResponse | null;
  onClose: () => void;
  // 작성·수정 성공 — 부모가 닫고 목록을 재조회한다.
  onSaved: () => void;
}

// 저장 실패 문구 — HTTP status가 아니라 서버 code로 분기하고, 모르는 code는 공통 문구(§5-2).
function saveErrorMessage(e: unknown, isEdit: boolean): string {
  switch (groupErrorCode(e)) {
    case 'NOT_FOUND':
      return isEdit ? '이미 삭제된 공지예요.' : '사라진 그룹이에요.';
    case 'NOTICE_FORBIDDEN':
      return '공지를 작성할 권한이 없어요.';
    case 'MEMBER_ONLY':
      return '그룹원만 이용할 수 있어요.';
    default:
      return `공지 ${isEdit ? '수정' : '등록'}에 실패했어요. 잠시 후 다시 시도해주세요.`;
  }
}

export default function NoticeComposeSheet({
  groupId,
  editing,
  onClose,
  onSaved,
}: NoticeComposeSheetProps) {
  const isEdit = !!editing;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [content, setContent] = useState(editing?.content ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canSave = title.trim().length > 0 && content.trim().length > 0 && !submitting;

  async function save() {
    // 저장 중 중복 탭 방지 — 이중 등록은 되돌릴 방법이 없다.
    if (!canSave) return;
    setSubmitting(true);
    setErrorMsg(null);
    const body = { title: title.trim(), content: content.trim() };
    try {
      if (editing) await updateAnnouncement(groupId, editing.id, body);
      else await createAnnouncement(groupId, body);
      onSaved();
    } catch (e) {
      setErrorMsg(saveErrorMessage(e, isEdit));
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={StyleSheet.absoluteFill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* 저장 중에는 딤 탭으로 닫히지 않게 막는다(요청이 떠 있는 상태에서의 언마운트 방지) */}
      <SheetShell onClose={submitting ? () => {} : onClose}>
        <Text style={s.title}>{isEdit ? '공지 수정' : '공지 쓰기'}</Text>
        <Text style={s.sub}>그룹원 모두에게 보여요.</Text>

        <View style={s.field}>
          <View style={s.labelRow}>
            <Text style={s.label}>제목</Text>
            <Text style={s.counter}>
              {title.length}/{TITLE_MAX}
            </Text>
          </View>
          <TextInput
            style={s.input}
            value={title}
            onChangeText={setTitle}
            placeholder="공지 제목"
            placeholderTextColor={T.inkMuted}
            maxLength={TITLE_MAX}
            returnKeyType="next"
          />
        </View>

        <View style={s.field}>
          <Text style={s.label}>내용</Text>
          <TextInput
            style={[s.input, s.contentInput]}
            value={content}
            onChangeText={setContent}
            placeholder="공지 내용을 적어주세요"
            placeholderTextColor={T.inkMuted}
            multiline
            textAlignVertical="top"
          />
        </View>

        {errorMsg !== null && <Text style={s.error}>{errorMsg}</Text>}

        <TouchableOpacity
          style={[s.saveBtn, !canSave && s.saveBtnDisabled]}
          activeOpacity={0.85}
          onPress={save}
          disabled={!canSave}
        >
          {submitting ? (
            <ActivityIndicator color={T.white} />
          ) : (
            <Text style={s.saveText}>{isEdit ? '수정하기' : '등록하기'}</Text>
          )}
        </TouchableOpacity>
      </SheetShell>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  sub: {
    ...T.text.label,
    fontWeight: '500',
    color: T.inkMuted,
    marginTop: 2,
    marginBottom: T.space.lg,
  },
  field: { marginBottom: T.space.lg },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { ...T.text.label, color: T.inkSub, marginBottom: T.space.sm },
  counter: { ...T.text.caption, color: T.inkMuted, marginBottom: T.space.sm },
  input: {
    ...T.text.body,
    color: T.ink,
    backgroundColor: T.paperAlt,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.border,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.md,
  },
  contentInput: { minHeight: 112, maxHeight: 180 },
  error: { ...T.text.caption, color: T.dangerInk, marginBottom: T.space.md },
  saveBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveText: { ...T.text.subtitle, color: T.white },
});
