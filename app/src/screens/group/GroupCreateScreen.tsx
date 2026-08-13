import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { T, withAlpha } from '@/constants/theme';
import type { V2RootStackParamList } from '@/navigation/types';
import { getAuthSessionGeneration } from '@/services/api';
import { createGroup, groupErrorCode } from '@/services/groupApi';
import { promptSessionExpired, USER_NOT_FOUND } from '@/services/sessionErrors';
import { issueInviteLink } from '@/services/inviteLinkApi';
import {
  logGroupCardIconSaveResult,
  logGroupCreateSubmitted,
  logGroupCreated,
  logGroupCreateStarted,
  logGroupInviteShared,
} from '@/services/analyticsEvents';
import { useUser } from '@/store/UserContext';
import { buildInviteShareMessage } from './inviteShare';
import { GroupCardEmojiPicker } from './components/GroupCardEmojiPicker';
import {
  DEFAULT_GROUP_CARD_EMOJI,
  preservePendingGroupCardEmoji,
  writeGroupCardEmoji,
  type GroupCardEmoji,
} from './groupCardEmojiStore';

// 그룹 생성 화면 (root stack 'GroupCreate') — 명세 docs/app/group-plan.md §6-2
// + 3차 §D18(챌린지를 그룹 생성과 분리, 소개 추가).
//
// 폼 4필드(이름·소개·정원·공개 설정) → createGroup → 비공개면 초대 링크
// 다이얼로그를 거쳐 goBack. 탭(GroupScreen)이 useFocusEffect로 재조회해 그룹방으로 전환된다.
//
// ⚠️ 전송 계약(3차 §D18):
//   · 챌린지는 그룹 생성 시 정하지 않는다 — createGroup이 더 이상 대표 챌린지를 만들지 않으므로
//     missionType·missionCategory·durationMinutes를 보내지 않는다. 챌린지는 그룹방에서 따로 만든다.
//   · description(소개)은 선택이라 입력이 있을 때만 실어 보낸다(빈 값이면 생략, 서버 ≤ 200자).
//   · password는 절대 보내지 않는다 — 보내는 순간 아무도 못 들어오는 그룹이 된다.
//   · 응답의 code는 읽지 않는다(참가 코드 개념 폐기 — 초대는 링크가 담당).
// ⚠️ isPrivate는 백엔드 P1-1(is_private) 배포 전까지 서버가 무시한다(§13-1). 폼은 그대로 둔다.

const NAME_MAX = 50; // 서버 검증 상수(§3-2)
const DESCRIPTION_MAX = 200; // 소개 최대 길이 — 서버 검증 상수(3차 §D18)
const MEMBERS_MIN = 2; // 서버는 1부터 허용하지만 혼자 있는 그룹은 의미가 없다
const MEMBERS_MAX = 10;
const MEMBERS_DEFAULT = 5;

// 한 사람이 참여할 수 있는 그룹 수 상한 — 서버 판정값(GROUP_LIMIT_EXCEEDED)이라 앱은 사전에 막지 않고
// 에러 안내 문구에만 쓴다(§0-6).
const GROUP_LIMIT = 10;

// '복사했어요' 표시 유지 시간(ms) — 지나면 '링크 복사'로 되돌린다.
const COPIED_RESET_MS = 2000;

// 공개 설정은 단순 옵션이 아니라 참여 경로를 가르는 스위치다 — 캡션을 항상 함께 노출한다(§6-2).
const VISIBILITY_CAPTION = {
  public: '누구나 그룹 이름을 검색해 들어올 수 있어요',
  private: '검색에 뜨지 않아요. 초대 링크를 받은 사람만 들어올 수 있어요',
} as const;

export default function GroupCreateScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const route = useRoute<RouteProp<V2RootStackParamList, 'GroupCreate'>>();
  const { userId } = useUser();
  const entryPoint = route.params?.entry_point ?? 'list';

  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [maxMembers, setMaxMembers] = useState(MEMBERS_DEFAULT);
  const [isPrivate, setIsPrivate] = useState(false);
  // 생성 전에는 groupId가 없으므로 로컬 draft로만 보관한다.
  const [cardEmoji, setCardEmoji] = useState<GroupCardEmoji>(DEFAULT_GROUP_CARD_EMOJI);
  const [submitting, setSubmitting] = useState(false);
  const [emojiSaveFailed, setEmojiSaveFailed] = useState(false);
  const [createdPublicGroupId, setCreatedPublicGroupId] = useState<string | null>(null);

  // 생성 성공한 비공개 그룹 — 값이 있으면 초대 링크 다이얼로그가 뜬다(§6-2 3번).
  // 이름을 id와 **함께** 들고 있는 이유: 요청이 떠 있는 동안에도 이름 입력은 열려 있어서,
  // 공유 문구가 현재 입력값을 읽으면 서버에 만들어진 이름과 다른 이름으로 초대장이 나간다.
  // 서버로 보낸 그 이름을 그대로 굳혀 둔다.
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // '복사했어요' 되돌리기 타이머 — 언마운트 시 정리한다.
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 서버가 발급한 초대 링크(초대 링크 스펙 §4-2 ①) — 복사·공유가 같은 값을 쓴다.
  // 발급은 서버에서 멱등이지만 왕복을 아끼려 첫 요청 결과를 캐시한다. 실패는 캐시하지 않아
  // 다음 탭에서 다시 시도된다(일시적 네트워크 오류로 다이얼로그가 영영 죽지 않게).
  const inviteRef = useRef<{ slug: string; url: string } | null>(null);

  // 생성 요청이 떠 있는 동안인가 — 이탈 차단 리스너가 리렌더 없이 읽어야 해서 state와 별도로 둔다.
  const submittingRef = useRef(false);

  // 요청 중 이탈 차단 — 뒤로 가도 서버에는 그룹이 만들어진다. 생성자는 OWNER인데 앱에 그룹 삭제도
  // 방장 위임도 없어(§14) OWNER 탈퇴가 거부되므로, 취소한 줄 아는 그룹에 갇힌다.
  // 헤더 버튼·제스처·안드로이드 하드웨어 백이 전부 이 이벤트를 지나가므로 여기서 한 번에 막는다.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (submittingRef.current) e.preventDefault();
      }),
    [navigation],
  );

  // 진입 계측 — 폼을 실제로 연 횟수(생성 완료율의 분모).
  useEffect(() => {
    logGroupCreateStarted({ entry_point: entryPoint });
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, [entryPoint]);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const canSubmit = trimmedName.length > 0 && !submitting;

  function bumpMembers(dir: 1 | -1) {
    setMaxMembers((prev) => Math.max(MEMBERS_MIN, Math.min(MEMBERS_MAX, prev + dir)));
  }

  // 서버 에러 분기 — HTTP status가 아니라 code로 본다(§3-2). 400 검증 에러만 필드 하이라이트.
  // requestSessionGeneration = 요청 직전의 인증 세대(유저 부재 분기의 로그아웃 판정용).
  function handleError(e: unknown, requestSessionGeneration: number) {
    switch (groupErrorCode(e)) {
      // 참여 상한은 참가뿐 아니라 **생성 경로에도** 걸린다(서버 ensureJoinedGroupLimit).
      // 공통 문구로 떨어뜨리면 '잠시 후 다시 시도'가 되는데, 시간이 지나도 절대 풀리지 않는
      // 조건이라 사용자가 재시도만 반복한다 — 상한이라는 사실과 숫자를 그대로 알려준다.
      case 'GROUP_LIMIT_EXCEEDED':
        Alert.alert(
          '더 이상 만들 수 없어요',
          `참여할 수 있는 그룹 수를 초과했어요(최대 ${GROUP_LIMIT}개)`,
        );
        return;
      // 유저 행 부재(탈퇴 후 토큰 잔존 등) — #516이 403→404 NOT_FOUND로 정정한 판정.
      // 문구·형태·로그아웃 유도는 services/sessionErrors.ts가 정본으로 들고 있다(GROMO-1241).
      // ⚠️ 신구 코드를 **병기**한다 — 서버가 유저 부재를 USER_NOT_FOUND로 나누기 전에 앱이 먼저
      //    배포되므로, NOT_FOUND를 떼면 서버 배포 전까지 이 재로그인 유도가 조용히 죽는다.
      case 'NOT_FOUND':
      case USER_NOT_FOUND:
        promptSessionExpired(requestSessionGeneration);
        return;
      default: {
        const status = axios.isAxiosError(e) ? e.response?.status : undefined;
        if (status === 400) {
          // 앱이 막지 못한 검증 실패 — 자유 입력은 이름뿐이라 이름을 짚어준다.
          setNameError('그룹 이름을 다시 확인해주세요');
          return;
        }
        Alert.alert('그룹을 만들지 못했어요', '잠시 후 다시 시도해주세요.');
      }
    }
  }

  async function submit() {
    // 버튼이 disabled={!canSubmit}라 여기 걸리는 경로는 없다 — 연타 방어로만 남긴다.
    // (예전엔 '그룹 이름을 입력해주세요'를 세웠지만 도달 불가라 화면에 뜬 적이 없다.)
    if (!canSubmit) return;
    submittingRef.current = true;
    setSubmitting(true);
    setNameError(null);
    logGroupCreateSubmitted({ entry_point: entryPoint, is_private: isPrivate });
    // 요청을 띄우기 직전의 인증 세대 — 응답이 오는 사이(그리고 안내를 확인하는 사이) 세션이
    // 교체되면 이 응답의 로그아웃은 새 세션에 적용되면 안 된다(sessionErrors.ts 주석).
    const requestSessionGeneration = getAuthSessionGeneration();
    try {
      const { groupId } = await createGroup({
        name: trimmedName,
        // 소개는 선택 — 빈 값이면 키 자체를 생략한다(서버 ≤ 200자).
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
        maxMembers,
        isPrivate,
      });
      logGroupCreated({ entry_point: entryPoint, is_private: isPrivate });
      // 서버가 실제 groupId를 준 뒤에만 계정×그룹 로컬 설정을 만든다. 저장 실패는 이미 성공한
      // 그룹 생성을 취소하거나 create API body를 바꾸지 않는다.
      let localSaveFailed = false;
      if (userId) {
        try {
          await writeGroupCardEmoji(userId, groupId, cardEmoji);
          logGroupCardIconSaveResult({ surface: 'create', result: 'success' });
        } catch {
          preservePendingGroupCardEmoji(userId, groupId, cardEmoji);
          logGroupCardIconSaveResult({ surface: 'create', result: 'failed' });
          setEmojiSaveFailed(true);
          localSaveFailed = true;
        }
      }
      // 생성이 끝났으므로 이탈 차단을 먼저 푼다 — 아래 goBack()도 beforeRemove를 지나간다.
      submittingRef.current = false;
      // 비공개는 링크가 유일한 입구라 공유 다이얼로그를 반드시 거친다. 공개는 바로 돌아간다.
      if (isPrivate) {
        setCreated({ id: groupId, name: trimmedName });
      } else if (localSaveFailed) {
        // 생성은 이미 성공했다. 폼에 inline 오류와 단일 복귀 경로를 남겨 중복 생성을 막는다.
        setCreatedPublicGroupId(groupId);
      } else {
        navigation.goBack();
      }
    } catch (e) {
      handleError(e, requestSessionGeneration);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  // 서버 발급 링크 확보 — 실패하면 안내하고 null. 앱이 링크를 조립하던 폴백은 폐기했다
  // (slug 없는 주소는 서버가 모르는 링크라 404로 끝난다 — 초대 링크 스펙 §7-4).
  async function resolveInviteLink(groupId: string): Promise<{ slug: string; url: string } | null> {
    if (inviteRef.current) return inviteRef.current;
    try {
      const issued = await issueInviteLink(groupId);
      inviteRef.current = issued;
      return issued;
    } catch {
      Alert.alert('초대 링크를 만들지 못했어요', '잠시 후 다시 시도해주세요.');
      return null;
    }
  }

  async function copyLink() {
    if (!created) return;
    const invite = await resolveInviteLink(created.id);
    if (!invite) return;
    Clipboard.setString(invite.url);
    setCopied(true);
    logGroupInviteShared({
      share_method: 'copy',
      confirmed: true,
      slug: invite.slug,
      group_id: created.id,
    });
    // 2초 뒤 '링크 복사'로 되돌린다 — 다이얼로그가 닫힐 때까지 고정돼 있으면
    // 두 번째 복사가 가능한지 알 수 없다.
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }

  async function shareLink() {
    if (!created) return;
    const invite = await resolveInviteLink(created.id);
    if (!invite) return;
    try {
      const result = await Share.share({
        // 이름은 현재 입력값이 아니라 생성 요청에 실어 보낸 값 — 둘이 갈리면 초대 문구가 거짓말이 된다.
        message: buildInviteShareMessage(created.name, invite.url),
      });
      // 취소 구분은 iOS에서만 가능하다 — 안드로이드는 시트를 닫아도 sharedAction으로 끝나므로
      // 완료로 집계하지 않고 confirmed:false(공유 시도)로 남긴다(analyticsEvents 주석).
      if (result.action === Share.sharedAction) {
        logGroupInviteShared({
          share_method: 'share_sheet',
          confirmed: Platform.OS === 'ios',
          slug: invite.slug,
          group_id: created.id,
        });
      }
    } catch {
      Alert.alert('공유하지 못했어요', '링크 복사로 대신 공유해주세요.');
    }
  }

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="group.create.screen">
      {/* 헤더 — 원형 백버튼 + 좌측 정렬 제목(FriendAddScreen 관행, §5-1) */}
      <View style={s.header}>
        {/* 생성 요청 중에는 비활성 — 눌러도 beforeRemove가 막으므로 버튼도 함께 잠가 이유를 보여준다 */}
        <TouchableOpacity
          style={[s.backBtn, submitting ? s.backBtnOff : null]}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          disabled={submitting}
          accessibilityLabel="뒤로"
        >
          <Ionicons name="chevron-back" size={18} color={T.inkSub} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>그룹 만들기</Text>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* ── 그룹 이름 ── */}
        <Text style={s.label}>그룹 이름</Text>
        <View style={[s.inputBox, nameError ? s.inputBoxError : null]}>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={(v) => {
              setName(v);
              if (nameError) setNameError(null);
            }}
            placeholder="예) 아침 6시 집중방"
            placeholderTextColor={T.inkMuted}
            maxLength={NAME_MAX}
            returnKeyType="done"
          />
          <Text style={s.counter}>
            {name.length}/{NAME_MAX}
          </Text>
        </View>
        {nameError ? <Text style={s.errorText}>{nameError}</Text> : null}

        {/* ── 소개 (선택) — 멀티라인 입력. 빈 값이면 생성 body에서 키를 생략한다(§D18) ── */}
        <Text style={s.label}>소개</Text>
        <View style={s.descBox}>
          <TextInput
            style={s.descInput}
            value={description}
            onChangeText={setDescription}
            placeholder="예) 매일 아침 함께 집중하는 그룹이에요 (선택)"
            placeholderTextColor={T.inkMuted}
            maxLength={DESCRIPTION_MAX}
            multiline
            textAlignVertical="top"
          />
        </View>
        <Text style={s.descCounter}>
          {description.length}/{DESCRIPTION_MAX}
        </Text>

        {/* ── 정원 — 스텝퍼 ── */}
        <Text style={s.label}>정원</Text>
        <View style={s.row}>
          <Text style={s.rowLabel}>최대 인원</Text>
          <View style={s.stepper}>
            <TouchableOpacity
              style={[s.stepBtn, maxMembers <= MEMBERS_MIN ? s.stepBtnOff : null]}
              activeOpacity={0.7}
              disabled={maxMembers <= MEMBERS_MIN}
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

        {/* ── 공개 설정 — 세그먼트 + 캡션(참여 경로가 갈린다) ── */}
        <Text style={s.label}>공개 설정</Text>
        <View style={s.segment}>
          {[false, true].map((v) => {
            const on = isPrivate === v;
            return (
              <TouchableOpacity
                key={v ? 'private' : 'public'}
                style={[s.segBtn, on ? s.segBtnOn : null]}
                activeOpacity={0.8}
                onPress={() => setIsPrivate(v)}
              >
                <Text style={[s.segText, on ? s.segTextOn : null]}>{v ? '비공개' : '공개'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={s.note}>
          <Ionicons
            name={isPrivate ? 'lock-closed' : 'search'}
            size={15}
            color={T.accent}
            style={s.noteIcon}
          />
          <Text style={s.noteText}>
            {isPrivate ? VISIBILITY_CAPTION.private : VISIBILITY_CAPTION.public}
          </Text>
        </View>

        <Text style={s.label}>내 카드 아이콘</Text>
        <GroupCardEmojiPicker
          value={cardEmoji}
          onChange={setCardEmoji}
          testIDPrefix="group.create.cardEmoji"
          disabled={submitting || createdPublicGroupId !== null}
        />
        {emojiSaveFailed && (
          <Text style={s.errorText} accessibilityLiveRegion="polite">
            내 카드 아이콘을 저장하지 못했어요. 앱을 다시 열면 이전 아이콘으로 돌아갈 수 있어요.
          </Text>
        )}

        {createdPublicGroupId && (
          <TouchableOpacity
            style={s.outlineDoneButton}
            activeOpacity={0.85}
            onPress={() => navigation.goBack()}
            testID="group.create.cardEmoji.continue"
          >
            <Text style={s.outlineDoneText}>그룹으로 돌아가기</Text>
          </TouchableOpacity>
        )}

        {/* ── CTA ── */}
        <TouchableOpacity
          style={[s.submitBtn, canSubmit && createdPublicGroupId === null ? null : s.submitBtnOff]}
          activeOpacity={0.85}
          disabled={!canSubmit || createdPublicGroupId !== null}
          onPress={submit}
          testID="group.create.submit"
        >
          {submitting ? (
            <ActivityIndicator color={T.white} />
          ) : (
            <Text style={s.submitText}>만들기</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* 초대 링크 다이얼로그 — 비공개방은 링크 없이는 아무도 못 들어오므로 생성 직후 반드시 띄운다(§6-2) */}
      <Modal
        visible={created !== null}
        transparent
        animationType="fade"
        onRequestClose={() => navigation.goBack()}
      >
        <View style={s.overlay}>
          <View style={s.card}>
            <Text style={s.cardTitle}>비공개 그룹을 만들었어요 🎉</Text>
            <Text style={s.cardBody}>검색에 뜨지 않아요.{'\n'}초대 링크를 공유해주세요.</Text>
            {emojiSaveFailed && (
              <Text style={s.errorText} accessibilityLiveRegion="polite">
                내 카드 아이콘을 저장하지 못했어요. 앱을 다시 열면 이전 아이콘으로 돌아갈 수 있어요.
              </Text>
            )}
            <View style={s.cardActions}>
              <TouchableOpacity style={s.cardOutlineBtn} activeOpacity={0.85} onPress={copyLink}>
                <Text style={s.cardOutlineText}>{copied ? '복사했어요' : '링크 복사'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.cardFillBtn} activeOpacity={0.85} onPress={shareLink}>
                <Text style={s.cardFillText}>공유하기</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={s.cardConfirmBtn}
              activeOpacity={0.7}
              onPress={() => navigation.goBack()}
            >
              <Text style={s.cardConfirmText}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  backBtnOff: { opacity: 0.5 },
  headerTitle: { ...T.text.heading, fontWeight: '800', color: T.ink },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: T.space.xl, paddingBottom: 40 },

  label: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    marginTop: T.space.xl,
    marginBottom: T.space.sm,
  },

  // 이름 입력
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.border,
    borderRadius: 13,
    paddingHorizontal: T.space.md,
    // 46 = 찾기 시트 검색 인풋·FriendAddScreen과 같은 값(앱 내 유일하게 50이던 것을 맞춤)
    minHeight: 46,
    paddingVertical: T.space.md,
  },
  inputBoxError: { borderColor: T.dangerInk, backgroundColor: T.dangerBg },
  input: { ...T.text.label, flex: 1, color: T.ink, padding: 0 },
  counter: { ...T.text.caption, color: T.inkMuted, fontVariant: ['tabular-nums'] },
  errorText: { ...T.text.caption, color: T.dangerInk, marginTop: T.space.xs },

  // 소개 입력(멀티라인) — 이름 인풋과 같은 테두리 규격, 높이만 키운다
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

  // 정원 스텝퍼(뽀모도로 설정 시트와 같은 형태)
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

  // 공개 설정 세그먼트(리그 탭 세그먼트와 같은 형태)
  segment: {
    flexDirection: 'row',
    backgroundColor: T.track,
    borderRadius: 12,
    padding: T.space.xs,
    gap: T.space.xs,
  },
  segBtn: { flex: 1, paddingVertical: T.space.sm, borderRadius: 9, alignItems: 'center' },
  segBtnOn: {
    backgroundColor: T.white,
    shadowColor: T.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segText: { ...T.text.label, color: T.inkSub },
  segTextOn: { color: T.ink, fontWeight: '700' },

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

  // 화면 CTA = 52 / r16 (그룹 3화면 공통 규격). marginTop 28은 8pt 그리드 밖이라 토큰으로 내렸다.
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
  outlineDoneButton: {
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: T.white,
    marginTop: T.space.lg,
  },
  outlineDoneText: { ...T.text.subtitle, color: T.ink },

  // 초대 링크 다이얼로그 — 탈퇴 확인 모달과 같은 스크림·카드 규격
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: withAlpha(T.night.bottom, 0.5),
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: T.paperLight,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 20,
    paddingHorizontal: T.space.xxl,
    paddingTop: T.space.xxl,
    paddingBottom: T.space.md,
  },
  cardTitle: { ...T.text.heading, color: T.ink },
  cardBody: { ...T.text.body, color: T.inkSub, marginTop: T.space.md },
  cardActions: { flexDirection: 'row', gap: T.space.sm, marginTop: T.space.xl },
  cardOutlineBtn: {
    flex: 1,
    minHeight: 48,
    paddingVertical: T.space.md,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
  },
  cardOutlineText: { ...T.text.label, fontWeight: '700', color: T.ink },
  cardFillBtn: {
    flex: 1,
    minHeight: 48,
    paddingVertical: T.space.md,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  cardFillText: { ...T.text.label, fontWeight: '700', color: T.white },
  cardConfirmBtn: { paddingVertical: T.space.lg, alignItems: 'center' },
  cardConfirmText: { ...T.text.label, color: T.inkSub },
});
