import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import { createAnnouncement, groupErrorCode, updateAnnouncement } from '@/services/groupApi';
import type { V2RootStackParamList } from '@/navigation/types';
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
  // 수정하려던 공지가 이미 사라짐(NOT_FOUND) — 부모가 닫고 목록을 다시 맞춘다(안내는 부모가 띄운다).
  onEditingGone: () => void;
}

// 저장 실패 문구 — HTTP status가 아니라 서버 code로 분기하고, 모르는 code는 공통 문구(§5-2).
function saveErrorMessage(e: unknown, isEdit: boolean): string {
  switch (groupErrorCode(e)) {
    // 수정 모드의 NOT_FOUND는 save()가 onEditingGone으로 빼내 부모가 Alert로 안내하므로
    // 여기까지 오지 않는다(분기는 계약 문서용으로 남긴다).
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
  onEditingGone,
}: NoticeComposeSheetProps) {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const isEdit = !!editing;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [content, setContent] = useState(editing?.content ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 키보드 회피 — SheetShell 패널이 bottom:0 absolute라 KeyboardAvoidingView(padding)가 안 먹는다.
  // 키보드 높이를 직접 받아 하단 스페이서로 입력·버튼을 키보드 위로 띄운다(iOS 전용 앱).
  const insets = useSafeAreaInsets();
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    // keyboardWillShow/Hide는 iOS 전용이라 Android에선 발화하지 않는다 — GroupFindSheet와 같은
    // 플랫폼 분기로 Android에선 keyboardDidShow/Hide를 쓴다(리뷰 반영).
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // 저장 요청이 떠 있는 동안인가 — 이탈 차단 리스너가 리렌더 없이 읽어야 해서 state와 별도로 둔다.
  const submittingRef = useRef(false);

  // 저장 중 스택 이탈 차단 — 이 시트는 SheetShell 기본형(asModal=false)이라 딤 탭만 막아서는
  // 안드로이드 하드웨어 백·iOS 스택 제스처가 GroupNotice 화면째 pop해 버린다. 그래도 요청은
  // 서버에 도달해 공지가 생기거나 고쳐지므로, 취소한 줄 아는 사용자가 중복 등록을 하게 된다.
  // (GroupCreateScreen의 생성 중 이탈 차단과 같은 규칙.)
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (submittingRef.current) e.preventDefault();
      }),
    [navigation],
  );

  const canSave = title.trim().length > 0 && content.trim().length > 0 && !submitting;

  async function save() {
    // 저장 중 중복 탭 방지 — 이중 등록은 되돌릴 방법이 없다.
    // canSave(state 파생)만으로는 같은 틱의 연타를 못 막는다 — 두 press가 모두 이전 렌더의
    // canSave=true를 읽는다. ref는 동기라 첫 호출이 세운 잠금을 두 번째가 즉시 본다.
    if (!canSave || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setErrorMsg(null);
    const body = { title: title.trim(), content: content.trim() };
    try {
      if (editing) await updateAnnouncement(groupId, editing.id, body);
      else await createAnnouncement(groupId, body);
      submittingRef.current = false;
      onSaved();
    } catch (e) {
      submittingRef.current = false;
      // 수정 대상이 이미 삭제됐다면 이 시트에 문구만 남겨서는 정합성이 맞지 않는다 — 시트를 닫아도
      // NoticeScreen은 포커스 재조회가 없어 사라진 카드가 목록에 그대로 남고, 사용자는 같은 카드를
      // 다시 열어 고치거나 지우려 든다. 부모에게 넘겨 닫기+재조회를 시킨다(삭제 404와 같은 규칙).
      if (isEdit && groupErrorCode(e) === 'NOT_FOUND') {
        onEditingGone();
        return;
      }
      setErrorMsg(saveErrorMessage(e, isEdit));
      setSubmitting(false);
    }
  }

  return (
    // 저장 중에는 딤 탭으로 닫히지 않게 막는다(요청이 떠 있는 상태에서의 언마운트 방지).
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
      {/* 키보드 높이만큼 하단을 띄워 입력·버튼이 키보드에 가리지 않게 한다(홈 인디케이터 인셋 제외) */}
      {kbHeight > 0 && <View style={{ height: Math.max(0, kbHeight - insets.bottom) }} />}
    </SheetShell>
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
