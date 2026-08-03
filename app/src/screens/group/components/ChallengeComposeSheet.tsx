import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
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
// + (시간대일 때) 창 시작·종료 시각 휠 + 목표분(칩 프리셋 + 분 단위 직접 입력, GROMO-1098).
// 규격은 그룹 만들기 화면의 세그먼트·칩, 집중 목표의 DrumPicker, 그룹 찾기 시트의 인풋을
// 그대로 따른다 — 같은 값을 고르는 자리가 달라 보이면 안 된다.
//
// ⚠️ 전송 계약(계약 §2): TIME_WINDOW는 durationMinutes 필수(0 < x ≤ 창 길이) +
//    windowStart/windowEnd(ISO, KST 앵커 — 서버는 시각만 읽는 '매일 반복 시간대'다).
// ⚠️ 동시 활성 제한은 **카테고리×방식 조합당 1개**(그룹당 최대 4개, V20 유니크 인덱스) —
//    조합 매트릭스로 세그먼트를 잠근다. 서버가 막는 조합을 애초에 못 고르게 한다.
// ⚠️ SCREEN_TIME 생성 시 응답 nonParticipants에 권한 미허용 멤버가 담겨 온다 —
//    만들어지긴 했지만 그 사람들은 집계되지 않으므로 방장에게 반드시 알린다.

// 목표 시간(분) 빠른 선택 프리셋 — 그룹 만들기 화면의 DURATION_OPTIONS와 같은 4단(§3-2).
// 프리셋 밖 값은 아래 직접 입력으로 받는다(GROMO-1098) — 단일 소스는 durationText 하나다.
const DURATION_OPTIONS = [30, 60, 120, 180] as const;
const DURATION_DEFAULT = 60;
// 직접 입력 허용 범위 — 서버는 양수(0 < x)만 검증하므로 상한(하루 = 1440분)은 앱이 지킨다.
const DURATION_MIN = 1;
const DURATION_MAX = 1440;

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
// 직접 입력 검증 안내 — 범위 밖이면 CTA를 막고 사유를 인라인으로 적는다(막다른 상태 금지).
// 문구 결은 내기 시트의 참가비 안내("1~1,000코인 사이로 입력해 주세요")와 맞춘다.
const DURATION_RANGE_CAPTION = '목표 시간은 1~1,440분 사이로 입력해 주세요';
// 창 길이 초과는 기존 칩 잠금(chipDisabled)과 같은 사실이다 — 칩은 잠그면 끝이지만
// 직접 입력은 이미 쓴 값이 남으므로 고치는 방법(이하로 줄이기)을 문장에 싣는다.
const durationOverWindowCaption = (windowLength: number): string =>
  `시간대보다 길어요. ${windowLength}분 이하로 입력해 주세요`;

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
  // 목표 시간의 단일 소스 — 칩 탭도 이 문자열을 갱신하고, 칩 선택 표시도 이 문자열에서 파생한다.
  // 숫자가 아니라 문자열인 이유: "120"을 치는 중간 상태("1"·"12")와 빈 값을 잃지 않기 위해서다.
  const [durationText, setDurationText] = useState<string>(String(DURATION_DEFAULT));
  // 창 시작·종료 — '하루 중 분'(0~1439). 자정 걸침은 서버가 400으로 거부하므로(start < end)
  // 휠 단계에서 뒤집힌 선택을 거부한다(DrumPicker의 값 거부 동작 — 휠이 제자리로 돌아간다).
  const [windowStart, setWindowStart] = useState(WINDOW_START_DEFAULT);
  const [windowEnd, setWindowEnd] = useState(WINDOW_END_DEFAULT);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 키보드가 바텀시트를 덮는 문제 보정(GroupFindSheet와 같은 패턴) — 패널은 하단 고정이라
  // 자체적으로 올라가지 않는다. 자식 끝에 키보드 높이만큼 여백을 깔아 내용을 키보드 위로 올린다.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // 생성 단일 실행 잠금 — submitting(state)은 리렌더 뒤에야 보이므로 같은 틱의 연타를 막지 못한다.
  // V20 유니크 인덱스가 서버 레이스를 봉합했지만, 두 번째 요청이 409로 튕겨 성공 시트 위에
  // 에러가 뜨는 혼선은 앱이 막는다(GroupInviteSheet의 joinLock과 같은 패턴).
  const submitLock = useRef(false);

  const isWindow = missionType === 'TIME_WINDOW';
  const windowLength = windowEnd - windowStart;
  // 창 길이를 넘는 목표는 서버가 INVALID_MISSION_PARAMS로 거부한다 — 칩을 미리 잠근다.
  const chipDisabled = (m: number): boolean => isWindow && m > windowLength;

  // 직접 입력 파생값 — onChangeText가 숫자만 남기므로 정수 아님은 빈 값뿐이다.
  const durationMinutes = /^\d+$/.test(durationText) ? parseInt(durationText, 10) : null;
  const durationInRange =
    durationMinutes !== null && durationMinutes >= DURATION_MIN && durationMinutes <= DURATION_MAX;
  // 검증 통과 = 범위 안 + (시간대면) 창 길이 이하 — 칩 잠금(chipDisabled)과 같은 규칙이다.
  const durationValid =
    durationInRange && (!isWindow || (durationMinutes !== null && durationMinutes <= windowLength));
  // 인라인 안내 — 빈 값은 치우는 중일 뿐이라 빨간 줄을 띄우지 않는다(CTA만 잠근다.
  // 범위는 플레이스홀더가 상시 알려 준다).
  const durationCaption =
    durationText === '' || durationValid
      ? null
      : durationInRange
        ? durationOverWindowCaption(windowLength)
        : DURATION_RANGE_CAPTION;

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
  // 커밋 후 현재 목표분이 창보다 길어지면 창 길이로 당긴다(칩 스냅의 일반화 — 칩 값이면
  // 그 칩이 켜진다) — 초과 값이 남은 채 CTA만 막히는 상태를 만들지 않는다.
  function commitWindow(start: number, end: number) {
    if (start >= end) return;
    setWindowStart(start);
    setWindowEnd(end);
    const length = end - start;
    if (durationMinutes !== null && durationMinutes > length) {
      setDurationText(String(length));
    }
  }

  async function submit() {
    // 생성 중 중복 탭 방지 — 판정은 ref로만 한다(submitting은 스피너·disabled 표시 전용).
    // durationMinutes null 검사는 타입 좁히기용 — durationValid가 이미 배제한다.
    if (submitLock.current || allTaken || !durationValid || durationMinutes === null) return;
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

  const submitBlocked = submitting || allTaken || !durationValid;

  return (
    // 생성 중에는 딤 탭·그랩바 드래그로 닫히지 않게 막는다(요청이 떠 있는 상태에서의 언마운트 방지).
    <SheetShell onClose={submitting ? () => {} : onClose} asModal dismissible={!submitting}>
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
              onPress={() => setDurationText(String(m))}
              testID={`group.challenge.duration.${m}`}
            >
              <Text style={[s.chipText, on ? s.chipTextOn : null, off ? s.chipTextOff : null]}>
                {m}분
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {/* 분 단위 직접 입력(GROMO-1098) — 칩과 같은 값을 쓰는 한 소스다. 규격은 그룹 찾기
          시트·그룹 만들기 화면의 46pt 인풋 관행. */}
      <View style={[s.inputBox, durationCaption !== null ? s.inputBoxError : null]}>
        <TextInput
          style={s.input}
          value={durationText}
          // 숫자만 남기고 선행 0은 접는다("0007" → "7") — 표시 문자열과 제출값(파싱 결과)이
          // 어긋나지 않게 한다. 홑 "0"은 치는 중간 상태라 남긴다(범위 안내가 받는다).
          onChangeText={(v) => setDurationText(v.replace(/\D+/g, '').replace(/^0+(?=\d)/, ''))}
          keyboardType="number-pad"
          maxLength={4}
          placeholder={`직접 입력 (${DURATION_MIN}~${DURATION_MAX}분)`}
          placeholderTextColor={T.inkMuted}
          accessibilityLabel="목표 시간 직접 입력"
          testID="group.challenge.durationInput"
        />
        <Text style={s.inputUnit}>분</Text>
      </View>
      {durationCaption !== null && <Text style={s.error}>{durationCaption}</Text>}

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

      {/* 키보드 보정 여백 — 패널이 하단 고정이라 이 여백이 내용 전체를 키보드 위로 올린다. */}
      {keyboardHeight > 0 && <View style={{ height: keyboardHeight }} />}
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

  // 직접 입력 — 그룹 만들기 화면 inputBox와 같은 규격(46/r13/1.5border).
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.border,
    borderRadius: 13,
    paddingHorizontal: T.space.md,
    height: 46,
    marginTop: T.space.sm,
  },
  inputBoxError: { borderColor: T.dangerInk, backgroundColor: T.dangerBg },
  input: { ...T.text.label, flex: 1, color: T.ink, padding: 0 },
  inputUnit: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },

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
