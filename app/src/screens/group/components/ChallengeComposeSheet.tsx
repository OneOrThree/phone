import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import { createChallenge, groupErrorCode } from '@/services/groupApi';
import type { MissionCategory } from '@/types/dto/group';

// 챌린지 만들기 시트(방장만) — 명세 docs/app/group-plan-2.md §3-2.
//
// 폼 2필드: 카테고리 세그먼트(집중 시간/스크린타임) + 목표분 칩. 규격은 그룹 만들기 화면의
// 세그먼트·칩을 그대로 따른다 — 같은 값을 고르는 두 자리가 달라 보이면 안 된다.
//
// ⚠️ 전송 계약(백 명세 §1-2): missionType은 항상 'DURATION'이다.
//    TIME_WINDOW는 서버가 진행률을 지원하지 않아(백 명세 결정 3) 생성 경로 자체를 열지 않는다.
// ⚠️ SCREEN_TIME 생성 시 응답 nonParticipants에 권한 미허용 멤버가 담겨 온다 —
//    만들어지긴 했지만 그 사람들은 집계되지 않으므로 방장에게 반드시 알린다.

// 목표 시간(분) — 그룹 만들기 화면의 DURATION_OPTIONS와 같은 4단(§3-2).
const DURATION_OPTIONS = [30, 60, 120, 180] as const;
const DURATION_DEFAULT = 60;

const CATEGORY_OPTIONS: { value: MissionCategory; label: string }[] = [
  { value: 'FOCUS', label: '집중 시간' },
  { value: 'SCREEN_TIME', label: '스크린타임' },
];

// 카테고리에 따라 목표의 뜻이 뒤집힌다(집중은 이상, 스크린타임은 이하) — 캡션으로 못 박는다.
const CATEGORY_CAPTION: Record<MissionCategory, string> = {
  FOCUS: '하루에 목표 시간 이상 집중하면 달성이에요',
  SCREEN_TIME: '하루 스크린타임을 목표 이하로 유지하면 달성이에요. 권한을 허용한 멤버만 참여해요',
};

// SCREEN_TIME 생성 후 미참여자가 있을 때의 안내 — 생성 자체는 성공이므로 실패로 보이게 쓰지 않는다.
const NON_PARTICIPANT_MESSAGE = '일부 멤버는 스크린타임 권한이 없어 참여할 수 없어요';

// 생성 실패 문구 — HTTP status가 아니라 서버 code로 분기하고, 모르는 code는 공통 문구(§5-2).
// 중복 생성 등 앱이 별도 안내를 만들 수 없는 code는 일부러 공통 문구로 떨어뜨린다.
function createErrorMessage(e: unknown): string {
  switch (groupErrorCode(e)) {
    case 'NOT_FOUND':
      return '사라진 그룹이에요.';
    case 'MEMBER_ONLY':
      return '그룹원만 이용할 수 있어요.';
    default:
      return '챌린지를 만들지 못했어요. 잠시 후 다시 시도해주세요.';
  }
}

export interface ChallengeComposeSheetProps {
  groupId: string;
  onClose: () => void;
  // 생성 성공 — 부모가 시트를 닫고 챌린지 목록을 재조회한다.
  onCreated: () => void;
}

export default function ChallengeComposeSheet({
  groupId,
  onClose,
  onCreated,
}: ChallengeComposeSheetProps) {
  const [missionCategory, setMissionCategory] = useState<MissionCategory>('FOCUS');
  const [durationMinutes, setDurationMinutes] = useState<number>(DURATION_DEFAULT);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function submit() {
    // 생성 중 중복 탭 방지 — 서버가 중복을 막긴 하지만 두 번째 요청은 에러 문구만 남긴다.
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const { nonParticipants } = await createChallenge(groupId, {
        missionCategory,
        missionType: 'DURATION',
        durationMinutes,
      });
      // 안내는 시트가 닫힌 뒤에도 남는 Alert로 띄운다 — 시트 안 문구로 두면 곧 사라진다.
      if (nonParticipants.length > 0) {
        Alert.alert('챌린지를 만들었어요', NON_PARTICIPANT_MESSAGE);
      }
      onCreated();
    } catch (e) {
      setErrorMsg(createErrorMessage(e));
      setSubmitting(false);
    }
  }

  return (
    // 생성 중에는 딤 탭으로 닫히지 않게 막는다(요청이 떠 있는 상태에서의 언마운트 방지).
    <SheetShell onClose={submitting ? () => {} : onClose} asModal>
      <Text style={s.title}>챌린지 만들기</Text>
      <Text style={s.sub}>그룹원 모두가 오늘부터 함께해요.</Text>

      <Text style={s.label}>챌린지 종류</Text>
      <View style={s.segment}>
        {CATEGORY_OPTIONS.map((opt) => {
          const on = missionCategory === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[s.segBtn, on ? s.segBtnOn : null]}
              activeOpacity={0.8}
              onPress={() => setMissionCategory(opt.value)}
            >
              <Text style={[s.segText, on ? s.segTextOn : null]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={s.label}>하루 목표</Text>
      <View style={s.chips}>
        {DURATION_OPTIONS.map((m) => {
          const on = durationMinutes === m;
          return (
            <TouchableOpacity
              key={m}
              style={[s.chip, on ? s.chipOn : null]}
              activeOpacity={0.8}
              onPress={() => setDurationMinutes(m)}
            >
              <Text style={[s.chipText, on ? s.chipTextOn : null]}>{m}분</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={s.note}>
        <Ionicons
          name={missionCategory === 'SCREEN_TIME' ? 'phone-portrait' : 'flag'}
          size={15}
          color={T.accent}
          style={s.noteIcon}
        />
        <Text style={s.noteText}>{CATEGORY_CAPTION[missionCategory]}</Text>
      </View>

      {errorMsg !== null && <Text style={s.error}>{errorMsg}</Text>}

      <TouchableOpacity
        style={[s.submitBtn, submitting && s.submitBtnOff]}
        activeOpacity={0.85}
        disabled={submitting}
        onPress={submit}
        testID="group.challenge.submit"
      >
        {submitting ? (
          <ActivityIndicator color={T.white} />
        ) : (
          <Text style={s.submitText}>만들기</Text>
        )}
      </TouchableOpacity>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  sub: { ...T.text.label, fontWeight: '500', color: T.inkMuted, marginTop: 2 },

  label: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    marginTop: T.space.lg,
    marginBottom: T.space.sm,
  },

  // 세그먼트·칩은 그룹 만들기 화면과 같은 규격(§G-4) — 같은 값을 고르는 자리라 형태를 맞춘다.
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

  chips: { flexDirection: 'row', gap: T.space.sm },
  chip: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.chipBg,
    borderWidth: 1,
    borderColor: T.chipBorder,
  },
  chipOn: { backgroundColor: T.accentBg, borderColor: T.accent },
  chipText: { ...T.text.label, color: T.inkSub },
  chipTextOn: { color: T.accentDeep, fontWeight: '700' },

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

  error: { ...T.text.caption, color: T.dangerInk, marginTop: T.space.md },

  // 시트 CTA = 52 / r16 (그룹 시트 공통 규격).
  submitBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.lg,
  },
  submitBtnOff: { opacity: 0.5 },
  submitText: { ...T.text.subtitle, color: T.white },
});
