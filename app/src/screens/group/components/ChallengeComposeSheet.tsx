import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';
import { DrumPicker } from '@/components/DrumPicker';
import {
  CHALLENGE_DUPLICATE,
  CHALLENGE_WINDOW_OVERLAP,
  createChallenge,
  groupErrorCode,
} from '@/services/groupApi';
import { logGroupChallengeCreated } from '@/services/analyticsEvents';
import { todayStr } from '@/utils/localDate';
import type { CreateChallengeRequest, MissionCategory, MissionType } from '@/types/dto/group';

// 챌린지 만들기 시트(방장만) — 명세 docs/app/group-plan-2.md §3-2,
// 확장 계약 docs/app/challenge-impl-2026-08/contract.md §2 "앱 UI 계약".
//
// 폼 4필드: 카테고리 세그먼트(집중 시간/스크린타임) + 방식 세그먼트(매일 목표/시간대)
// + (시간대일 때) 창 시작·종료 시각 휠 + 목표분 칩. 규격은 그룹 만들기 화면의 세그먼트·칩,
// 집중 목표의 DrumPicker를 그대로 따른다 — 같은 값을 고르는 자리가 달라 보이면 안 된다.
//
// ⚠️ 전송 계약(계약 §2): TIME_WINDOW는 durationMinutes 필수(0 < x ≤ 창 길이) +
//    windowStart/windowEnd(ISO, KST 앵커 — 서버는 시각만 읽는 '매일 반복 시간대'다).
// ⚠️ 동시 활성 제한은 **카테고리×방식 조합당 1개**(그룹당 최대 4개, V20 유니크 인덱스) —
//    조합 매트릭스로 세그먼트를 잠근다. 서버가 막는 조합을 애초에 못 고르게 한다.
// ⚠️ SCREEN_TIME 생성 시 응답 nonParticipants에 권한 미허용 멤버가 담겨 온다 —
//    만들어지긴 했지만 그 사람들은 집계되지 않으므로 방장에게 반드시 알린다.

// 목표 시간(분) — 그룹 만들기 화면의 DURATION_OPTIONS와 같은 4단(§3-2).
const DURATION_OPTIONS = [30, 60, 120, 180] as const;
const DURATION_DEFAULT = 60;

// 창 기본값 09:00~12:00 — 계약 예시의 시간대이자 목표분 4단이 전부 들어가는 최소 길이(180분)다.
const WINDOW_START_DEFAULT = 9 * 60;
const WINDOW_END_DEFAULT = 12 * 60;
// 창 시각 휠의 분 단위 — 집중 목표 휠(DurationDrumPicker)과 같은 5분 눈금.
const MINUTE_STEP = 5;

const HOUR_ITEMS = Array.from({ length: 24 }, (_, h) => `${h}시`);
const MINUTE_ITEMS = Array.from(
  { length: 60 / MINUTE_STEP },
  (_, i) => `${String(i * MINUTE_STEP).padStart(2, '0')}분`,
);

// durationLabel까지 카테고리에서 파생시킨다 — 그룹 만들기 화면과 같은 문구다(같은 값을
// 고르는 두 자리가 달라 보이면 안 된다는 이 파일의 전제를 라벨에도 적용).
const CATEGORY_OPTIONS: { value: MissionCategory; label: string; durationLabel: string }[] = [
  { value: 'FOCUS', label: '집중 시간', durationLabel: '하루 목표 집중 시간' },
  { value: 'SCREEN_TIME', label: '스크린타임', durationLabel: '하루 목표 스크린타임' },
];

// 방식 세그먼트 — DURATION은 '하루 전체', TIME_WINDOW는 '매일 반복되는 시간대'다.
const TYPE_OPTIONS: { value: MissionType; label: string }[] = [
  { value: 'DURATION', label: '매일 목표' },
  { value: 'TIME_WINDOW', label: '시간대' },
];

// 카테고리에 따라 목표의 뜻이 뒤집힌다(집중은 이상, 스크린타임은 이하) — 캡션으로 못 박는다.
const CATEGORY_CAPTION: Record<MissionCategory, string> = {
  FOCUS: '하루에 목표 시간 이상 집중하면 달성이에요',
  SCREEN_TIME: '하루 스크린타임을 목표 이하로 유지하면 달성이에요. 권한을 허용한 멤버만 참여해요',
};

// 시간대(TIME_WINDOW) 안내 — 계약이 문구까지 고정한 두 줄(contract.md §2 앱 UI 계약).
// FOCUS 창은 판정에 5분 관용치가 있고(서버 WINDOW_FOCUS_TOLERANCE), SCREEN_TIME 창은
// 15분 눈금 측정이라 오차·누락이 구조적으로 존재한다 — 돈이 걸릴 수 있는 판정 기준이라
// 만들기 전에 고지한다.
const WINDOW_FOCUS_CAPTION =
  '매일 정한 시간대 안에서 목표 시간 이상 집중하면 달성이에요. 목표에서 5분 모자라도 달성으로 인정돼요';
const WINDOW_SCREEN_TIME_CAPTION =
  '매일 정한 시간대 안에서 스크린타임을 목표 이하로 유지하면 달성이에요. ' +
  '권한을 허용한 멤버만 참여해요. ' +
  '사용 시간은 15분 단위로 집계돼 오차가 있을 수 있어요. 앱 버전이나 기기 상태에 따라 집계가 늦거나 누락될 수 있어요';

// SCREEN_TIME 생성 후 미참여자가 있을 때의 안내 — 생성 자체는 성공이므로 실패로 보이게 쓰지 않는다.
const NON_PARTICIPANT_MESSAGE = '일부 멤버는 스크린타임 권한이 없어 참여할 수 없어요';

// 이미 있는 조합을 고를 수 없는 이유 — 세그먼트 아래 한 줄로 알린다.
const TAKEN_CAPTION = '이미 있는 종류·방식은 기존 챌린지를 삭제해야 다시 만들 수 있어요';
const ALL_TAKEN_CAPTION = '모든 종류의 챌린지가 이미 있어요';
// 창이 최소 목표(30분)보다 짧다 — 목표 칩이 전부 잠기므로 CTA를 막고 사유를 적는다.
const WINDOW_TOO_SHORT_CAPTION = '시간대가 너무 짧아요. 30분 이상으로 늘려주세요';

// 생성 실패 문구 — HTTP status가 아니라 서버 code로 분기하고, 모르는 code는 공통 문구(§5-2).
function createErrorMessage(e: unknown): string {
  switch (groupErrorCode(e)) {
    case 'NOT_FOUND':
      return '사라진 그룹이에요.';
    case 'MEMBER_ONLY':
      return '그룹원만 이용할 수 있어요.';
    // 그룹 생성이 대표 챌린지를 항상 하나 만들기 때문에 이 충돌은 예외가 아니라 기본 상태다 —
    // 공통 문구로 떨어뜨리면 "다시 시도"를 반복해도 영원히 같은 실패만 본다.
    // ACTIVE_CHALLENGE_EXISTS(구서버)와 CHALLENGE_DUPLICATE(V20 유니크 인덱스)는 같은 사실이다.
    case 'ACTIVE_CHALLENGE_EXISTS':
    case CHALLENGE_DUPLICATE:
      return '이미 같은 종류의 챌린지가 있어요. 기존 챌린지를 삭제하고 만들어주세요.';
    // 다른 카테고리의 활성 창형과 창 시간대가 겹친다(계약 — 같은 시간대 행동 하나로 내기 2개
    // 중복 보상 차단). 시간대를 바꾸면 풀리는 실패라 해결 방법을 문장에 싣는다.
    case CHALLENGE_WINDOW_OVERLAP:
      return '다른 종류의 시간대 챌린지와 시간이 겹쳐요. 겹치지 않는 시간대로 바꿔주세요.';
    default:
      return '챌린지를 만들지 못했어요. 잠시 후 다시 시도해주세요.';
  }
}

// 'H*60+M'(하루 중 분) → 'HH:MM'.
function hhmmOf(minutesOfDay: number): string {
  const h = String(Math.floor(minutesOfDay / 60)).padStart(2, '0');
  const m = String(minutesOfDay % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// 창 시각 → ISO Instant 문자열. 날짜는 의미가 없고(서버는 KST 시각만 읽는다 — 계약 설계 보정
// '매일 반복 시간대') 오프셋을 +09:00으로 못 박아 기기 타임존과 무관하게 KST 시각이 보존되게 한다.
function kstWindowInstant(minutesOfDay: number): string {
  return `${todayStr()}T${hhmmOf(minutesOfDay)}:00+09:00`;
}

// 이미 있는(ACTIVE) 챌린지 — 조합(카테고리×방식) 잠금의 근거.
export interface ExistingChallengeCombo {
  category: MissionCategory;
  type: MissionType;
}

export interface ChallengeComposeSheetProps {
  groupId: string;
  // 이 그룹에 이미 있는(ACTIVE) 챌린지 — 부모가 challenges에서 파생해 넘긴다.
  // 서버가 카테고리×방식 중복을 409(CHALLENGE_DUPLICATE)로 막으므로, 애초에 실패할 조합을
  // 고를 수 없게 한다.
  // ⚠️ 하위 호환 유니온: 현재 부모(GroupRoomScreen — A3 전유라 이 배치에서 못 바꾼다)는
  //    카테고리 문자열만 넘긴다. 문자열은 {category, type: 'DURATION'}으로 해석한다 —
  //    구 만들기 경로가 DURATION만 만들었기 때문이다. 이 해석이 틀리는 경우(창형만 있는
  //    카테고리)는 서버 CHALLENGE_DUPLICATE 분기가 받아 낸다. 부모가 조합 객체를 넘기기
  //    시작하면(후속 1줄) 매트릭스가 정확해진다.
  existingCategories: (MissionCategory | ExistingChallengeCombo)[];
  onClose: () => void;
  // 생성 성공 — 부모가 시트를 닫고 챌린지 목록을 재조회한다.
  onCreated: () => void;
}

export default function ChallengeComposeSheet({
  groupId,
  existingCategories,
  onClose,
  onCreated,
}: ChallengeComposeSheetProps) {
  // 조합 매트릭스로 정규화 — 문자열(구 부모)은 DURATION 점유로 해석한다(위 prop 주석).
  const takenCombos = existingCategories.map(
    (e): ExistingChallengeCombo => (typeof e === 'string' ? { category: e, type: 'DURATION' } : e),
  );
  const isTaken = (category: MissionCategory, type: MissionType): boolean =>
    takenCombos.some((c) => c.category === category && c.type === type);
  const categoryFullyTaken = (category: MissionCategory): boolean =>
    TYPE_OPTIONS.every((t) => isTaken(category, t.value));
  // 만들 수 있는 조합이 하나도 없다 — 세그먼트를 전부 잠그고 CTA도 막는다.
  const allTaken = CATEGORY_OPTIONS.every((o) => categoryFullyTaken(o.value));

  // 초기 선택은 **비어 있는 조합** — 기본값(FOCUS×매일 목표)을 고수하면 대표 챌린지와 항상
  // 충돌한다. 전부 차 있으면 아무거나 둬도 만들 수 없으므로(CTA를 막는다) 첫 항목으로 둔다.
  const [missionCategory, setMissionCategory] = useState<MissionCategory>(() => {
    for (const c of CATEGORY_OPTIONS) {
      if (!categoryFullyTaken(c.value)) return c.value;
    }
    return CATEGORY_OPTIONS[0].value;
  });
  const [missionType, setMissionType] = useState<MissionType>(() => {
    for (const c of CATEGORY_OPTIONS) {
      for (const t of TYPE_OPTIONS) {
        if (!isTaken(c.value, t.value)) return t.value;
      }
    }
    return TYPE_OPTIONS[0].value;
  });
  const [durationMinutes, setDurationMinutes] = useState<number>(DURATION_DEFAULT);
  // 창 시작·종료 — '하루 중 분'(0~1439). 자정 걸침은 서버가 400으로 거부하므로(start < end)
  // 휠 단계에서 뒤집힌 선택을 거부한다(DrumPicker의 값 거부 동작 — 휠이 제자리로 돌아간다).
  const [windowStart, setWindowStart] = useState(WINDOW_START_DEFAULT);
  const [windowEnd, setWindowEnd] = useState(WINDOW_END_DEFAULT);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 생성 단일 실행 잠금 — submitting(state)은 리렌더 뒤에야 보이므로 같은 틱의 연타를 막지 못한다.
  // V20 유니크 인덱스가 서버 레이스를 봉합했지만, 두 번째 요청이 409로 튕겨 성공 시트 위에
  // 에러가 뜨는 혼선은 앱이 막는다(GroupInviteSheet의 joinLock과 같은 패턴).
  const submitLock = useRef(false);

  const isWindow = missionType === 'TIME_WINDOW';
  const windowLength = windowEnd - windowStart;
  // 창 길이를 넘는 목표는 서버가 INVALID_MISSION_PARAMS로 거부한다 — 칩을 미리 잠근다.
  const chipDisabled = (m: number): boolean => isWindow && m > windowLength;
  const noChipFits = isWindow && DURATION_OPTIONS.every((m) => m > windowLength);

  const categoryOption =
    CATEGORY_OPTIONS.find((c) => c.value === missionCategory) ?? CATEGORY_OPTIONS[0];
  const durationLabel = isWindow ? '시간대 안 목표 시간' : categoryOption.durationLabel;
  const noteText = isWindow
    ? missionCategory === 'SCREEN_TIME'
      ? WINDOW_SCREEN_TIME_CAPTION
      : WINDOW_FOCUS_CAPTION
    : CATEGORY_CAPTION[missionCategory];

  // 카테고리를 바꾸면 그 카테고리에서 막힌 방식을 피해 준다 — 잠긴 세그먼트가 선택된 채로
  // 남으면 CTA만 막히고 왜 안 되는지 알 수 없다.
  function pickCategory(category: MissionCategory) {
    setMissionCategory(category);
    if (isTaken(category, missionType)) {
      const free = TYPE_OPTIONS.find((t) => !isTaken(category, t.value));
      if (free) setMissionType(free.value);
    }
  }

  // 창 시각 커밋 — 시작 ≥ 종료가 되는 선택은 거부한다(휠이 제자리로 돌아간다).
  // 자정 걸침 창은 v1 범위 밖이다 — 서버도 windowEnd.isAfter(windowStart)를 강제해
  // 400(INVALID_MISSION_PARAMS)으로 거절한다(GroupChallengeService.createChallenge 검증).
  // 커밋 후 현재 목표분이 창보다 길어지면 들어가는 가장 큰 칩으로 당긴다 —
  // 잠긴 칩이 선택된 채 CTA만 막히는 상태를 만들지 않는다.
  function commitWindow(start: number, end: number) {
    if (start >= end) return;
    setWindowStart(start);
    setWindowEnd(end);
    const length = end - start;
    if (durationMinutes > length) {
      const fit = [...DURATION_OPTIONS].reverse().find((m) => m <= length);
      if (fit) setDurationMinutes(fit);
    }
  }

  async function submit() {
    // 생성 중 중복 탭 방지 — 판정은 ref로만 한다(submitting은 스피너·disabled 표시 전용).
    if (submitLock.current || allTaken || (isWindow && chipDisabled(durationMinutes))) return;
    submitLock.current = true;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const body: CreateChallengeRequest = isWindow
        ? {
            missionCategory,
            missionType,
            durationMinutes,
            windowStart: kstWindowInstant(windowStart),
            windowEnd: kstWindowInstant(windowEnd),
          }
        : { missionCategory, missionType, durationMinutes };
      const { nonParticipants } = await createChallenge(groupId, body);
      logGroupChallengeCreated({
        mission_type: missionType,
        mission_category: missionCategory,
        duration_minutes: durationMinutes,
        has_window: isWindow,
      });
      // 안내는 시트가 닫힌 뒤에도 남는 Alert로 띄운다 — 시트 안 문구로 두면 곧 사라진다.
      if (nonParticipants.length > 0) {
        Alert.alert('챌린지를 만들었어요', NON_PARTICIPANT_MESSAGE);
      }
      onCreated();
    } catch (e) {
      // 실패했을 때만 잠금을 푼다 — 성공 경로는 onCreated가 시트를 닫으므로 잠긴 채 끝낸다.
      submitLock.current = false;
      setErrorMsg(createErrorMessage(e));
      setSubmitting(false);
    }
  }

  const submitBlocked = submitting || allTaken || (isWindow && chipDisabled(durationMinutes));

  return (
    // 생성 중에는 딤 탭으로 닫히지 않게 막는다(요청이 떠 있는 상태에서의 언마운트 방지).
    <SheetShell onClose={submitting ? () => {} : onClose} asModal>
      <Text style={s.title}>챌린지 만들기</Text>
      <Text style={s.sub}>그룹원 모두가 오늘부터 함께해요.</Text>

      <Text style={s.label}>챌린지 종류</Text>
      <View style={s.segment}>
        {CATEGORY_OPTIONS.map((opt) => {
          const taken = categoryFullyTaken(opt.value);
          const on = !taken && missionCategory === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[s.segBtn, on ? s.segBtnOn : null]}
              activeOpacity={0.8}
              disabled={taken}
              onPress={() => pickCategory(opt.value)}
            >
              <Text style={[s.segText, on ? s.segTextOn : null, taken ? s.segTextOff : null]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={s.label}>챌린지 방식</Text>
      <View style={s.segment}>
        {TYPE_OPTIONS.map((opt) => {
          const taken = isTaken(missionCategory, opt.value);
          const on = !taken && missionType === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[s.segBtn, on ? s.segBtnOn : null]}
              activeOpacity={0.8}
              disabled={taken}
              onPress={() => setMissionType(opt.value)}
              testID={`group.challenge.type.${opt.value}`}
            >
              <Text style={[s.segText, on ? s.segTextOn : null, taken ? s.segTextOff : null]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {takenCombos.length > 0 && (
        <Text style={s.takenCaption}>{allTaken ? ALL_TAKEN_CAPTION : TAKEN_CAPTION}</Text>
      )}

      {isWindow && (
        <>
          <Text style={s.label}>시간대 설정 (한국 시간 기준)</Text>
          <View style={s.windowRow}>
            <View style={s.windowCol}>
              <DrumPicker
                items={HOUR_ITEMS}
                selectedIndex={Math.floor(windowStart / 60)}
                onChange={(h) => commitWindow(h * 60 + (windowStart % 60), windowEnd)}
              />
            </View>
            <View style={s.windowCol}>
              <DrumPicker
                items={MINUTE_ITEMS}
                selectedIndex={(windowStart % 60) / MINUTE_STEP}
                onChange={(i) =>
                  commitWindow(Math.floor(windowStart / 60) * 60 + i * MINUTE_STEP, windowEnd)
                }
              />
            </View>
            <Text style={s.windowTilde}>~</Text>
            <View style={s.windowCol}>
              <DrumPicker
                items={HOUR_ITEMS}
                selectedIndex={Math.floor(windowEnd / 60)}
                onChange={(h) => commitWindow(windowStart, h * 60 + (windowEnd % 60))}
              />
            </View>
            <View style={s.windowCol}>
              <DrumPicker
                items={MINUTE_ITEMS}
                selectedIndex={(windowEnd % 60) / MINUTE_STEP}
                onChange={(i) =>
                  commitWindow(windowStart, Math.floor(windowEnd / 60) * 60 + i * MINUTE_STEP)
                }
              />
            </View>
          </View>
        </>
      )}

      <Text style={s.label}>{durationLabel}</Text>
      <View style={s.chips}>
        {DURATION_OPTIONS.map((m) => {
          const off = chipDisabled(m);
          const on = !off && durationMinutes === m;
          return (
            <TouchableOpacity
              key={m}
              style={[s.chip, on ? s.chipOn : null, off ? s.chipOffBox : null]}
              activeOpacity={0.8}
              disabled={off}
              onPress={() => setDurationMinutes(m)}
              testID={`group.challenge.duration.${m}`}
            >
              <Text style={[s.chipText, on ? s.chipTextOn : null, off ? s.chipTextOff : null]}>
                {m}분
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {noChipFits && <Text style={s.error}>{WINDOW_TOO_SHORT_CAPTION}</Text>}

      <View style={s.note}>
        <Ionicons
          name={missionCategory === 'SCREEN_TIME' ? 'phone-portrait' : 'flag'}
          size={15}
          color={T.accent}
          style={s.noteIcon}
        />
        <Text style={s.noteText}>{noteText}</Text>
      </View>

      {errorMsg !== null && <Text style={s.error}>{errorMsg}</Text>}

      <TouchableOpacity
        style={[s.submitBtn, submitBlocked && s.submitBtnOff]}
        activeOpacity={0.85}
        disabled={submitBlocked}
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
  // 이미 있는 조합 — 고를 수 없다는 것을 색으로 먼저 알린다(터치는 disabled로 막았다).
  segTextOff: { color: T.inkFaint, fontWeight: '500' },
  takenCaption: { ...T.text.caption, fontWeight: '500', color: T.inkMuted, marginTop: T.space.sm },

  // 창 시각 휠 — 시작(시·분) ~ 종료(시·분). 집중 목표 휠(DurationDrumPicker)과 같은 부품이라
  // 높이·타이포가 자동으로 맞는다.
  windowRow: { flexDirection: 'row', alignItems: 'center' },
  windowCol: { flex: 1 },
  windowTilde: { ...T.text.label, color: T.inkMuted, paddingHorizontal: T.space.xs },

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
  // 창 길이를 넘는 목표 칩 — 눌리지 않는 이유가 보이게 CTA off와 같은 0.5로 흐린다.
  chipOffBox: { opacity: 0.5 },
  chipText: { ...T.text.label, color: T.inkSub },
  chipTextOn: { color: T.accentDeep, fontWeight: '700' },
  chipTextOff: { color: T.inkFaint, fontWeight: '500' },

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
