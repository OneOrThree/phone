import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { useOverlayAlert } from '@/store/useOverlayAlert';
import { useUser } from '@/store/UserContext';
import { useToast } from '@/store/ToastContext';
import { getGroupDetail, groupErrorCode, updateGroup } from '@/services/groupApi';
import { logGroupSettingsUpdated } from '@/services/analyticsEvents';
import type { GroupDetailResponse, UpdateGroupRequest } from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';

// 그룹 프로필 설정 (root stack 'GroupProfileEdit') — 그룹 설정 허브(GroupSettings)의 '그룹 프로필
// 설정하기' 행에서 push. **방장 전용**. 이름·소개·정원·공개설정 편집 + 저장만 담당한다
// (관리 진입 — 방장 넘기기·멤버 관리·공지 권한 — 은 허브에 남는다).
//
// ⚠️ 저장은 **바뀐 필드만** PATCH한다(updateGroup은 부분 수정 — 보낸 필드만 반영). 바뀐 게
//    없으면 저장을 잠근다. 성공하면 기준값(base)을 방금 보낸 값으로 굳혀 '변경 없음'으로 되돌린다.
// ⚠️ 진입은 방장 전용이지만 여기서도 방어적으로 한 번 더 막는다 — 멤버십은 다른 기기에서
//    바뀔 수 있어(위임·강퇴) 상세의 내 role이 OWNER가 아니면 폼을 열지 않는다.

const NAME_MAX = 50; // 서버 검증 상수(§3-2)
const DESCRIPTION_MAX = 200; // 소개 최대 길이 — 서버 검증 상수
const MEMBERS_MAX = 10; // 서버 정원 상한

type GroupProfileEditRoute = RouteProp<V2RootStackParamList, 'GroupProfileEdit'>;

// 폼 기준값 — 저장 diff의 비교 대상. 로드 시 상세로, 저장 성공 시 방금 보낸 값으로 굳힌다.
interface FormBase {
  name: string;
  description: string;
  maxMembers: number;
  isPrivate: boolean;
}

export default function GroupProfileEditScreen() {
  // 네이티브 Alert는 RN Modal **위에** 뜬다 — 떠 있는 동안 결과 모달이 그 아래에서
  // 마운트되면 사용자는 못 봤는데 seen 마커와 ack이 찍힌다. 이 훅이 Alert 수명 동안
  // 조정자 slot을 점유해 그걸 막는다(store/useOverlayAlert 헤더).
  const showAlert = useOverlayAlert('groupProfileEdit.alert');
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { groupId } = useRoute<GroupProfileEditRoute>().params;
  const { userId } = useUser();
  // 성공 통보용 전역 토스트 — 확인 버튼이 필요 없는 한 줄 알림.
  const { show } = useToast();

  const [detail, setDetail] = useState<GroupDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // 편집 폼 값(현재 값으로 초기화) + 기준값(base).
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxMembers, setMaxMembers] = useState(MEMBERS_MAX);
  const [isPrivate, setIsPrivate] = useState(false);
  const [base, setBase] = useState<FormBase | null>(null);
  const [saving, setSaving] = useState(false);

  // 요청 시퀀스 — '다시 시도' 연타로 겹친 조회 중 늦게 온 이전 응답이 최신을 덮지 않게 한다.
  // cleanup에서 올려 언마운트 뒤 setState를 막는다.
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(false);
    try {
      const d = await getGroupDetail(groupId);
      if (seq !== requestSeqRef.current) return;
      setDetail(d);
      const b: FormBase = {
        name: d.name,
        description: d.description ?? '',
        maxMembers: d.maxMembers,
        isPrivate: d.isPrivate ?? false,
      };
      // 폼과 기준값을 같은 값으로 세운다 — 로드 직후엔 '변경 없음'이어야 한다.
      setName(b.name);
      setDescription(b.description);
      setMaxMembers(b.maxMembers);
      setIsPrivate(b.isPrivate);
      setBase(b);
    } catch {
      if (seq !== requestSeqRef.current) return;
      setError(true);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [groupId]);

  // 포커스마다 재조회 — 허브에서 위임/강퇴 등을 거쳐 돌아오면 멤버십/정원이 바뀌어 있을 수 있다.
  // blur cleanup에서 시퀀스를 올려 진행 중이던 조회를 무효화한다(다른 그룹 화면과 같은 패턴).
  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        requestSeqRef.current++;
      };
    }, [load]),
  );

  // 내 권한 판정 — 상세 응답에 내 role이 없어 멤버 목록에서 직접 계산한다(GroupRoomScreen과 동일).
  const me = userId ? detail?.members.find((m) => m.userId === userId) : undefined;
  const isOwner = me?.role === 'OWNER';

  // 정원 하한 = 현재 멤버 수 — 이보다 적게 줄이면 서버가 MAX_MEMBERS_TOO_SMALL(400)로 튕긴다.
  const memberCount = detail?.members.length ?? 1;
  const membersMin = Math.max(1, memberCount);

  // 저장 diff — 기준값과 **달라진 필드만** 담는다. 이름·소개는 트림해서 비교/전송한다.
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const changedFields: string[] = [];
  if (base) {
    if (trimmedName !== base.name) changedFields.push('name');
    if (trimmedDescription !== base.description) changedFields.push('description');
    if (maxMembers !== base.maxMembers) changedFields.push('maxMembers');
    if (isPrivate !== base.isPrivate) changedFields.push('isPrivate');
  }
  // 이름이 비면 저장 불가(빈 이름으로 덮어쓰지 않는다). 바뀐 게 없어도 잠근다.
  const canSave = base !== null && changedFields.length > 0 && trimmedName.length > 0 && !saving;

  function bumpMembers(dir: 1 | -1) {
    setMaxMembers((prev) => Math.max(membersMin, Math.min(MEMBERS_MAX, prev + dir)));
  }

  async function save() {
    // disabled={!canSave}라 도달 경로는 없지만 연타·잔여 클로저 방어로 남긴다.
    if (base === null || !canSave) return;
    const body: UpdateGroupRequest = {};
    if (changedFields.includes('name')) body.name = trimmedName;
    if (changedFields.includes('description')) body.description = trimmedDescription;
    if (changedFields.includes('maxMembers')) body.maxMembers = maxMembers;
    if (changedFields.includes('isPrivate')) body.isPrivate = isPrivate;

    setSaving(true);
    try {
      await updateGroup(groupId, body);
      // 성공 계측 — fields는 실제로 바뀐 키 배열('name'|'description'|'maxMembers'|'isPrivate').
      logGroupSettingsUpdated({ group_id: groupId, fields: changedFields });
      // 기준값을 방금 보낸 값으로 굳혀 '변경 없음'으로 되돌린다. 폼도 트림된 값으로 정규화한다.
      setBase({
        name: trimmedName,
        description: trimmedDescription,
        maxMembers,
        isPrivate,
      });
      setName(trimmedName);
      setDescription(trimmedDescription);
      // 성공 통보는 읽고 흘려도 되는 한 줄이라 Alert 대신 토스트로 알린다(GROMO-1381).
      // 실패 알럿(아래 catch)은 사용자가 사유를 읽고 조치해야 하므로 Alert로 남긴다.
      show({ message: '그룹 설정을 저장했어요', tone: 'success' });
    } catch (e) {
      // 정원을 현재 인원 미만으로 줄인 경우 — 사유를 그대로 알려준다(§3-2 code 분기).
      if (groupErrorCode(e) === 'MAX_MEMBERS_TOO_SMALL') {
        // ⚠️ `await` 뒤에 여는 Alert다 — 여는 시점을 응답이 정하므로 기다리는 사이
        //    결과 모달이 먼저 노출될 수 있다. 그러면 이 Alert가 그 **위를** 덮어,
        //    사용자는 못 봤는데 seen/ack은 이미 찍힌 상태가 된다. 승인을 받고 띄운다.
        await showAlert.afterSlot('정원을 줄일 수 없어요', '현재 멤버 수보다 적게 정할 수 없어요.');
      } else {
        await showAlert.afterSlot('저장하지 못했어요', '잠시 후 다시 시도해 주세요.');
      }
    } finally {
      setSaving(false);
    }
  }

  // 헤더 — 원형 백버튼 + 좌측 정렬 제목(그룹 설정·만들기 화면과 같은 규격, §5-1).
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
      <Text style={s.headerTitle}>그룹 프로필 설정</Text>
    </View>
  );

  let body: ReactNode;
  if (loading && detail === null) {
    // ── 최초 로딩 — 중앙 스피너(§5-4) ──
    body = (
      <View style={s.center}>
        <ActivityIndicator color={T.accent} />
      </View>
    );
  } else if (error && detail === null) {
    // ── 에러 + 다시 시도 ──
    body = (
      <View style={s.center}>
        <Text style={s.emptyTitle}>그룹을 불러오지 못했어요</Text>
        <Text style={s.emptyDesc}>잠시 후 다시 시도해 주세요.</Text>
        <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={() => load()}>
          <Text style={s.retryText}>다시 시도</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (!isOwner) {
    // ── 방장 아님 — 방어적 권한 안내(백버튼만) ──
    body = (
      <View style={s.center}>
        <Text style={s.emptyTitle}>방장만 접근할 수 있어요</Text>
        <Text style={s.emptyDesc}>그룹 프로필은 방장이 관리해요.</Text>
      </View>
    );
  } else {
    // ── 편집 폼 ──
    body = (
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + T.space.xxl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* ── 그룹 이름 ── */}
        <Text style={s.label}>그룹 이름</Text>
        <View style={s.inputBox}>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="그룹 이름"
            placeholderTextColor={T.inkMuted}
            maxLength={NAME_MAX}
            returnKeyType="done"
          />
          <Text style={s.counter}>
            {name.length}/{NAME_MAX}
          </Text>
        </View>

        {/* ── 소개 — 멀티라인 + 글자수 카운터(GroupCreateScreen 패턴) ── */}
        <Text style={s.label}>소개</Text>
        <View style={s.descBox}>
          <TextInput
            style={s.descInput}
            value={description}
            onChangeText={setDescription}
            placeholder="그룹을 소개해 주세요 (선택)"
            placeholderTextColor={T.inkMuted}
            maxLength={DESCRIPTION_MAX}
            multiline
            textAlignVertical="top"
          />
        </View>
        <Text style={s.descCounter}>
          {description.length}/{DESCRIPTION_MAX}
        </Text>

        {/* ── 정원 — 스텝퍼(하한 = 현재 멤버 수) ── */}
        <Text style={s.label}>정원</Text>
        <View style={s.row}>
          <Text style={s.rowLabel}>최대 인원</Text>
          <View style={s.stepper}>
            <TouchableOpacity
              style={[s.stepBtn, maxMembers <= membersMin ? s.stepBtnOff : null]}
              activeOpacity={0.7}
              disabled={maxMembers <= membersMin}
              onPress={() => bumpMembers(-1)}
              accessibilityLabel="정원 줄이기"
            >
              <Ionicons name="remove" size={18} color={T.inkSub} />
            </TouchableOpacity>
            <Text style={s.stepValue}>{maxMembers}명</Text>
            <TouchableOpacity
              style={[s.stepBtn, maxMembers >= MEMBERS_MAX ? s.stepBtnOff : null]}
              activeOpacity={0.7}
              disabled={maxMembers >= MEMBERS_MAX}
              onPress={() => bumpMembers(1)}
              accessibilityLabel="정원 늘리기"
            >
              <Ionicons name="add" size={18} color={T.inkSub} />
            </TouchableOpacity>
          </View>
        </View>
        <Text style={s.hint}>현재 멤버 {memberCount}명 — 이보다 적게 정할 수 없어요</Text>

        {/* ── 공개 설정 — 토글 + 캡션(참여 경로가 갈린다) ── */}
        <Text style={s.label}>공개 설정</Text>
        <View style={s.row}>
          <Text style={s.rowLabel}>비공개 그룹</Text>
          <Switch
            value={isPrivate}
            onValueChange={setIsPrivate}
            trackColor={{ false: T.track, true: T.accent }}
            thumbColor={T.white}
            testID="group.profile.private"
          />
        </View>
        <View style={s.note}>
          <Ionicons
            name={isPrivate ? 'lock-closed' : 'search'}
            size={15}
            color={T.accent}
            style={s.noteIcon}
          />
          <Text style={s.noteText}>
            {isPrivate
              ? '비공개 방은 검색에 뜨지 않아요. 초대 링크로만 참여할 수 있어요'
              : '누구나 그룹 이름을 검색해 들어올 수 있어요'}
          </Text>
        </View>

        {/* ── 저장 ── */}
        <TouchableOpacity
          style={[s.submitBtn, canSave ? null : s.submitBtnOff]}
          activeOpacity={0.85}
          disabled={!canSave}
          onPress={save}
          testID="group.profile.save"
        >
          {saving ? <ActivityIndicator color={T.white} /> : <Text style={s.submitText}>저장</Text>}
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="group.profile.screen">
      {header}
      {body}
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

  // 로딩·에러·권한 분기 공통 중앙 블록
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: T.space.xxl,
  },
  emptyTitle: { ...T.text.title, color: T.ink, textAlign: 'center' },
  emptyDesc: { ...T.text.body, color: T.inkSub, marginTop: T.space.sm, textAlign: 'center' },
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

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: T.space.xl, paddingTop: T.space.xs },

  label: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    marginTop: T.space.xl,
    marginBottom: T.space.sm,
  },

  // 이름 입력 — 그룹 만들기 화면과 같은 테두리 규격
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.border,
    borderRadius: 13,
    paddingHorizontal: T.space.md,
    minHeight: 46,
    paddingVertical: T.space.md,
  },
  input: { ...T.text.label, flex: 1, color: T.ink, padding: 0 },
  counter: { ...T.text.caption, color: T.inkMuted, fontVariant: ['tabular-nums'] },

  // 소개 입력(멀티라인) — 이름 인풋과 같은 테두리, 높이만 키운다
  descBox: {
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.border,
    borderRadius: 13,
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.md,
    minHeight: 88,
  },
  descInput: { ...T.text.label, color: T.ink, padding: 0, minHeight: 60 },
  descCounter: {
    ...T.text.caption,
    color: T.inkMuted,
    fontVariant: ['tabular-nums'],
    alignSelf: 'flex-end',
    marginTop: T.space.xs,
  },

  // 정원 스텝퍼 · 공개 토글 공통 행
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 15,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
  },
  rowLabel: { ...T.text.label, fontWeight: '700', color: T.ink },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: T.space.lg },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: T.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOff: { opacity: 0.5 },
  stepValue: {
    ...T.text.label,
    minWidth: 52,
    textAlign: 'center',
    fontWeight: '700',
    color: T.ink,
    fontVariant: ['tabular-nums'],
  },
  hint: { ...T.text.caption, fontWeight: '500', color: T.inkMuted, marginTop: T.space.sm },

  // 공개 설정 캡션 박스 — 그룹 만들기 화면의 note와 같은 규격
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: T.space.sm,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.md,
  },
  noteIcon: { marginTop: 2 },
  noteText: { ...T.text.caption, fontWeight: '500', color: T.inkSub, flex: 1, lineHeight: 19 },

  // 저장 CTA = 52 / r16 (그룹 3화면 공통 규격)
  submitBtn: {
    minHeight: 52,
    paddingVertical: T.space.md,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
    marginTop: T.space.xxl,
  },
  submitBtnOff: { opacity: 0.5 },
  submitText: { ...T.text.subtitle, color: T.white },
});
