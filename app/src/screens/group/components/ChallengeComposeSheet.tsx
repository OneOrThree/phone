import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
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
import { logGroupBetEnabled, logGroupChallengeCreated } from '@/services/analyticsEvents';
import { useToast } from '@/store/ToastContext';
import { WINDOW_FOCUS_TOLERANCE_NOTICE } from './progressFormat';
import { nowSecondsInZone } from '@/utils/challengeTime';
import type {
  ChallengeRepeatDay,
  CreateChallengeRequest,
  MissionCategory,
  MissionType,
} from '@/types/dto/group';

// 챌린지 만들기 시트(방장만) — 명세 docs/app/group-plan-2.md §3-2,
// 챌린지 v2 정책 정본 docs/prd/challenge/policy.md(§A3 요일·§A5 겹침·§A6 창 규칙·§A6-bis 상한).
//
// 폼 순서(ux.html §06): 카테고리 세그먼트 → 방식 세그먼트 → **요일 7토글(선택 강제, GROMO-1273)**
// → (시간대일 때) 창 시작·종료 시각 휠 → 목표분(칩 + 직접 입력, 시간 환산 병기 GROMO-1278)
// → 참가비(내기 — 생성 시에만 결정, GROMO-1428).
// 규격은 그룹 만들기 화면의 세그먼트·칩, 집중 목표의 DrumPicker, 그룹 찾기 시트의 인풋을
// 그대로 따른다 — 같은 값을 고르는 자리가 달라 보이면 안 된다.
//
// ⚠️ 전송 계약(LLD §2): repeatDays는 ISO 요일 배열(필수·1개 이상 — CHALLENGE_REPEAT_DAYS_REQUIRED
//    400을 클라가 선제 차단). TIME_WINDOW는 durationMinutes 필수 + windowStart/windowEnd
//    ("HH:mm:ss" KST 벽시계, GROMO-1225). 내기는 bet: { enabled, stake }로 생성 시에만 실린다.
// ⚠️ 동시 활성 제한은 **카테고리×방식 조합당 1개**(그룹당 최대 4개, V20 유니크 인덱스) —
//    조합 매트릭스로 세그먼트를 잠근다. 서버가 막는 조합을 애초에 못 고르게 한다.
//    (v2의 "창형은 겹치지 않으면 복수 허용"(FR-3)은 서버 1422·V20 완화와 함께 별도 티켓으로 푼다.)
// ⚠️ SCREEN_TIME 생성 시 응답 nonParticipants에 권한 미허용 멤버가 담겨 온다 —
//    만들어지긴 했지만 그 사람들은 집계되지 않으므로 방장에게 반드시 알린다.

// 목표 시간(분) 빠른 선택 프리셋 — 그룹 만들기 화면의 DURATION_OPTIONS와 같은 4단(§3-2).
// 프리셋 밖 값은 아래 직접 입력으로 받는다(GROMO-1098) — 단일 소스는 durationText 하나다.
const DURATION_OPTIONS = [30, 60, 120, 180] as const;
const DURATION_DEFAULT = 60;
// 하루형 목표 상한(분) — 정책 §A6-bis(N51). 방향이 반대인 지표라 상한이 갈린다:
// FOCUS는 물리적 최대치(18시간), SCREEN_TIME은 상한이 곧 가장 느슨한 목표라 12시간.
// 초과 값은 서버도 INVALID_MISSION_PARAMS(400)로 거부한다 — 클라가 먼저 안내한다.
const DURATION_MAX: Record<MissionCategory, number> = { FOCUS: 1080, SCREEN_TIME: 720 };
// 창형 FOCUS 목표 하한 — 판정이 `분 ≥ 목표 − 5(관용치)`라 5분 이하 목표는 0분도 달성이 된다(A6-4).
const WINDOW_FOCUS_MIN_EXCLUSIVE = 5;
// 창형 SCREEN_TIME 목표 눈금 — 측정이 15분 단위라 목표도 15분 배수만 받는다(A6-3).
const SCREEN_TIME_STEP = 15;
// 참가비 상한(코인) — 정책 N30. 프리셋 칩·잔액 표기는 GROMO-1424(Phase 2)가 얹는다.
const STAKE_MAX = 3000;

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
// 종료 분 휠 전용 — 자정 걸침 금지(§A6-1) 후 "22:00~23:59는 허용"이 정책의 유효 예시인데
// 5분 눈금으로는 23:55가 상한이라 당일 마지막 시각을 표현할 수 없다(codex 리뷰, PR #565).
// 59분 항목을 끝에 더해 어느 시든 HH:59를 고를 수 있게 한다(서버는 임의 time 수용).
const END_MINUTE_ITEMS = [...MINUTE_ITEMS, '59분'];
const endMinuteIndexOf = (minuteOfHour: number): number =>
  minuteOfHour === 59 ? END_MINUTE_ITEMS.length - 1 : minuteOfHour / MINUTE_STEP;
const endMinuteOf = (index: number): number =>
  index === END_MINUTE_ITEMS.length - 1 ? 59 : index * MINUTE_STEP;

// durationLabel까지 카테고리에서 파생시킨다 — 그룹 만들기 화면과 같은 문구다(같은 값을
// 고르는 두 자리가 달라 보이면 안 된다는 이 파일의 전제를 라벨에도 적용).
const CATEGORY_OPTIONS: { value: MissionCategory; label: string; durationLabel: string }[] = [
  { value: 'FOCUS', label: '집중 시간', durationLabel: '하루 목표 집중 시간' },
  { value: 'SCREEN_TIME', label: '스크린타임', durationLabel: '하루 목표 스크린타임' },
];

// 방식 세그먼트 — DURATION은 '그날 하루 누적', TIME_WINDOW는 '반복되는 시간대'다.
// 종전 라벨 「매일 목표」의 "매일" 전제는 요일 반복(§A3)과 함께 깨졌다 — ux.html §06의 라벨을 따른다.
const TYPE_OPTIONS: { value: MissionType; label: string }[] = [
  { value: 'DURATION', label: '하루 누적' },
  { value: 'TIME_WINDOW', label: '시간대' },
];

// 요일 7토글(GROMO-1273) — 아이폰 알람과 같은 모델(§A3). 「매일/평일/주말」 프리셋은 두지
// 않는다(FR-9-1: 누르는 손이 곧 "언제 도는지"를 의식하는 절차다). 기본값도 없다(FR-4·N3).
const REPEAT_DAY_OPTIONS: { value: ChallengeRepeatDay; label: string; a11yLabel: string }[] = [
  { value: 'MON', label: '월', a11yLabel: '월요일' },
  { value: 'TUE', label: '화', a11yLabel: '화요일' },
  { value: 'WED', label: '수', a11yLabel: '수요일' },
  { value: 'THU', label: '목', a11yLabel: '목요일' },
  { value: 'FRI', label: '금', a11yLabel: '금요일' },
  { value: 'SAT', label: '토', a11yLabel: '토요일' },
  { value: 'SUN', label: '일', a11yLabel: '일요일' },
];

// 요일 미선택 안내 — 선택을 강제하는 이유(언제 도는지 의식)를 그대로 문장에 싣는다.
const REPEAT_DAYS_REQUIRED_CAPTION = '언제 도는 챌린지인지 골라 주세요';

// 카테고리에 따라 목표의 뜻이 뒤집힌다(집중은 이상, 스크린타임은 이하) — 캡션으로 못 박는다.
// "매일/하루에" 전제는 요일 반복과 함께 "도는 날" 기준으로 바꿨다(GROMO-1273).
const CATEGORY_CAPTION: Record<MissionCategory, string> = {
  FOCUS: '도는 날마다 목표 시간 이상 집중하면 달성이에요',
  SCREEN_TIME:
    '도는 날의 스크린타임을 목표 이하로 유지하면 달성이에요. 권한을 허용한 멤버만 참여해요',
};

// 시간대(TIME_WINDOW) 안내 — FOCUS 창은 판정에 5분 관용치가 있고(서버
// WINDOW_FOCUS_TOLERANCE_MINUTES), SCREEN_TIME 창은 15분 눈금 측정이라 오차·누락이 구조적으로
// 존재한다 — 돈이 걸릴 수 있는 판정 기준이라 만들기 전에 고지한다.
// 관용치 문장은 progressFormat의 WINDOW_FOCUS_TOLERANCE_NOTICE를 합성한다(GROMO-1224) —
// 결과 모달의 고지와 글자 하나까지 같아야 하는 문장이라 소스를 하나만 둔다.
const WINDOW_FOCUS_CAPTION = `도는 날마다 정한 시간대 안에서 목표 시간 이상 집중하면 달성이에요. ${WINDOW_FOCUS_TOLERANCE_NOTICE}`;
const WINDOW_SCREEN_TIME_CAPTION =
  '도는 날마다 정한 시간대 안에서 스크린타임을 목표 이하로 유지하면 달성이에요. ' +
  '권한을 허용한 멤버만 참여해요. ' +
  '사용 시간은 15분 단위로 집계돼 오차가 있을 수 있어요. 앱 버전이나 기기 상태에 따라 집계가 늦거나 누락될 수 있어요';

// 오늘 창이 이미 지난 시간대로 만들 때의 안내 — 창은 반복되는 time-of-day라 오늘 몫만 지났을 뿐
// 챌린지는 정상 생성된다. 막지 않고 사실만 알린다. 요일 반복(§A3) 뒤로 "내일"이 다음 활성일이라는
// 보장이 없어져 「다음 도는 날」로 말한다(GROMO-1273).
const WINDOW_PASSED_NOTE = '오늘 시간대가 지나 다음 도는 날부터 적용돼요';

// 자정 걸침 창 금지(§A6-1·N25) — 요일이 회차를 가르는 축인데 창이 요일 경계를 넘으면 판정일·
// 겹침 검사·정산 귀속이 전부 모호해진다. 서버도 시작<종료를 강제하므로(INVALID_MISSION_PARAMS)
// 클라가 먼저 이유를 말한다. 문구는 ux.html §06 카피 표 그대로.
const WINDOW_MIDNIGHT_CAPTION =
  '시간대는 하루 안에서 끝나야 해요. 자정 이후는 다음 날 챌린지로 만들어 주세요';

// SCREEN_TIME 생성 후 미참여자가 있을 때의 안내 — 생성 자체는 성공이므로 실패로 보이게 쓰지 않는다.
// 토스트는 한 줄(numberOfLines=2)이라 제목·본문을 나눌 수 없다 — 생성 결과와 미참여 사실을 한
// 문장에 담되 2줄 안에 들어가게 줄였다(옛 Alert: '챌린지를 만들었어요' / '일부 멤버는 스크린타임
// 권한이 없어 참여할 수 없어요').
const NON_PARTICIPANT_MESSAGE = '챌린지를 만들었어요 — 스크린타임 권한이 없는 멤버는 빠져요';

// 이미 있는 조합을 고를 수 없는 이유 — 세그먼트 아래 한 줄로 알린다.
const TAKEN_CAPTION = '이미 있는 종류·방식은 기존 챌린지를 삭제해야 다시 만들 수 있어요';
const ALL_TAKEN_CAPTION = '모든 종류의 챌린지가 이미 있어요';
// 잠긴 세그먼트가 스크린리더에 읽어 줄 이유(GROMO-1204) — TAKEN_CAPTION과 같은 사실의 요약이다.
const TAKEN_HINT = '이미 만든 조합이에요';
// 창 길이 초과로 잠긴 칩의 이유 — durationOverWindowCaption의 첫 문장과 같은 결이다.
const CHIP_OVER_WINDOW_HINT = '시간대보다 길어요';
// 전송 중 안내 — BetSheet와 같은 문구·자리(CTA 아래 한 줄). 폼 전체가 잠긴 동안
// 멈춘 화면으로 보이지 않게 한다.
const SUBMITTING_CAPTION = '처리 중이에요…';

// 참가비(내기) 섹션 카피(GROMO-1428) — ux.html §06. 내기를 켤지는 **이 시트가 유일한 자리**고
// 만든 뒤에는 끌 수 없다(N26: 끄기 = 삭제와 같은 일이라 경로를 하나만 둔다). 참여 규칙(회차마다
// 각자·최소 2명)과 불가역 고지를 만들기 전에 한 번에 보여 준다.
const BET_NOTE =
  '1~3,000코인 사이로 정해요. 도는 날마다 각자 참여를 정하고, 2명 이상 모여야 내기가 성립해요. ' +
  '내기는 만든 뒤에 끌 수 없어요 — 빼려면 챌린지를 삭제하고 다시 만들어요';
const STAKE_RANGE_CAPTION = '참가비는 1~3,000코인 사이로 정해 주세요';

// 1,080 → "1,080" — 상한 카피의 천 단위 구분(기존 "1~1,440분" 표기와 같은 결).
function fmtN(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 90 → "1시간 30분", 720 → "12시간" — 분 입력의 시간 환산(FR-9-2). 60분 미만은 환산이 무의미하다.
function hourLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

// 상한 카피 — "1,080분(18시간)"처럼 분과 시간 환산을 같은 형식으로 병기한다(FR-9-2).
function minutesWithHours(minutes: number): string {
  return minutes >= 60 ? `${fmtN(minutes)}분(${hourLabel(minutes)})` : `${fmtN(minutes)}분`;
}

// 하루형 상한 안내 — 카테고리별 상한(N51)을 환산 병기 형식으로.
const durationRangeCaption = (category: MissionCategory): string =>
  `목표 시간은 1~${minutesWithHours(DURATION_MAX[category])} 사이로 입력해 주세요`;
// 창 길이 초과는 기존 칩 잠금(chipDisabled)과 같은 사실이다 — 칩은 잠그면 끝이지만
// 직접 입력은 이미 쓴 값이 남으므로 고치는 방법(이하로 줄이기)을 문장에 싣는다.
const durationOverWindowCaption = (windowLength: number): string =>
  `시간대보다 길어요. ${minutesWithHours(windowLength)} 이하로 입력해 주세요`;
// 창형 SCREEN_TIME 눈금 안내 — ux.html §06 카피 표 그대로(서버 CHALLENGE_GOAL_NOT_ALIGNED 선제).
const GOAL_STEP_CAPTION = '사용 시간은 15분 단위로 집계돼요. 15·30·45분처럼 골라 주세요';
// 창형 FOCUS 하한 안내 — 이유(관용치)는 결과 모달과 같은 문장 소스를 쓴다.
const GOAL_TOLERANCE_CAPTION = `목표 시간은 5분보다 길어야 해요. ${WINDOW_FOCUS_TOLERANCE_NOTICE}`;

// 생성 실패 문구 — HTTP status가 아니라 서버 code로 분기하고, 모르는 code는 공통 문구(§5-2).
function createErrorMessage(e: unknown): string {
  switch (groupErrorCode(e)) {
    case 'NOT_FOUND':
      return '사라진 그룹이에요.';
    case 'MEMBER_ONLY':
      return '그룹원만 이용할 수 있어요.';
    // 그룹 생성은 더는 챌린지를 만들지 않는다(D18) — 그래도 목록 조회 뒤 다른 방장이 같은
    // 조합을 먼저 만드는 레이스에선 매트릭스를 뚫고 이 409가 온다. 공통 문구로 떨어뜨리면
    // "다시 시도"를 반복해도 영원히 같은 실패만 보므로 전용 분기를 유지한다.
    // ACTIVE_CHALLENGE_EXISTS(구서버)·CHALLENGE_DUPLICATE(V20)·CHALLENGE_ALREADY_EXISTS
    // (v2 하루형 카테고리 중복 — LLD §2 검증 4)는 같은 사실이다.
    case 'ACTIVE_CHALLENGE_EXISTS':
    case 'CHALLENGE_ALREADY_EXISTS':
    case CHALLENGE_DUPLICATE:
      return '이미 같은 종류의 챌린지가 있어요. 기존 챌린지를 삭제하고 만들어주세요.';
    // 창 겹침 판정은 요일 ∧ 시간대다(§A5: 요일 교집합이 있고 간격이 15분 미만일 때만 409).
    // 요일을 바꿔도 시간을 바꿔도 풀리는 실패라 두 해법을 모두 문장에 싣는다(GROMO-1273).
    case CHALLENGE_WINDOW_OVERLAP:
      return (
        '요일이 겹치는 다른 시간대 챌린지와 시간이 겹치거나 간격이 15분보다 좁아요. ' +
        '겹치지 않는 요일을 고르거나 시간대를 15분 이상 띄워 주세요.'
      );
    // 아래 4종은 클라가 선제 검증하므로 보통 오지 않는다 — 레이스·구클라 대비 전용 문구만 유지.
    case 'CHALLENGE_REPEAT_DAYS_REQUIRED':
      return '도는 요일을 하나 이상 골라 주세요.';
    case 'CHALLENGE_LIMIT_EXCEEDED':
      return '챌린지는 4개까지 만들 수 있어요. 하나를 종료하고 다시 시도해 주세요.';
    case 'CHALLENGE_GOAL_NOT_ALIGNED':
      return `${GOAL_STEP_CAPTION}.`;
    case 'BET_INVALID_STAKE':
      return `${STAKE_RANGE_CAPTION}.`;
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

// 창 시각 → "HH:mm:ss" KST 벽시계 문자열(GROMO-1225). 서버가 원래 읽는 값(반복 time-of-day)만
// 그대로 보낸다 — 상수 문자열이라 기기 타임존과 무관하다.
function windowTimeOf(minutesOfDay: number): string {
  return `${hhmmOf(minutesOfDay)}:00`;
}

// 오늘의 KST 요일 — '오늘 창이 지났다' 안내는 오늘이 도는 요일일 때만 의미가 있다.
// 판정 축은 기기 로컬이 아니라 KST 고정이다(정책 §B3) — UTC+9 산술이라 Intl 지원과 무관하다.
function kstTodayRepeatDay(): ChallengeRepeatDay {
  const KST_OFFSET_MS = 9 * 3600 * 1000;
  const dow = new Date(Date.now() + KST_OFFSET_MS).getUTCDay(); // 0=일 … 6=토
  return (['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const)[dow];
}

// 이미 있는(ACTIVE) 챌린지 — 조합(카테고리×방식) 잠금의 근거.
export interface ExistingChallengeCombo {
  category: MissionCategory;
  type: MissionType;
}

export interface ChallengeComposeSheetProps {
  groupId: string;
  // 이 그룹에 이미 있는(ACTIVE) 챌린지의 (카테고리, 방식) 조합 — 부모(GroupRoomScreen)가
  // challenges에서 파생해 넘긴다. 서버의 중복 판정 단위가 정확히 이 조합이다 —
  // (그룹, 카테고리, 방식) 기준 V20 부분 유니크 인덱스 uq_group_challenges_active_cat_type이
  // 409(CHALLENGE_DUPLICATE)로 막으므로, 애초에 실패할 조합을 고를 수 없게 매트릭스를 잠근다.
  existingCombos: ExistingChallengeCombo[];
  onClose: () => void;
  // 생성 성공 — 부모가 시트를 닫고 챌린지 목록을 재조회한다.
  onCreated: () => void;
}

export default function ChallengeComposeSheet({
  groupId,
  existingCombos,
  onClose,
  onCreated,
}: ChallengeComposeSheetProps) {
  // 아래 키보드 이펙트가 이미 `show`(keyboardDidShow 구독)를 쓴다 — 이름을 겹치지 않게 받는다.
  const { show: showToast } = useToast();
  const isTaken = (category: MissionCategory, type: MissionType): boolean =>
    existingCombos.some((c) => c.category === category && c.type === type);
  const categoryFullyTaken = (category: MissionCategory): boolean =>
    TYPE_OPTIONS.every((t) => isTaken(category, t.value));
  // 만들 수 있는 조합이 하나도 없다 — 세그먼트를 전부 잠그고 CTA도 막는다.
  const allTaken = CATEGORY_OPTIONS.every((o) => categoryFullyTaken(o.value));

  // 초기 선택은 **비어 있는 조합** — 기본값(FOCUS×하루 누적)을 고수하면 대표 챌린지와 항상
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
  // 도는 요일(GROMO-1273) — **기본값 없음**(FR-4·N3). 하나도 안 고르면 CTA가 잠긴다.
  // 저장은 월~일 정렬을 유지한다(전송 배열이 토글 순서에 따라 흔들리지 않게).
  const [repeatDays, setRepeatDays] = useState<ChallengeRepeatDay[]>([]);
  // 목표 시간의 단일 소스 — 칩 탭도 이 문자열을 갱신하고, 칩 선택 표시도 이 문자열에서 파생한다.
  // 숫자가 아니라 문자열인 이유: "120"을 치는 중간 상태("1"·"12")와 빈 값을 잃지 않기 위해서다.
  const [durationText, setDurationText] = useState<string>(String(DURATION_DEFAULT));
  // 창 시작·종료 — '하루 중 분'(0~1439). 자정 걸침(시작 ≥ 종료)은 만들 수 없다(§A6-1·N25) —
  // 휠 선택 자체는 허용하고 인라인 안내 + CTA 잠금으로 이유를 보여 준다(휠을 되돌리면 왜 안
  // 되는지 알 길이 없다).
  const [windowStart, setWindowStart] = useState(WINDOW_START_DEFAULT);
  const [windowEnd, setWindowEnd] = useState(WINDOW_END_DEFAULT);
  // 참가비(코인) — 빈 값 = 내기 없음(GROMO-1428). 켤지 여부를 따로 묻지 않고 참가비를 정하는
  // 행위가 곧 내기를 켜는 결정이다(ux.html §06 — 프리셋 칩·잔액 표기는 1424가 얹는다).
  const [stakeText, setStakeText] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 키보드가 바텀시트를 덮는 문제 보정 — 자식 끝에 키보드 높이만큼 여백을 깔아 내용을 올린다.
  // ⚠️ 안드로이드 전용이다. iOS는 SheetShell이 패널 자체를 키보드 높이만큼 띄우므로(bottom),
  //    여기서 또 여백을 깔면 보정이 두 번 먹어 CTA가 키보드 한 칸 위로 떠 버린다 —
  //    패널에 85% 높이 상한이 생긴 뒤로는 그 여백이 스크롤까지 유발한다(GROMO-1111).
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'ios') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
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
  // 창 유효성 — 자정 걸침 금지(§A6-1)로 시작<종료만 유효하다. 무효 창에서는 길이 파생값
  // (칩 잠금·목표 클램프·지남 안내)을 전부 멈추고 안내 한 줄 + CTA 잠금으로 수렴시킨다.
  const windowValid = windowStart < windowEnd;
  const windowLength = windowValid ? windowEnd - windowStart : 0;
  // 오늘 창이 이미 지났나 — **오늘이 도는 요일이고** KST 현재 시각이 종료를 넘겼을 때만 말이
  // 된다(오늘 안 도는 챌린지에 "오늘 시간대가 지나"는 거짓 안내다). 판정 축은 반드시 KST
  // 벽시계다 — 기기 로컬 시각을 쓰면 비KST 기기에서 하루 어긋난 안내가 뜬다.
  const windowPassedToday =
    isWindow &&
    windowValid &&
    repeatDays.includes(kstTodayRepeatDay()) &&
    nowSecondsInZone('Asia/Seoul') >= windowEnd * 60;
  // 창 길이를 넘는 목표는 서버가 INVALID_MISSION_PARAMS로 거부한다 — 칩을 미리 잠근다.
  // (무효 창에서는 길이가 무의미하므로 잠그지 않는다 — 창 안내가 이미 CTA를 막고 있다.)
  const chipDisabled = (m: number): boolean => isWindow && windowValid && m > windowLength;

  // 직접 입력 파생값 — onChangeText가 숫자만 남기므로 정수 아님은 빈 값뿐이다.
  const durationMinutes = /^\d+$/.test(durationText) ? parseInt(durationText, 10) : null;
  // 검증(GROMO-1278) — 서버 400(LLD §2 검증 5~7)을 클라에서 먼저 안내한다.
  //  · 하루형: 1 ≤ x ≤ 카테고리 상한(FOCUS 1,080 / SCREEN_TIME 720 — N51)
  //  · 창형: 0 < x ≤ 창 길이, SCREEN_TIME은 15분 배수(A6-3), FOCUS는 목표 > 5분(A6-4)
  // 빈 값은 치우는 중일 뿐이라 빨간 줄을 띄우지 않는다(CTA만 잠근다).
  let durationValid = false;
  let durationCaption: string | null = null;
  if (durationMinutes !== null) {
    if (!isWindow) {
      durationValid = durationMinutes >= 1 && durationMinutes <= DURATION_MAX[missionCategory];
      if (!durationValid) durationCaption = durationRangeCaption(missionCategory);
    } else if (!windowValid) {
      // 창부터 고쳐야 한다 — 목표 안내를 겹쳐 띄우지 않는다(창 안내가 CTA를 막는다).
      durationValid = false;
    } else if (durationMinutes > windowLength) {
      durationCaption = durationOverWindowCaption(windowLength);
    } else if (
      missionCategory === 'SCREEN_TIME' &&
      (durationMinutes === 0 || durationMinutes % SCREEN_TIME_STEP !== 0)
    ) {
      durationCaption = GOAL_STEP_CAPTION;
    } else if (missionCategory === 'FOCUS' && durationMinutes <= WINDOW_FOCUS_MIN_EXCLUSIVE) {
      durationCaption = GOAL_TOLERANCE_CAPTION;
    } else {
      durationValid = true;
    }
  }
  // 시간 환산 병기(FR-9-2) — "90분 · 1시간 30분". 60분 미만은 환산할 것이 없다.
  const durationHoursCaption =
    durationMinutes !== null && durationMinutes >= 60
      ? `${fmtN(durationMinutes)}분 · ${hourLabel(durationMinutes)}`
      : null;
  // 범위는 플레이스홀더가 상시 알려 준다 — 상한이 방식·카테고리로 갈리므로 자리마다 계산한다.
  const durationPlaceholder = !isWindow
    ? `직접 입력 (1~${fmtN(DURATION_MAX[missionCategory])}분)`
    : !windowValid
      ? '직접 입력'
      : missionCategory === 'SCREEN_TIME'
        ? `직접 입력 (15분 단위, 최대 ${fmtN(windowLength)}분)`
        : `직접 입력 (최대 ${fmtN(windowLength)}분)`;

  // 참가비 파생값 — 빈 값 = 내기 없음(유효). 값이 있으면 1~3,000(N30)만 통과한다.
  const stake = /^\d+$/.test(stakeText) ? parseInt(stakeText, 10) : null;
  const stakeValid = stake === null || (stake >= 1 && stake <= STAKE_MAX);
  const stakeCaption = stakeValid ? null : STAKE_RANGE_CAPTION;

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

  // 요일 토글 — 저장 순서는 항상 월~일 정렬(REPEAT_DAY_OPTIONS 순)을 유지한다.
  function toggleRepeatDay(day: ChallengeRepeatDay) {
    setRepeatDays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : REPEAT_DAY_OPTIONS.filter((o) => prev.includes(o.value) || o.value === day).map(
            (o) => o.value,
          ),
    );
  }

  // 창 시각 커밋 — 자정 걸침(시작 ≥ 종료)도 **커밋은 허용**한다. 휠을 되돌리면(종전 방식)
  // 규칙을 알 길이 없다 — 인라인 안내(WINDOW_MIDNIGHT_CAPTION) + CTA 잠금이 이유를 말한다.
  // 유효한 창으로 커밋할 때 현재 목표분이 창보다 길어지면 창 길이로 당긴다(칩 스냅의 일반화 —
  // 칩 값이면 그 칩이 켜진다). SCREEN_TIME 창은 눈금(15분 배수)까지 맞춰 당긴다(A6-3) —
  // 초과·비눈금 값이 남은 채 CTA만 막히는 상태를 만들지 않는다.
  function commitWindow(start: number, end: number) {
    // 전송 중 도달한 휠 onChange 무시(코덱스 리뷰) — pointerEvents="none"은 새 터치만 막고,
    // 이미 시작된 플링(모멘텀) 감속의 onChange는 여기까지 온다. 전송값은 submit()이 탭 시점
    // 값을 클로저로 캡처해 안전하지만, 표시가 감속 끝 값으로 바뀌면 자기가 만든 창을 오인한다 —
    // 표시·전송이 어긋나는 창을 여기서 닫는다. 판정은 잠금 ref가 기준이다(submitting state는
    // 같은 틱에선 아직 이전 값이다).
    if (submitLock.current || submitting) return;
    setWindowStart(start);
    setWindowEnd(end);
    if (start >= end) return; // 무효 창 — 클램프할 길이가 없다. 안내와 CTA 잠금이 받는다.
    const length = end - start;
    if (durationMinutes !== null && durationMinutes > length) {
      const snapped =
        missionCategory === 'SCREEN_TIME'
          ? Math.floor(length / SCREEN_TIME_STEP) * SCREEN_TIME_STEP
          : length;
      // SCREEN_TIME 창이 15분 미만이면 유효한 15분 배수 목표 자체가 없다 — length 폴백은
      // 비눈금 값이라 CTA만 잠긴 채 남는다(지키려던 것과 정반대). 빈 값으로 비워 입력을
      // 다시 받는다(빈 값은 에러 캡션 없이 CTA만 잠근다).
      setDurationText(snapped >= 1 ? String(snapped) : '');
    }
  }

  async function submit() {
    // 생성 중 중복 탭 방지 — 판정은 ref로만 한다(submitting은 스피너·처리 중 안내와
    // 폼 전체 잠금(세그먼트·칩 disabled, 입력 editable, 휠 pointerEvents) 표시 전용).
    // durationMinutes null 검사는 타입 좁히기용 — durationValid가 이미 배제한다.
    if (
      submitLock.current ||
      allTaken ||
      repeatDays.length === 0 ||
      !durationValid ||
      (isWindow && !windowValid) ||
      !stakeValid ||
      durationMinutes === null
    ) {
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    // 처리 중임을 스크린리더에 능동 안내(코덱스 리뷰) — 캡션 텍스트 삽입만으로는 TalkBack/
    // VoiceOver 어느 쪽도 자동으로 읽지 않는다. announceForAccessibility가 iOS·안드로이드
    // 양쪽에서 즉시 읽히는 크로스플랫폼 채널이다. accessibilityLiveRegion은 안드로이드 전용인
    // 데다 announce와 겹치면 같은 문구가 두 번 읽혀 채널을 이 하나로 둔다.
    AccessibilityInfo.announceForAccessibility(SUBMITTING_CAPTION);
    setErrorMsg(null);
    try {
      const body: CreateChallengeRequest = {
        missionCategory,
        missionType,
        durationMinutes,
        repeatDays,
        ...(isWindow
          ? { windowStart: windowTimeOf(windowStart), windowEnd: windowTimeOf(windowEnd) }
          : {}),
        // 참가비를 정했다 = 내기를 켰다. 안 정했으면 bet 자체를 싣지 않는다(선택 필드 — LLD §2).
        ...(stake !== null ? { bet: { enabled: true, stake } } : {}),
      };
      const { nonParticipants } = await createChallenge(groupId, body);
      logGroupChallengeCreated({
        mission_type: missionType,
        mission_category: missionCategory,
        duration_minutes: durationMinutes,
        has_window: isWindow,
      });
      // 내기를 켠 생성이면 별도 이벤트 — 내기 켜짐 비율(PRD §5)의 유일한 측정 소스다(N26).
      if (stake !== null) {
        logGroupBetEnabled({
          stake,
          mission_type: missionType,
          mission_category: missionCategory,
        });
      }
      // 안내는 시트가 닫힌 뒤에도 남는 토스트로 띄운다 — 시트 안 문구로 두면 곧 사라진다.
      // 선택지 없는 결과 통보라 확인 버튼이 필요 없다(정책 D8/D19).
      // ⚠️ 순서 주의 — 이 시트는 SheetShell asModal(RN Modal)이라 토스트가 그 **아래**에 깔린다
      //    (Toast.tsx 헤더 주석). onCreated()로 먼저 닫고 나서 알린다.
      onCreated();
      if (nonParticipants.length > 0) {
        showToast({ message: NON_PARTICIPANT_MESSAGE, tone: 'success' });
      }
    } catch (e) {
      // 실패했을 때만 잠금을 푼다 — 성공 경로는 onCreated가 시트를 닫으므로 잠긴 채 끝낸다.
      submitLock.current = false;
      setErrorMsg(createErrorMessage(e));
      setSubmitting(false);
    }
  }

  const submitBlocked =
    submitting ||
    allTaken ||
    repeatDays.length === 0 ||
    !durationValid ||
    (isWindow && !windowValid) ||
    !stakeValid;

  return (
    // 생성 중에는 딤 탭·그랩바 드래그로 닫히지 않게 막는다(요청이 떠 있는 상태에서의 언마운트 방지).
    <SheetShell onClose={submitting ? () => {} : onClose} asModal dismissible={!submitting}>
      <Text style={s.title}>챌린지 만들기</Text>
      {/* "오늘부터"는 요일 반복(§A3)과 함께 깨진 전제다 — ux.html §06의 부제로 바꿨다. */}
      <Text style={s.sub}>그룹이 함께 지킬 목표예요.</Text>

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
              disabled={taken || submitting}
              onPress={() => pickCategory(opt.value)}
              // TouchableOpacity는 disabled를 accessibilityState로 올려 주지 않는다 — 명시한다.
              // selected는 기존 on 의미 그대로다(잠긴 옵션은 선택 아님으로 읽힌다 — 눈에 보이는
              // 세그먼트 강조와 같은 판정을 스크린리더에도 준다).
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: taken || submitting }}
              accessibilityLabel={opt.label}
              accessibilityHint={taken ? TAKEN_HINT : undefined}
              testID={`group.challenge.category.${opt.value}`}
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
              disabled={taken || submitting}
              onPress={() => setMissionType(opt.value)}
              // 카테고리 세그먼트와 같은 규격 — 잠금(disabled)과 이유(hint)까지 읽힌다.
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: taken || submitting }}
              accessibilityLabel={opt.label}
              accessibilityHint={taken ? TAKEN_HINT : undefined}
              testID={`group.challenge.type.${opt.value}`}
            >
              <Text style={[s.segText, on ? s.segTextOn : null, taken ? s.segTextOff : null]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {existingCombos.length > 0 && (
        <Text style={s.takenCaption}>{allTaken ? ALL_TAKEN_CAPTION : TAKEN_CAPTION}</Text>
      )}

      {/* ── 도는 요일(GROMO-1273) — 기본값·프리셋 없음, 하나도 안 고르면 CTA 잠금 ── */}
      <Text style={s.label}>도는 요일</Text>
      <View style={s.dowRow}>
        {REPEAT_DAY_OPTIONS.map((opt) => {
          const on = repeatDays.includes(opt.value);
          return (
            <TouchableOpacity
              key={opt.value}
              style={[s.dowChip, on ? s.dowChipOn : null]}
              activeOpacity={0.8}
              disabled={submitting}
              onPress={() => toggleRepeatDay(opt.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: submitting }}
              accessibilityLabel={opt.a11yLabel}
              testID={`group.challenge.dow.${opt.value}`}
            >
              <Text style={[s.dowText, on ? s.dowTextOn : null]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {repeatDays.length === 0 && (
        <Text style={s.takenCaption} testID="group.challenge.dowRequired">
          {REPEAT_DAYS_REQUIRED_CAPTION}
        </Text>
      )}

      {isWindow && (
        <>
          <Text style={s.label}>시간대 설정 (한국 시간 기준)</Text>
          {/* DrumPicker엔 잠금 prop이 없다(집중 목표 화면과 공유하는 부품 — API를 늘리지 않는다).
              전송 중엔 휠 영역의 **새 터치**를 차단한다(GROMO-1204). pointerEvents="none"이
              못 멈추는 이미 시작된 플링(모멘텀) 감속의 onChange는 commitWindow의 잠금 가드가
              무시한다 — 화면 표시와 전송값(탭 시점 클로저 캡처)이 어긋나지 않는다. */}
          <View style={s.windowRow} pointerEvents={submitting ? 'none' : 'auto'}>
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
                items={END_MINUTE_ITEMS}
                selectedIndex={endMinuteIndexOf(windowEnd % 60)}
                onChange={(i) =>
                  commitWindow(windowStart, Math.floor(windowEnd / 60) * 60 + endMinuteOf(i))
                }
              />
            </View>
          </View>
          {/* 자정 걸침 창(§A6-1) — 서버 400을 기다리지 않고 이유와 대안을 먼저 말한다. */}
          {!windowValid && (
            <Text style={s.error} testID="group.challenge.windowInvalid">
              {WINDOW_MIDNIGHT_CAPTION}
            </Text>
          )}
          {/* 오늘 창이 이미 지났을 때 — 만들 수는 있으므로 막지 않고 사실만 알린다. */}
          {windowPassedToday && (
            <View style={s.note} testID="group.challenge.tomorrowNote">
              <Ionicons name="time-outline" size={15} color={T.accent} style={s.noteIcon} />
              <Text style={s.noteText}>{WINDOW_PASSED_NOTE}</Text>
            </View>
          )}
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
              disabled={off || submitting}
              onPress={() => setDurationText(String(m))}
              // 숫자만 읽히면 무엇을 고르는 자리인지 알 수 없다 — 단위(분)까지 라벨에 싣는다.
              // 잠긴 이유 힌트는 창 길이 초과일 때만(전송 중 잠금은 처리 중 안내가 받는다).
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: off || submitting }}
              accessibilityLabel={`${m}분`}
              accessibilityHint={off ? CHIP_OVER_WINDOW_HINT : undefined}
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
          // 전송 중 입력 잠금(GROMO-1204) — 60을 보낸 뒤 120으로 고치면 서버엔 60이 간 채
          // 화면만 120이 되어, 사용자가 만든 값을 오인한다(BetSheet editable과 같은 근거).
          editable={!submitting}
          maxLength={4}
          placeholder={durationPlaceholder}
          placeholderTextColor={T.inkMuted}
          accessibilityLabel="목표 시간 직접 입력"
          testID="group.challenge.durationInput"
        />
        <Text style={s.inputUnit}>분</Text>
      </View>
      {/* 시간 환산 병기(GROMO-1278·FR-9-2) — 240분이 4시간이라는 걸 암산하게 두지 않는다. */}
      {durationHoursCaption !== null && (
        <Text style={s.hoursCaption} testID="group.challenge.durationHours">
          {durationHoursCaption}
        </Text>
      )}
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

      {/* ── 참가비(내기, GROMO-1428) — 켤지 여부는 이 시트가 유일한 자리다(N26) ── */}
      <Text style={s.label}>
        참가비(코인) <Text style={s.labelSub}>· 안 정하면 내기 없음</Text>
      </Text>
      <View style={[s.inputBox, stakeCaption !== null ? s.inputBoxError : null]}>
        <TextInput
          style={s.input}
          value={stakeText}
          onChangeText={(v) => setStakeText(v.replace(/\D+/g, '').replace(/^0+(?=\d)/, ''))}
          keyboardType="number-pad"
          editable={!submitting}
          maxLength={4}
          placeholder={`직접 입력 (1~${fmtN(STAKE_MAX)}코인)`}
          placeholderTextColor={T.inkMuted}
          accessibilityLabel="참가비 직접 입력"
          testID="group.challenge.stakeInput"
        />
        <Text style={s.inputUnit}>코인</Text>
      </View>
      {stakeCaption !== null && <Text style={s.error}>{stakeCaption}</Text>}
      {/* 불가역 고지(N26) — 만든 뒤에는 끌 수 없다. 참여 규칙과 함께 만들기 전에 보여 준다. */}
      <View style={s.note} testID="group.challenge.betNote">
        <Ionicons name="cash-outline" size={15} color={T.accent} style={s.noteIcon} />
        <Text style={s.noteText}>{BET_NOTE}</Text>
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

      {/* 전송 중엔 CTA도 딤 탭도 폼 입력도 막혀 있다 — 멈춘 화면이 아님을 한 줄로 알린다
          (BetSheet와 같은 문구·자리). */}
      {submitting && <Text style={s.submittingCaption}>{SUBMITTING_CAPTION}</Text>}

      {/* 키보드 보정 여백(안드로이드 전용) — iOS는 SheetShell이 패널째 올린다. */}
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
  labelSub: { fontWeight: '500', color: T.inkMuted },

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

  // 요일 7토글 — 목표분 칩과 같은 색 체계(선택 = accentBg/accent), 7개가 한 줄에 서는 규격.
  dowRow: { flexDirection: 'row', gap: T.space.xs },
  dowChip: {
    flex: 1,
    minHeight: 40,
    paddingVertical: T.space.xs,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.chipBg,
    borderWidth: 1,
    borderColor: T.chipBorder,
  },
  dowChipOn: { backgroundColor: T.accentBg, borderColor: T.accent },
  dowText: { ...T.text.label, color: T.inkSub },
  dowTextOn: { color: T.accentDeep, fontWeight: '700' },

  // 창 시각 휠 — 시작(시·분) ~ 종료(시·분). 집중 목표 휠(DurationDrumPicker)과 같은 부품이라
  // 높이·타이포가 자동으로 맞는다.
  windowRow: { flexDirection: 'row', alignItems: 'center' },
  windowCol: { flex: 1 },
  windowTilde: { ...T.text.label, color: T.inkMuted, paddingHorizontal: T.space.xs },

  chips: { flexDirection: 'row', gap: T.space.sm },
  chip: {
    flex: 1,
    minHeight: 44,
    paddingVertical: T.space.md,
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
    minHeight: 46,
    paddingVertical: T.space.md,
    marginTop: T.space.sm,
  },
  inputBoxError: { borderColor: T.dangerInk, backgroundColor: T.dangerBg },
  input: { ...T.text.label, flex: 1, color: T.ink, padding: 0 },
  inputUnit: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  // 시간 환산 병기 — 인풋 바로 아래 한 줄, 오류가 아니라 정보라 muted다.
  hoursCaption: { ...T.text.caption, fontWeight: '500', color: T.inkMuted, marginTop: T.space.xs },

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
    minHeight: 52,
    paddingVertical: T.space.md,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.lg,
  },
  submitBtnOff: { opacity: 0.5 },
  submitText: { ...T.text.subtitle, color: T.white },
  // 전송 중 안내 — CTA 바로 아래 가운데 한 줄(BetSheet와 같은 규격).
  submittingCaption: {
    ...T.text.caption,
    fontWeight: '500',
    color: T.inkMuted,
    textAlign: 'center',
    marginTop: T.space.sm,
  },
});
