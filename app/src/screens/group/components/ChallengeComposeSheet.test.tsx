// ChallengeComposeSheet 전송값·조합 매트릭스·안내 테스트 — 명세 docs/app/group-plan-2.md §3-2,
// 챌린지 v2 정책 정본 docs/prd/challenge/policy.md(§A3·§A5·§A6·§A6-bis).
//
// 여기서 잠그는 것:
//  1) 전송 계약(LLD §2). repeatDays(ISO 요일 배열·필수)가 항상 실리고, TIME_WINDOW는
//     durationMinutes + "HH:mm:ss" KST 벽시계 windowStart/windowEnd가 함께 나간다(GROMO-1225).
//     내기는 참가비를 정했을 때만 bet: { enabled, stake }로 실린다(GROMO-1428).
//  2) 요일 선택 강제(GROMO-1273·FR-4) — 기본값도 프리셋도 없고, 0개면 CTA가 잠긴다.
//  3) 비활성화 매트릭스는 **카테고리×방식 조합**이다(V20 — 조합당 1개, 그룹당 최대 4개).
//  4) 계약이 문구까지 고정한 시간대 안내 2종(FOCUS 관용치 · SCREEN_TIME 측정 한계).
//  5) 목표분 검증(GROMO-1278) — 하루형 카테고리별 상한(N51), 창형 창 길이·15분 눈금·관용치 하한,
//     시간 환산 병기(FR-9-2).
//  6) 자정 걸침 창 금지(§A6-1·N25) — 종전 GROMO-1110의 허용을 되돌린다. 인라인 안내 + CTA 잠금.
//  7) nonParticipants 안내. 생성은 성공했지만 그 멤버들은 집계되지 않는다.
//  8) 접근성·전송 중 잠금(GROMO-1204) — 잠긴 컨트롤은 이유까지 읽히고, 전송 중엔 폼 전체가 잠긴다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Alert } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import ChallengeComposeSheet, { type ExistingChallengeCombo } from './ChallengeComposeSheet';
import { createChallenge } from '@/services/groupApi';
import { logGroupBetEnabled, logGroupChallengeCreated } from '@/services/analyticsEvents';
import { nowSecondsInZone } from '@/utils/challengeTime';
import type { CreateChallengeResponse } from '@/types/dto/group';

// SheetShell이 useSafeAreaInsets를 쓴다 — 테스트 트리엔 SafeAreaProvider가 없어 고정값으로 대체한다.
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// groupErrorCode는 실제 구현을 남긴다(§3-2 code 분기까지 검증).
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  createChallenge: jest.fn(),
}));

jest.mock('@/services/analyticsEvents', () => ({
  logGroupChallengeCreated: jest.fn(),
  logGroupBetEnabled: jest.fn(),
  logGroupChallengeDeleted: jest.fn(),
}));

// '오늘 창이 지났나' 판정의 시각 축(KST 벽시계)만 고정한다 — 실제 시계에 기대면 테스트가
// 하루 중 언제 도느냐에 따라 결과가 뒤집힌다.
jest.mock('@/utils/challengeTime', () => ({
  ...jest.requireActual('@/utils/challengeTime'),
  nowSecondsInZone: jest.fn(),
}));

// 창 시각 휠 — 스크롤 제스처는 jest로 흉내 낼 수 없어, 항목을 누르면 그 인덱스로 onChange가
// 올라가는 평면 리스트로 바꾼다(컨트롤드 계약은 동일 — 부모가 값을 거부하면 선택이 안 바뀐다).
jest.mock('@/components/DrumPicker', () => {
  const mockReact = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    DrumPicker: ({ items, onChange }: { items: string[]; onChange: (i: number) => void }) =>
      mockReact.createElement(
        mockReact.Fragment,
        null,
        items.map((label, i) =>
          mockReact.createElement(
            Text,
            { key: `${label}-${i}`, onPress: () => onChange(i) },
            label,
          ),
        ),
      ),
  };
});

const mockCreateChallenge = createChallenge as jest.MockedFunction<typeof createChallenge>;
const mockNowSeconds = nowSecondsInZone as jest.MockedFunction<typeof nowSecondsInZone>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const onClose = jest.fn();
const onCreated = jest.fn();

const DOW_REQUIRED = '언제 도는 챌린지인지 골라 주세요';
const MIDNIGHT_CAPTION =
  '시간대는 하루 안에서 끝나야 해요. 자정 이후는 다음 날 챌린지로 만들어 주세요';

function axiosErrorWith(status: number, code?: string): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: code ? { code, message: '...' } : undefined,
  });
}

async function renderSheet(existing: ExistingChallengeCombo[] = []) {
  const result = await render(
    <ChallengeComposeSheet
      groupId={GROUP_ID}
      existingCombos={existing}
      onClose={onClose}
      onCreated={onCreated}
    />,
  );
  await act(async () => {});
  return result;
}

async function press(label: string) {
  const el = await screen.findByText(label);
  await act(async () => {
    fireEvent.press(el);
  });
}

// 같은 라벨이 여러 휠에 있다(시작·종료의 시 휠) — n번째 것을 누른다.
async function pressNth(label: string, nth: number) {
  const els = await screen.findAllByText(label);
  await act(async () => {
    fireEvent.press(els[nth]);
  });
}

// 요일 토글(GROMO-1273) — 선택이 강제라 제출하는 테스트는 최소 하나를 골라야 한다.
async function pickDay(label = '월') {
  await press(label);
}

const ALL_DAYS = ['월', '화', '수', '목', '금', '토', '일'] as const;
// KST '오늘'이 무슨 요일이든 오늘을 포함하게 만든다 — '오늘 창이 지났다' 안내 테스트용.
async function pickAllDays() {
  for (const d of ALL_DAYS) {
    await press(d);
  }
}

// 목표 시간 직접 입력에 타이핑한다(GROMO-1098).
async function typeDuration(text: string) {
  const input = await screen.findByTestId('group.challenge.durationInput');
  await act(async () => {
    fireEvent.changeText(input, text);
  });
}

// 참가비 직접 입력에 타이핑한다(GROMO-1428) — 빈 값 = 내기 없음.
async function typeStake(text: string) {
  const input = await screen.findByTestId('group.challenge.stakeInput');
  await act(async () => {
    fireEvent.changeText(input, text);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateChallenge.mockResolvedValue({ id: 'c1', nonParticipants: [] });
  // 기본은 KST 새벽 4시 — 기본 창(09:00~12:00)이 아직 오지 않은 시각이라 '지남' 안내가 없다.
  mockNowSeconds.mockReturnValue(4 * 3600);
});

describe('전송값', () => {
  test('기본값은 FOCUS · 하루 누적 · 60분 — 요일만 고르면 그대로 나간다', async () => {
    await renderSheet();
    await pickDay('월');
    await press('만들기');

    // bet 키 부재까지 잠근다(정확 일치) — 참가비를 안 정했으면 내기 없이 만들어져야 한다.
    expect(mockCreateChallenge).toHaveBeenCalledWith(GROUP_ID, {
      missionCategory: 'FOCUS',
      missionType: 'DURATION',
      durationMinutes: 60,
      repeatDays: ['MON'],
    });
    expect(onCreated).toHaveBeenCalled();
  });

  // FR-4·N3 — 기본값이 없다. "언제 도는지"를 의식하지 않고는 만들 수 없다.
  test('요일을 하나도 안 고르면 안내가 뜨고 제출이 막힌다', async () => {
    await renderSheet();
    expect(screen.getByText(DOW_REQUIRED)).toBeOnTheScreen();

    await press('만들기');
    expect(mockCreateChallenge).not.toHaveBeenCalled();

    // 하나 고르면 안내가 사라지고 제출된다.
    await pickDay('수');
    expect(screen.queryByText(DOW_REQUIRED)).toBeNull();
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ repeatDays: ['WED'] }),
    );
  });

  test('요일은 누른 순서와 무관하게 월~일 순으로 정렬되어 나간다', async () => {
    await renderSheet();
    await pickDay('금');
    await pickDay('월');
    await pickDay('수');
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ repeatDays: ['MON', 'WED', 'FRI'] }),
    );
  });

  test('다시 누르면 해제된다 — 전부 해제하면 다시 잠긴다', async () => {
    await renderSheet();
    await pickDay('월');
    await pickDay('월');

    expect(screen.getByText(DOW_REQUIRED)).toBeOnTheScreen();
    await press('만들기');
    expect(mockCreateChallenge).not.toHaveBeenCalled();
  });

  test('세그먼트·칩으로 고른 값이 그대로 나간다', async () => {
    await renderSheet();
    await press('스크린타임');
    await press('120분');
    await pickDay('월');
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(GROUP_ID, {
      missionCategory: 'SCREEN_TIME',
      missionType: 'DURATION',
      durationMinutes: 120,
      repeatDays: ['MON'],
    });
  });

  test('시간대를 고르면 "HH:mm:ss" 창 시각이 함께 나간다 — 기본 09:00~12:00', async () => {
    await renderSheet();
    await press('시간대');
    await pickDay('월');
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(GROUP_ID, {
      missionCategory: 'FOCUS',
      missionType: 'TIME_WINDOW',
      durationMinutes: 60,
      repeatDays: ['MON'],
      windowStart: '09:00:00',
      windowEnd: '12:00:00',
    });
  });

  test('휠로 바꾼 창 시각이 그대로 나간다', async () => {
    await renderSheet();
    await press('시간대');
    await pickDay('월');
    // 종료 시(두 번째 시 휠)를 15시로, 시작 시(첫 번째 시 휠)를 13시로 — 13:00~15:00.
    await pressNth('15시', 1);
    await pressNth('13시', 0);
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({
        windowStart: '13:00:00',
        windowEnd: '15:00:00',
      }),
    );
  });

  test('생성 성공 시에만 GA4 이벤트를 계약 파라미터로 발행한다', async () => {
    await renderSheet();
    await press('시간대');
    await pickDay('월');
    await press('만들기');
    expect(logGroupChallengeCreated).toHaveBeenCalledWith({
      mission_type: 'TIME_WINDOW',
      mission_category: 'FOCUS',
      duration_minutes: 60,
      has_window: true,
    });

    jest.clearAllMocks();
    mockCreateChallenge.mockRejectedValueOnce(axiosErrorWith(409, 'CHALLENGE_DUPLICATE'));
    await renderSheet();
    await pickDay('월');
    await press('만들기');
    expect(logGroupChallengeCreated).not.toHaveBeenCalled();
  });

  test('내기를 켠 생성은 group_bet_enabled를 함께 발행한다 — 지표의 유일한 소스 (PR #565 codex)', async () => {
    await renderSheet();
    await pickDay('월');
    await typeStake('300');
    await press('만들기');
    expect(logGroupBetEnabled).toHaveBeenCalledWith({
      stake: 300,
      mission_type: 'DURATION',
      mission_category: 'FOCUS',
    });

    // 참가비 없이 만들면 발행하지 않는다 — 내기 없는 생성은 켜짐 비율 분자가 아니다.
    jest.clearAllMocks();
    await renderSheet();
    await pickDay('월');
    await press('만들기');
    expect(logGroupBetEnabled).not.toHaveBeenCalled();
  });
});

// §A6-1(N25) — 창은 자정을 걸칠 수 없다. 요일이 회차를 가르는 축이라 창이 요일 경계를 넘으면
// 판정·겹침·정산 귀속이 전부 모호해진다. 종전 GROMO-1110의 허용을 되돌린다 — 휠 선택 자체는
// 막지 않고(되돌리면 규칙을 알 길이 없다) 인라인 안내 + CTA 잠금으로 이유를 말한다.
describe('자정 걸침 창 금지', () => {
  test('시작 > 종료는 안내를 띄우고 제출을 막는다 — 되돌리면 다시 만들 수 있다', async () => {
    await renderSheet();
    await press('시간대');
    await pickDay('월');
    // 종료를 08시로 — 09:00~08:00 자정 걸침이다.
    await pressNth('8시', 1);

    expect(screen.getByTestId('group.challenge.windowInvalid')).toBeOnTheScreen();
    expect(screen.getByText(MIDNIGHT_CAPTION)).toBeOnTheScreen();
    await press('만들기');
    expect(mockCreateChallenge).not.toHaveBeenCalled();

    // 종료를 13시로 고치면 안내가 사라지고 제출된다.
    await pressNth('13시', 1);
    expect(screen.queryByTestId('group.challenge.windowInvalid')).toBeNull();
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ windowStart: '09:00:00', windowEnd: '13:00:00' }),
    );
  });

  test('시작 = 종료도 같은 안내로 막는다', async () => {
    await renderSheet();
    await press('시간대');
    await pickDay('월');
    // 종료를 09시로 — 시작(09:00)과 같은 시각이다.
    await pressNth('9시', 1);

    expect(screen.getByText(MIDNIGHT_CAPTION)).toBeOnTheScreen();
    await press('만들기');
    expect(mockCreateChallenge).not.toHaveBeenCalled();
  });

  test('무효 창에서는 목표분 칩을 잠그지 않는다 — 창 안내가 이미 CTA를 막고 있다', async () => {
    await renderSheet();
    await press('시간대');
    await pressNth('8시', 1);

    // 길이 파생(칩 잠금)이 무효 창의 0분 길이로 전부 잠겨 버리면 원인이 두 갈래로 보인다.
    expect(screen.getByTestId('group.challenge.duration.180')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: false }),
    );
  });
});

describe('목표분 칩 × 창 길이', () => {
  test('창 길이를 넘는 칩은 잠긴다 — 눌러도 선택되지 않는다', async () => {
    await renderSheet();
    await press('시간대');
    await pickDay('월');
    // 종료를 10시로 — 창 09:00~10:00 = 60분. 120·180 칩이 잠긴다.
    await pressNth('10시', 1);
    await press('120분');
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ durationMinutes: 60 }),
    );
  });

  test('창이 줄어 현재 목표가 안 들어가면 들어가는 가장 큰 칩으로 당긴다', async () => {
    await renderSheet();
    await press('시간대');
    await pickDay('월');
    await press('180분');
    // 창을 09:00~10:00(60분)으로 줄인다 — 180은 못 들어가므로 60으로 스냅.
    await pressNth('10시', 1);
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ durationMinutes: 60 }),
    );
  });

  test('하루 누적 방식에서는 창 길이 잠금이 없다', async () => {
    await renderSheet();
    await press('180분');
    await pickDay('월');
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ durationMinutes: 180 }),
    );
  });
});

// 프리셋 칩 밖 임의 분(GROMO-1098) — 칩과 직접 입력은 durationText 하나를 쓰는 단일 소스다.
// 검증(GROMO-1278)은 서버 400(LLD §2 검증 5~7)의 선제 안내다.
describe('목표 시간 직접 입력', () => {
  test('프리셋 밖 임의 분(45)을 치면 그대로 제출된다', async () => {
    await renderSheet();
    await typeDuration('45');
    await pickDay('월');
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ missionType: 'DURATION', durationMinutes: 45 }),
    );
  });

  test('시간대 방식에서도 임의 분(90)이 창 시각과 함께 나간다', async () => {
    await renderSheet();
    await press('시간대');
    await typeDuration('90');
    await pickDay('월');
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(GROUP_ID, {
      missionCategory: 'FOCUS',
      missionType: 'TIME_WINDOW',
      durationMinutes: 90,
      repeatDays: ['MON'],
      windowStart: '09:00:00',
      windowEnd: '12:00:00',
    });
  });

  // §A6-bis(N51) — 하루형 상한은 카테고리별이다: FOCUS 1,080분(18h) · SCREEN_TIME 720분(12h).
  test.each(['0', '1081'])(
    'FOCUS 하루형 범위 밖(%s)은 상한 안내를 띄우고 제출을 막는다',
    async (bad) => {
      await renderSheet();
      await pickDay('월');
      await typeDuration(bad);

      expect(
        screen.getByText('목표 시간은 1~1,080분(18시간) 사이로 입력해 주세요'),
      ).toBeOnTheScreen();
      await press('만들기');
      expect(mockCreateChallenge).not.toHaveBeenCalled();
    },
  );

  test('SCREEN_TIME 하루형은 720분(12시간)이 상한이다', async () => {
    await renderSheet();
    await press('스크린타임');
    await pickDay('월');
    await typeDuration('721');

    expect(screen.getByText('목표 시간은 1~720분(12시간) 사이로 입력해 주세요')).toBeOnTheScreen();
    await press('만들기');
    expect(mockCreateChallenge).not.toHaveBeenCalled();

    // 상한 값 자체는 유효하다 — 경계에서 잘리면 상한이 상한이 아니다.
    await typeDuration('720');
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ durationMinutes: 720 }),
    );
  });

  test('빈 값은 제출만 막고 빨간 안내는 띄우지 않는다(치우는 중일 뿐이다)', async () => {
    await renderSheet();
    await pickDay('월');
    await typeDuration('');

    expect(screen.queryByText('목표 시간은 1~1,080분(18시간) 사이로 입력해 주세요')).toBeNull();
    await press('만들기');
    expect(mockCreateChallenge).not.toHaveBeenCalled();
  });

  test('숫자가 아닌 입력은 걸러진다', async () => {
    await renderSheet();
    await typeDuration('ab3');

    const input = await screen.findByTestId('group.challenge.durationInput');
    expect(input.props.value).toBe('3');
  });

  // 표시 문자열과 제출값(파싱 결과)이 어긋나면 안 된다 — "0007"이 보이는데 7이 나가는 상태 금지.
  // 홑 "0"은 치는 중간 상태라 남긴다(범위 안내가 받는다 — 위 범위 검증 케이스).
  test('선행 0은 접힌다("0007" → "7") — 표시값 그대로 제출된다', async () => {
    await renderSheet();
    await pickDay('월');
    await typeDuration('0007');

    const input = await screen.findByTestId('group.challenge.durationInput');
    expect(input.props.value).toBe('7');
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ durationMinutes: 7 }),
    );
  });

  test('시간대 방식에서 창 길이를 넘는 입력은 환산 병기 안내를 띄우고 제출을 막는다', async () => {
    await renderSheet();
    await press('시간대');
    await pickDay('월');
    // 기본 창 09:00~12:00 = 180분 — 200분은 창보다 길다.
    await typeDuration('200');

    expect(
      screen.getByText('시간대보다 길어요. 180분(3시간) 이하로 입력해 주세요'),
    ).toBeOnTheScreen();
    await press('만들기');
    expect(mockCreateChallenge).not.toHaveBeenCalled();

    // 같은 값도 하루 누적 방식에서는 창 제한이 없다 — 그대로 제출된다.
    await press('하루 누적');
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ missionType: 'DURATION', durationMinutes: 200 }),
    );
  });

  // §A6-3 — SCREEN_TIME 창의 목표는 15분 배수만 유효하다(측정 눈금). 서버
  // CHALLENGE_GOAL_NOT_ALIGNED(400)의 선제 안내다.
  test('SCREEN_TIME 창의 15분 배수가 아닌 목표는 눈금 안내를 띄우고 제출을 막는다', async () => {
    await renderSheet();
    await press('스크린타임');
    await press('시간대');
    await pickDay('월');
    await typeDuration('100');

    expect(
      screen.getByText('사용 시간은 15분 단위로 집계돼요. 15·30·45분처럼 골라 주세요'),
    ).toBeOnTheScreen();
    await press('만들기');
    expect(mockCreateChallenge).not.toHaveBeenCalled();

    await typeDuration('90');
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ missionCategory: 'SCREEN_TIME', durationMinutes: 90 }),
    );
  });

  // §A6-4(N31) — 창형 FOCUS 판정이 `분 ≥ 목표 − 5(관용치)`라 5분 이하 목표는 0분도 달성이다.
  test('FOCUS 창의 5분 이하 목표는 관용치 안내를 띄우고 제출을 막는다', async () => {
    await renderSheet();
    await press('시간대');
    await pickDay('월');
    await typeDuration('5');

    expect(
      screen.getByText('목표 시간은 5분보다 길어야 해요. 목표에서 5분 모자라도 달성으로 인정돼요'),
    ).toBeOnTheScreen();
    await press('만들기');
    expect(mockCreateChallenge).not.toHaveBeenCalled();

    await typeDuration('6');
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ durationMinutes: 6 }),
    );
  });

  test('칩을 탭하면 입력값이 그 칩 값으로 바뀐다(단일 소스)', async () => {
    await renderSheet();
    await pickDay('월');
    await typeDuration('45');
    await press('60분');

    const input = await screen.findByTestId('group.challenge.durationInput');
    expect(input.props.value).toBe('60');
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ durationMinutes: 60 }),
    );
  });

  test('창이 줄어 입력값이 창보다 길어지면 창 길이로 당긴다(칩 스냅의 일반화)', async () => {
    await renderSheet();
    await press('시간대');
    await pickDay('월');
    await typeDuration('150');
    // 종료 분을 12:30으로(창 210분) — 150은 그대로. 이어서 종료 시를 10시로(창 10:30, 90분)
    // 줄이면 150이 창 길이 90으로 당겨진다 — 칩에 없는 값으로도 스냅된다.
    await pressNth('30분', 1);
    await pressNth('10시', 1);

    const input = await screen.findByTestId('group.challenge.durationInput');
    expect(input.props.value).toBe('90');
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ durationMinutes: 90 }),
    );
  });

  // SCREEN_TIME 창의 클램프는 눈금(15분 배수)까지 맞춘다 — 창 길이 그대로 당기면 눈금 위반
  // 값이 자동으로 만들어져 CTA만 막힌다.
  test('SCREEN_TIME 창 축소 클램프는 15분 배수로 스냅된다', async () => {
    await renderSheet();
    await press('스크린타임');
    await press('시간대');
    await pickDay('월');
    await typeDuration('180');
    // 창을 09:00~10:40(100분)으로 줄인다 — 100이 아니라 90(15분 배수)으로 당겨진다.
    // (분을 먼저 12:40으로 늘려 두고 시를 줄인다 — 중간 상태에서 클램프가 먼저 돌지 않게.)
    await pressNth('40분', 1);
    await pressNth('10시', 1);

    const input = await screen.findByTestId('group.challenge.durationInput');
    expect(input.props.value).toBe('90');
  });

  test('SCREEN_TIME 창이 15분 미만이면 목표를 비운다 — 비눈금 폴백 금지 (PR #565 리뷰)', async () => {
    await renderSheet();
    await press('스크린타임');
    await press('시간대');
    await pickDay('월');
    await typeDuration('180');
    // 창을 09:00~09:10(10분)으로 줄인다 — 유효한 15분 배수 목표가 존재하지 않는다.
    // length(10) 폴백은 눈금 위반이라 CTA만 잠긴 채 남으므로 빈 값으로 비워야 한다.
    await pressNth('10분', 1);
    await pressNth('9시', 1);

    const input = await screen.findByTestId('group.challenge.durationInput');
    expect(input.props.value).toBe('');
  });
});

// FR-9-2(GROMO-1278) — 분 입력은 시간 환산을 병기한다. 240분이 4시간이라는 걸 암산하게 두지 않는다.
describe('시간 환산 병기', () => {
  test('60분 이상이면 "90분 · 1시간 30분" 형식으로 병기된다', async () => {
    await renderSheet();
    await typeDuration('90');
    expect(screen.getByTestId('group.challenge.durationHours')).toHaveTextContent(
      '90분 · 1시간 30분',
    );

    await typeDuration('120');
    expect(screen.getByTestId('group.challenge.durationHours')).toHaveTextContent('120분 · 2시간');

    await typeDuration('1080');
    expect(screen.getByTestId('group.challenge.durationHours')).toHaveTextContent(
      '1,080분 · 18시간',
    );
  });

  test('60분 미만은 환산할 것이 없다 — 병기하지 않는다', async () => {
    await renderSheet();
    await typeDuration('45');
    expect(screen.queryByTestId('group.challenge.durationHours')).toBeNull();
  });
});

describe('안내 문구', () => {
  test('카테고리에 따라 목표의 방향(이상/이하) 캡션이 바뀐다 — "도는 날" 기준으로 말한다', async () => {
    await renderSheet();
    expect(screen.getByText('도는 날마다 목표 시간 이상 집중하면 달성이에요')).toBeOnTheScreen();

    await press('스크린타임');
    expect(
      screen.getByText(
        '도는 날의 스크린타임을 목표 이하로 유지하면 달성이에요. 권한을 허용한 멤버만 참여해요',
      ),
    ).toBeOnTheScreen();
  });

  // 계약이 문구까지 고정했다 — FOCUS 창은 판정 관용치, SCREEN_TIME 창은 15분 눈금 측정 한계.
  // 돈이 걸릴 수 있는 판정 기준이라 만들기 전에 고지한다.
  test('FOCUS × 시간대는 5분 관용치를 안내한다', async () => {
    await renderSheet();
    await press('시간대');
    expect(screen.getByText(/목표에서 5분 모자라도 달성으로 인정돼요/)).toBeOnTheScreen();
  });

  test('SCREEN_TIME × 시간대는 측정 한계를 안내한다', async () => {
    await renderSheet();
    await press('스크린타임');
    await press('시간대');
    expect(
      screen.getByText(
        /사용 시간은 15분 단위로 집계돼 오차가 있을 수 있어요\. 앱 버전이나 기기 상태에 따라 집계가 늦거나 누락될 수 있어요/,
      ),
    ).toBeOnTheScreen();
  });
});

// GROMO-1428(N26) — 내기를 켤지는 생성 시트가 유일한 자리고, 만든 뒤에는 끌 수 없다.
// 참가비 프리셋 칩·잔액 표기는 GROMO-1424(Phase 2)가 얹는다 — 여기는 직접 입력과 고지만.
describe('참가비(내기)', () => {
  test('참가비를 정하면 bet: { enabled, stake }가 실려 나간다', async () => {
    await renderSheet();
    await pickDay('월');
    await typeStake('300');
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(GROUP_ID, {
      missionCategory: 'FOCUS',
      missionType: 'DURATION',
      durationMinutes: 60,
      repeatDays: ['MON'],
      bet: { enabled: true, stake: 300 },
    });
  });

  test.each(['0', '3001'])(
    '범위 밖 참가비(%s)는 안내를 띄우고 제출을 막는다 — N30 상한 3,000',
    async (bad) => {
      await renderSheet();
      await pickDay('월');
      await typeStake(bad);

      expect(screen.getByText('참가비는 1~3,000코인 사이로 정해 주세요')).toBeOnTheScreen();
      await press('만들기');
      expect(mockCreateChallenge).not.toHaveBeenCalled();
    },
  );

  test('상한 값(3,000)은 유효하다', async () => {
    await renderSheet();
    await pickDay('월');
    await typeStake('3000');
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ bet: { enabled: true, stake: 3000 } }),
    );
  });

  test('불가역 고지가 항상 보인다 — 만든 뒤에는 끌 수 없다(N26)', async () => {
    await renderSheet();
    expect(screen.getByTestId('group.challenge.betNote')).toHaveTextContent(
      /내기는 만든 뒤에 끌 수 없어요 — 빼려면 챌린지를 삭제하고 다시 만들어요/,
    );
  });
});

describe('생성 결과', () => {
  test('nonParticipants가 있으면 안내 Alert를 띄우고 그래도 성공으로 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateChallenge.mockResolvedValue({
      id: 'c1',
      nonParticipants: [{ userId: 'u2', nickname: '수빈' }],
    });
    await renderSheet();
    await press('스크린타임');
    await pickDay('월');
    await press('만들기');

    expect(alertSpy).toHaveBeenCalledWith(
      '챌린지를 만들었어요',
      '일부 멤버는 스크린타임 권한이 없어 참여할 수 없어요',
    );
    // 생성 자체는 성공이다 — 시트는 닫히고 부모가 재조회한다.
    expect(onCreated).toHaveBeenCalled();
  });

  test('nonParticipants가 비어 있으면 Alert를 띄우지 않는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderSheet();
    await pickDay('월');
    await press('만들기');

    expect(alertSpy).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalled();
  });
});

describe('실패', () => {
  // 목록 조회 이후에 다른 방장이 같은 조합을 만들면 세그먼트를 막아 뒀어도 409가 온다 —
  // 공통 문구로 떨어뜨리면 "잠시 후 다시 시도"를 반복해도 영원히 같은 실패만 본다.
  // 구서버 ACTIVE_CHALLENGE_EXISTS · V20 CHALLENGE_DUPLICATE · v2 CHALLENGE_ALREADY_EXISTS는
  // 전부 같은 사실이다(LLD §2 검증 4).
  test.each(['ACTIVE_CHALLENGE_EXISTS', 'CHALLENGE_DUPLICATE', 'CHALLENGE_ALREADY_EXISTS'])(
    '%s는 해결 방법이 담긴 전용 문구로 알린다',
    async (code) => {
      mockCreateChallenge.mockRejectedValueOnce(axiosErrorWith(409, code));
      await renderSheet();
      await pickDay('월');
      await press('만들기');

      expect(
        screen.getByText('이미 같은 종류의 챌린지가 있어요. 기존 챌린지를 삭제하고 만들어주세요.'),
      ).toBeOnTheScreen();
      expect(onCreated).not.toHaveBeenCalled();

      // 실패 후에도 다시 시도할 수 있어야 한다(submitting이 걸려 있으면 안 된다).
      mockCreateChallenge.mockResolvedValueOnce({ id: 'c1', nonParticipants: [] });
      await press('만들기');
      expect(onCreated).toHaveBeenCalled();
    },
  );

  // §A5 — 겹침 판정은 (요일 교집합 ≠ ∅) ∧ (시간대 간격 < 15분)이다. 요일을 바꿔도 시간을
  // 바꿔도 풀리므로 두 해법이 모두 문장에 드러나야 한다(GROMO-1273).
  test('CHALLENGE_WINDOW_OVERLAP은 요일·시간 두 해법이 담긴 문구로 알린다', async () => {
    mockCreateChallenge.mockRejectedValueOnce(axiosErrorWith(409, 'CHALLENGE_WINDOW_OVERLAP'));
    await renderSheet();
    await press('시간대');
    await pickDay('월');
    await press('만들기');

    expect(
      screen.getByText(
        '요일이 겹치는 다른 시간대 챌린지와 시간이 겹치거나 간격이 15분보다 좁아요. ' +
          '겹치지 않는 요일을 고르거나 시간대를 15분 이상 띄워 주세요.',
      ),
    ).toBeOnTheScreen();
    expect(onCreated).not.toHaveBeenCalled();
  });

  test('CHALLENGE_LIMIT_EXCEEDED는 4개 상한과 해법을 알린다', async () => {
    mockCreateChallenge.mockRejectedValueOnce(axiosErrorWith(409, 'CHALLENGE_LIMIT_EXCEEDED'));
    await renderSheet();
    await pickDay('월');
    await press('만들기');

    expect(
      screen.getByText('챌린지는 4개까지 만들 수 있어요. 하나를 종료하고 다시 시도해 주세요.'),
    ).toBeOnTheScreen();
  });

  // V20 유니크 인덱스가 서버 레이스를 봉합했지만, 같은 틱의 연타는 두 번째 요청이 409로 튕겨
  // 성공한 시트 위에 에러가 뜨는 혼선을 만든다. state는 리렌더 뒤에야 보이므로 ref 잠금으로 막는다.
  test('같은 틱에 연타해도 생성 요청은 한 번만 나간다', async () => {
    let settle: (v: CreateChallengeResponse) => void = () => {};
    mockCreateChallenge.mockReturnValue(
      new Promise<CreateChallengeResponse>((resolve) => {
        settle = resolve;
      }),
    );
    await renderSheet();
    await pickDay('월');
    const btn = await screen.findByText('만들기');
    // 두 탭을 한 act 안에 묶는다 — 사이에 리렌더가 끼면 disabled·spinner가 먼저 서서 잠금이 없어도
    // 두 번째 탭이 막히고, 회귀를 못 잡는 테스트가 된다(RNTL이 내부 act를 겹쳐 경고를 한 줄 남긴다).
    await act(async () => {
      fireEvent.press(btn);
      fireEvent.press(btn);
    });

    expect(mockCreateChallenge).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle({ id: 'c1', nonParticipants: [] });
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  test('사라진 그룹(NOT_FOUND)은 전용 문구로 알린다', async () => {
    mockCreateChallenge.mockRejectedValueOnce(axiosErrorWith(404, 'NOT_FOUND'));
    await renderSheet();
    await pickDay('월');
    await press('만들기');

    expect(screen.getByText('사라진 그룹이에요.')).toBeOnTheScreen();
  });
});

// 동시 활성 제한은 카테고리×방식 조합당 1개다(V20). 애초에 실패할 조합을 못 고르게 막되,
// 일형이 있다고 창형까지 잠그면 이번 확장의 핵심 경로(일형+창형 공존)가 막힌다.
describe('이미 있는 조합', () => {
  test('조합이 찬 방식만 잠긴다 — 일형이 있어도 창형은 만들 수 있다', async () => {
    await renderSheet([{ category: 'FOCUS', type: 'DURATION' }]);
    // 초기 선택이 비어 있는 조합(FOCUS×시간대)으로 온다.
    await pickDay('월');
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ missionCategory: 'FOCUS', missionType: 'TIME_WINDOW' }),
    );
  });

  test('한 카테고리의 두 방식이 다 차면 그 카테고리 자체가 잠긴다', async () => {
    await renderSheet([
      { category: 'FOCUS', type: 'DURATION' },
      { category: 'FOCUS', type: 'TIME_WINDOW' },
    ]);
    // 초기 선택은 SCREEN_TIME으로 밀린다.
    await pickDay('월');
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ missionCategory: 'SCREEN_TIME' }),
    );

    // 잠긴 카테고리는 눌러도 선택되지 않는다 — 성공한 시트는 잠긴 채 닫히므로 새로 연다.
    mockCreateChallenge.mockClear();
    await renderSheet([
      { category: 'FOCUS', type: 'DURATION' },
      { category: 'FOCUS', type: 'TIME_WINDOW' },
    ]);
    await press('집중 시간');
    await pickDay('월');
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ missionCategory: 'SCREEN_TIME' }),
    );
  });

  test('카테고리를 바꿀 때 그 카테고리에서 찬 방식을 피해 준다', async () => {
    await renderSheet([{ category: 'SCREEN_TIME', type: 'DURATION' }]);
    // 초기: FOCUS×하루 누적(비어 있음). 스크린타임으로 바꾸면 하루 누적이 차 있어 시간대로 민다.
    await press('스크린타임');
    await pickDay('월');
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ missionCategory: 'SCREEN_TIME', missionType: 'TIME_WINDOW' }),
    );
  });

  test('4조합이 전부 차면 만들기 자체를 막고 이유를 알린다', async () => {
    await renderSheet([
      { category: 'FOCUS', type: 'DURATION' },
      { category: 'FOCUS', type: 'TIME_WINDOW' },
      { category: 'SCREEN_TIME', type: 'DURATION' },
      { category: 'SCREEN_TIME', type: 'TIME_WINDOW' },
    ]);
    expect(screen.getByText('모든 종류의 챌린지가 이미 있어요')).toBeOnTheScreen();

    await pickDay('월');
    await press('만들기');
    expect(mockCreateChallenge).not.toHaveBeenCalled();
  });

  // 그룹 생성이 챌린지를 만들지 않게 된 뒤(D18)로 '창형만 있는 카테고리'가 실제로 생긴다 —
  // 예전 문자열 하위 호환(카테고리 = DURATION 점유 해석)이 남아 있으면 이 경우 매트릭스가
  // 100% 반전됐다(되는 하루 누적이 잠기고, 409가 확정된 시간대가 열린다 — GROMO-1222).
  test('창형만 있는 카테고리는 하루 누적이 열려 초기 선택으로 오고 제출된다', async () => {
    await renderSheet([{ category: 'FOCUS', type: 'TIME_WINDOW' }]);
    await pickDay('월');
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ missionCategory: 'FOCUS', missionType: 'DURATION' }),
    );
  });

  test('두 카테고리 모두 창형만 있으면 하루 누적은 양쪽 다 열려 있다', async () => {
    await renderSheet([
      { category: 'FOCUS', type: 'TIME_WINDOW' },
      { category: 'SCREEN_TIME', type: 'TIME_WINDOW' },
    ]);

    // 초기 선택은 비어 있는 FOCUS×하루 누적 — 방식 세그먼트가 잠겨 있지 않다.
    expect(screen.getByTestId('group.challenge.type.DURATION')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: false, selected: true }),
    );
    // 스크린타임으로 바꿔도 하루 누적은 열려 있다 — 점유된 것은 창형뿐이다.
    await press('스크린타임');
    expect(screen.getByTestId('group.challenge.type.DURATION')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: false, selected: true }),
    );

    await pickDay('월');
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ missionCategory: 'SCREEN_TIME', missionType: 'DURATION' }),
    );
  });
});

describe('목표 라벨', () => {
  test('카테고리에 따라 라벨이 갈린다(그룹 만들기 폼과 같은 문구)', async () => {
    await renderSheet();
    expect(screen.getByText('하루 목표 집중 시간')).toBeOnTheScreen();

    await press('스크린타임');
    expect(screen.getByText('하루 목표 스크린타임')).toBeOnTheScreen();
  });

  test('시간대 방식에서는 창 안 목표 라벨로 바뀐다', async () => {
    await renderSheet();
    await press('시간대');
    expect(screen.getByText('시간대 안 목표 시간')).toBeOnTheScreen();
  });
});

// 오늘 창이 이미 지난 시간대로 만들 때의 안내. 창은 반복되는 time-of-day라 생성 자체는 정상이다.
// 막지 않고 사실만 알린다. 요일 반복(§A3) 뒤로 "내일"이 다음 활성일이라는 보장이 없다 —
// 「다음 도는 날」로 말하고, **오늘이 도는 요일일 때만** 띄운다(GROMO-1273).
describe('다음 도는 날 적용 안내', () => {
  const NOTE = '오늘 시간대가 지나 다음 도는 날부터 적용돼요';

  test('오늘이 도는 요일이고 창이 지났으면(KST 기준) 안내가 뜬다', async () => {
    mockNowSeconds.mockReturnValue(13 * 3600); // KST 13:00 — 기본 창 09:00~12:00은 이미 끝났다
    await renderSheet();
    await press('시간대');
    await pickAllDays(); // 오늘이 무슨 요일이든 포함되게 한다

    expect(screen.getByTestId('group.challenge.tomorrowNote')).toBeOnTheScreen();
    expect(screen.getByText(NOTE)).toBeOnTheScreen();
    // 판정 축은 반드시 Asia/Seoul 벽시계다 — 기기 로컬 시각이면 비KST 기기에서 하루 어긋난다.
    expect(mockNowSeconds).toHaveBeenCalledWith('Asia/Seoul');
  });

  // 창 진행 중(10:00)에도 안내가 떠야 한다 — 서버는 창 시작 후 당일 회차를 만들지 않으므로(N35)
  // "오늘부터"라는 오인이 바로 이 구간에서 생긴다(PR #565 codex).
  test('창 진행 중에도(시작은 지났으니) 안내가 뜬다', async () => {
    mockNowSeconds.mockReturnValue(10 * 3600); // 창 한가운데 — 시작(09:00)은 지났다
    await renderSheet();
    await press('시간대');
    await pickAllDays();

    expect(screen.queryByTestId('group.challenge.tomorrowNote')).toBeNull();
  });

  test('하루 누적(DURATION)에는 안내가 없다 — 창이 없으니 지날 것도 없다', async () => {
    mockNowSeconds.mockReturnValue(23 * 3600);
    await renderSheet();
    await pickAllDays();

    expect(screen.queryByTestId('group.challenge.tomorrowNote')).toBeNull();
  });

  // 오늘 안 도는 챌린지에 "오늘 시간대가 지나"는 거짓 안내다 — 오늘이 선택 요일일 때만 띄운다.
  test('오늘이 도는 요일이 아니면 창이 지났어도 안내가 없다', async () => {
    // KST 2026-08-10(월) 12:00로 고정 — kstTodayRepeatDay()가 MON을 돌려준다.
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-08-10T03:00:00Z').getTime());
    try {
      mockNowSeconds.mockReturnValue(13 * 3600);
      await renderSheet();
      await press('시간대');
      await pickDay('화'); // 오늘(월)은 안 도는 챌린지

      expect(screen.queryByTestId('group.challenge.tomorrowNote')).toBeNull();

      // 오늘(월)을 고르면 안내가 나타난다.
      await pickDay('월');
      expect(screen.getByTestId('group.challenge.tomorrowNote')).toBeOnTheScreen();
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('자정 걸침(무효 창)에서는 지남 안내 대신 창 오류 안내가 선다', async () => {
    mockNowSeconds.mockReturnValue(23 * 3600);
    await renderSheet();
    await press('시간대');
    await pickAllDays();
    // 09:00~08:00 자정 걸침으로 바꾼다.
    await pressNth('8시', 1);

    expect(screen.queryByTestId('group.challenge.tomorrowNote')).toBeNull();
    expect(screen.getByText(MIDNIGHT_CAPTION)).toBeOnTheScreen();
  });

  test('안내가 떠도 생성을 막지 않는다', async () => {
    mockNowSeconds.mockReturnValue(13 * 3600);
    await renderSheet();
    await press('시간대');
    await pickAllDays();
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({
        missionType: 'TIME_WINDOW',
        repeatDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      }),
    );
    expect(onCreated).toHaveBeenCalled();
  });
});

// GROMO-1204 — 접근성 + 전송 중 폼 전체 잠금. TouchableOpacity는 disabled를
// accessibilityState로 올려 주지 않아 명시해야 스크린리더가 잠금을 안다. 텍스트 노드 press는
// RNTL이 상위 touchable의 disabled로 막아 주지만, 신뢰 채널은 prop 단언이다(BetSheet 테스트 규격).
describe('접근성 · 전송 중 잠금', () => {
  test('잠긴 방식 세그먼트는 역할·잠김·이유까지 읽힌다', async () => {
    await renderSheet([{ category: 'FOCUS', type: 'DURATION' }]);

    const locked = screen.getByTestId('group.challenge.type.DURATION');
    expect(locked).toHaveProp('accessibilityRole', 'button');
    expect(locked).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: true, selected: false }),
    );
    expect(locked).toHaveProp('accessibilityLabel', '하루 누적');
    expect(locked).toHaveProp('accessibilityHint', '이미 만든 조합이에요');

    // 초기 선택이 비어 있는 조합(시간대)으로 온다 — 선택 상태도 읽힌다.
    // 잠기지 않은 옵션엔 잠긴 이유 힌트가 붙지 않는다.
    const open = screen.getByTestId('group.challenge.type.TIME_WINDOW');
    expect(open).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: true, disabled: false }),
    );
    expect(open.props.accessibilityHint).toBeUndefined();
  });

  test('잠긴 카테고리 세그먼트도 같은 규격으로 읽힌다', async () => {
    await renderSheet([
      { category: 'FOCUS', type: 'DURATION' },
      { category: 'FOCUS', type: 'TIME_WINDOW' },
    ]);

    const locked = screen.getByTestId('group.challenge.category.FOCUS');
    expect(locked).toHaveProp('accessibilityRole', 'button');
    expect(locked).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: true, selected: false }),
    );
    expect(locked).toHaveProp('accessibilityLabel', '집중 시간');
    expect(locked).toHaveProp('accessibilityHint', '이미 만든 조합이에요');
    expect(screen.getByTestId('group.challenge.category.SCREEN_TIME')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: true, disabled: false }),
    );
  });

  test('요일 토글은 요일 전체 이름과 선택 상태가 읽힌다', async () => {
    await renderSheet();
    const mon = screen.getByTestId('group.challenge.dow.MON');
    expect(mon).toHaveProp('accessibilityRole', 'button');
    expect(mon).toHaveProp('accessibilityLabel', '월요일');
    expect(mon).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: false, disabled: false }),
    );

    await pickDay('월');
    expect(screen.getByTestId('group.challenge.dow.MON')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: true }),
    );
  });

  test('창 길이를 넘는 칩은 단위 라벨·잠김·이유까지 읽힌다', async () => {
    await renderSheet();
    await press('시간대');
    // 종료를 10시로 — 창 09:00~10:00 = 60분. 120·180 칩이 잠긴다.
    await pressNth('10시', 1);

    const locked = screen.getByTestId('group.challenge.duration.120');
    expect(locked).toHaveProp('accessibilityRole', 'button');
    expect(locked).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: true, selected: false }),
    );
    expect(locked).toHaveProp('accessibilityLabel', '120분');
    expect(locked).toHaveProp('accessibilityHint', '시간대보다 길어요');

    const open = screen.getByTestId('group.challenge.duration.60');
    expect(open).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: true, disabled: false }),
    );
    expect(open.props.accessibilityHint).toBeUndefined();
  });

  // 전송 중 폼을 안 잠그면: 60분으로 보낸 뒤 120분을 누르면 서버엔 60이 간 채 화면만 120이
  // 된다 — 성공 후 사용자는 자기가 120분 챌린지를 만들었다고 오인한다(BetSheet과 같은 근거).
  test('전송 중에는 세그먼트·요일·칩·직접 입력이 전부 잠기고 처리 중 안내가 뜬다', async () => {
    let settle: (v: CreateChallengeResponse) => void = () => {};
    mockCreateChallenge.mockReturnValue(
      new Promise<CreateChallengeResponse>((resolve) => {
        settle = resolve;
      }),
    );
    await renderSheet();
    await pickDay('월');
    await press('만들기');

    // 처리 중 안내(BetSheet과 같은 문구) + 폼 전체 disabled prop.
    expect(screen.getByText('처리 중이에요…')).toBeOnTheScreen();
    expect(screen.getByTestId('group.challenge.category.SCREEN_TIME')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: true }),
    );
    expect(screen.getByTestId('group.challenge.type.TIME_WINDOW')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: true }),
    );
    expect(screen.getByTestId('group.challenge.dow.TUE')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: true }),
    );
    expect(screen.getByTestId('group.challenge.duration.120')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: true }),
    );
    // 전송 중 잠금은 조합 점유가 아니다 — 잠긴 이유 힌트는 붙지 않는다(처리 중 안내가 받는다).
    expect(
      screen.getByTestId('group.challenge.category.SCREEN_TIME').props.accessibilityHint,
    ).toBeUndefined();

    // 눌러도 선택이 바뀌지 않는다 — disabled가 press를 막는다.
    await press('스크린타임');
    expect(screen.getByTestId('group.challenge.category.SCREEN_TIME')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: false }),
    );
    await press('120분');
    const input = screen.getByTestId('group.challenge.durationInput');
    expect(input.props.value).toBe('60');
    // 직접 입력도 잠긴다 — editable prop이 신뢰 채널이다. 참가비 입력도 같은 규격.
    expect(input).toHaveProp('editable', false);
    expect(screen.getByTestId('group.challenge.stakeInput')).toHaveProp('editable', false);

    await act(async () => {
      settle({ id: 'c1', nonParticipants: [] });
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  // DrumPicker엔 잠금 prop이 없어 휠 영역을 pointerEvents로 걷는다 — 창이 바뀌면 사라질
  // '지남' 안내가 전송 중 휠 탭에도 그대로면 창이 잠겨 있다는 뜻이다.
  test('전송 중에는 창 시각 휠도 막힌다(휠 영역 pointerEvents 잠금)', async () => {
    mockNowSeconds.mockReturnValue(13 * 3600); // 기본 창 09:00~12:00이 이미 지난 시각
    let settle: (v: CreateChallengeResponse) => void = () => {};
    mockCreateChallenge.mockReturnValue(
      new Promise<CreateChallengeResponse>((resolve) => {
        settle = resolve;
      }),
    );
    await renderSheet();
    await press('시간대');
    await pickAllDays();
    expect(screen.getByTestId('group.challenge.tomorrowNote')).toBeOnTheScreen();
    await press('만들기');

    // 종료를 23시로 늘리면 창이 아직 안 지난 게 되어 안내가 사라져야 하지만 —
    // 전송 중엔 휠이 막혀 창이 그대로다(안내 유지).
    await pressNth('23시', 1);
    expect(screen.getByTestId('group.challenge.tomorrowNote')).toBeOnTheScreen();

    await act(async () => {
      settle({ id: 'c1', nonParticipants: [] });
    });
    expect(onCreated).toHaveBeenCalled();
  });

  // pointerEvents="none"은 새 터치만 막는다 — 전송 직전에 시작된 플링(모멘텀) 감속의
  // onChange는 전송 중에도 도달한다(코덱스 리뷰). 호출부(commitWindow)의 잠금 가드가 이를
  // 무시하는지 검증한다 — RNTL press는 pointerEvents에 막혀 이 경로를 지나지 못하므로,
  // 휠 항목의 onPress를 직접 호출해 '감속 중 도달한 onChange'를 흉내 낸다.
  test('전송 중 도달한 휠 onChange(플링 감속)는 무시된다 — 표시·전송값이 어긋나지 않는다', async () => {
    mockNowSeconds.mockReturnValue(13 * 3600); // 기본 창 09:00~12:00이 이미 지난 시각
    let settle: (v: CreateChallengeResponse) => void = () => {};
    mockCreateChallenge.mockReturnValue(
      new Promise<CreateChallengeResponse>((resolve) => {
        settle = resolve;
      }),
    );
    await renderSheet();
    await press('시간대');
    await pickAllDays();
    expect(screen.getByTestId('group.challenge.tomorrowNote')).toBeOnTheScreen();
    await press('만들기');

    // 종료 시 휠(두 번째 시 휠)의 23시 onChange가 pointerEvents를 우회해 도달한다 —
    // 가드가 없으면 창이 09:00~23:00이 되어 '지남' 안내가 사라진다.
    const endHour23 = screen.getAllByText('23시')[1];
    await act(async () => {
      endHour23.props.onPress();
    });
    expect(screen.getByTestId('group.challenge.tomorrowNote')).toBeOnTheScreen();

    await act(async () => {
      settle({ id: 'c1', nonParticipants: [] });
    });
    // 전송값도 탭 시점 값 그대로다.
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ windowEnd: '12:00:00' }),
    );
    expect(onCreated).toHaveBeenCalled();
  });

  // 캡션 텍스트 삽입만으로는 TalkBack/VoiceOver가 읽지 않는다 — 전송 시작을 능동 안내한다.
  test('전송 시작을 announceForAccessibility로 스크린리더에 능동 안내한다', async () => {
    const announceSpy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
    await renderSheet();
    await pickDay('월');
    expect(announceSpy).not.toHaveBeenCalled();

    await press('만들기');
    expect(announceSpy).toHaveBeenCalledWith('처리 중이에요…');
  });
});
