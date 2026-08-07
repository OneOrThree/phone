// ChallengeComposeSheet 전송값·조합 매트릭스·안내 테스트 — 명세 docs/app/group-plan-2.md §3-2,
// 확장 계약 docs/app/challenge-impl-2026-08/contract.md §2.
//
// 여기서 잠그는 것:
//  1) 전송 계약. DURATION은 종전 그대로, TIME_WINDOW는 durationMinutes + KST 앵커(+09:00)
//     windowStart/windowEnd가 함께 나간다 — 오프셋이 빠지면 해외 기기에서 창이 통째로 밀린다.
//  2) 비활성화 매트릭스는 **카테고리×방식 조합**이다(V20 — 조합당 1개, 그룹당 최대 4개).
//     카테고리 단위로 잠그면 일형이 있는 카테고리에 창형을 만들 수 없게 된다.
//  3) 계약이 문구까지 고정한 시간대 안내 2종(FOCUS 관용치 · SCREEN_TIME 측정 한계).
//  4) 창 길이 초과 목표 칩 잠금 — 서버 INVALID_MISSION_PARAMS를 미리 막는다.
//  5) nonParticipants 안내. 생성은 성공했지만 그 멤버들은 집계되지 않는다.
//  6) 목표 시간 직접 입력(GROMO-1098) — 프리셋 밖 임의 분 제출, 1~1440 범위 검증,
//     창 길이 초과 차단, 칩↔입력 단일 소스, 창 축소 시 클램프 동기화.
//  7) 자정 걸침 창 허용 + '내일부터 적용' 안내(GROMO-1110) — 서버는 start==end만 거부하므로
//     앱도 같은 선을 긋고, 창 길이는 서버 windowLengthMinutes와 같은 규칙으로 잰다.
//  8) 접근성·전송 중 잠금(GROMO-1204) — 잠긴 컨트롤은 이유까지 읽히고, 전송 중엔 폼 전체가 잠긴다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Alert } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import ChallengeComposeSheet, { type ExistingChallengeCombo } from './ChallengeComposeSheet';
import { createChallenge } from '@/services/groupApi';
import { logGroupChallengeCreated } from '@/services/analyticsEvents';
import { todayStrKst } from '@/utils/localDate';
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

// 목표 시간 직접 입력에 타이핑한다(GROMO-1098).
async function typeDuration(text: string) {
  const input = await screen.findByTestId('group.challenge.durationInput');
  await act(async () => {
    fireEvent.changeText(input, text);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateChallenge.mockResolvedValue({ id: 'c1', nonParticipants: [] });
  // 기본은 KST 새벽 4시 — 기본 창(09:00~12:00)이 아직 오지 않은 시각이라 '내일부터' 안내가 없다.
  mockNowSeconds.mockReturnValue(4 * 3600);
});

describe('전송값', () => {
  test('기본값은 FOCUS · 매일 목표 · 60분이다', async () => {
    await renderSheet();
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(GROUP_ID, {
      missionCategory: 'FOCUS',
      missionType: 'DURATION',
      durationMinutes: 60,
    });
    expect(onCreated).toHaveBeenCalled();
  });

  test('세그먼트·칩으로 고른 값이 그대로 나간다', async () => {
    await renderSheet();
    await press('스크린타임');
    await press('120분');
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(GROUP_ID, {
      missionCategory: 'SCREEN_TIME',
      missionType: 'DURATION',
      durationMinutes: 120,
    });
  });

  test('시간대를 고르면 KST 앵커(+09:00) 창 시각이 함께 나간다 — 기본 09:00~12:00', async () => {
    await renderSheet();
    await press('시간대');
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(GROUP_ID, {
      missionCategory: 'FOCUS',
      missionType: 'TIME_WINDOW',
      durationMinutes: 60,
      windowStart: `${todayStrKst()}T09:00:00+09:00`,
      windowEnd: `${todayStrKst()}T12:00:00+09:00`,
    });
  });

  test('휠로 바꾼 창 시각이 그대로 나간다', async () => {
    await renderSheet();
    await press('시간대');
    // 종료 시(두 번째 시 휠)를 15시로, 시작 시(첫 번째 시 휠)를 13시로 — 13:00~15:00.
    await pressNth('15시', 1);
    await pressNth('13시', 0);
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({
        windowStart: `${todayStrKst()}T13:00:00+09:00`,
        windowEnd: `${todayStrKst()}T15:00:00+09:00`,
      }),
    );
  });

  // GROMO-1110 — 서버(GroupChallengeService.validateTimeWindowParams)는 start.equals(end)만
  // 거부한다. 앱만 남아 있던 start >= end 거부를 풀어 자정 걸침 창을 만들 수 있게 한다.
  test('자정 걸침 창(시작 > 종료)을 허용한다', async () => {
    await renderSheet();
    await press('시간대');
    // 종료를 08시로 — 09:00~08:00 = 다음 날 새벽까지 이어지는 1,380분 창이다.
    await pressNth('8시', 1);
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({
        windowStart: `${todayStrKst()}T09:00:00+09:00`,
        windowEnd: `${todayStrKst()}T08:00:00+09:00`,
      }),
    );
  });

  test('시작 = 종료가 되는 선택은 거부한다(휠 값 거부 = 선택 유지)', async () => {
    await renderSheet();
    await press('시간대');
    // 종료를 09시로 — 시작(09:00)과 같은 시각이다. 서버도 400을 주므로 앱이 먼저 되돌린다.
    await pressNth('9시', 1);
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ windowEnd: `${todayStrKst()}T12:00:00+09:00` }),
    );
  });

  // 창 길이를 end - start로만 재면 자정 걸침에서 음수가 나와 목표분이 음수로 당겨진다 —
  // 서버 windowLengthMinutes(하루를 넘겨 계산)와 같은 규칙인지 잠근다.
  test('자정 걸침 창의 목표분 보정은 하루를 넘겨 잰 창 길이를 쓴다', async () => {
    await renderSheet();
    await press('시간대');
    await typeDuration('1440');
    // 09:00~08:00 = 1,380분. 1,440분 목표는 창 길이로 당겨진다.
    await pressNth('8시', 1);
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ durationMinutes: 1380 }),
    );
  });

  test('생성 성공 시에만 GA4 이벤트를 계약 파라미터로 발행한다', async () => {
    await renderSheet();
    await press('시간대');
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
    await press('만들기');
    expect(logGroupChallengeCreated).not.toHaveBeenCalled();
  });
});

describe('목표분 칩 × 창 길이', () => {
  test('창 길이를 넘는 칩은 잠긴다 — 눌러도 선택되지 않는다', async () => {
    await renderSheet();
    await press('시간대');
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
    await press('180분');
    // 창을 09:00~10:00(60분)으로 줄인다 — 180은 못 들어가므로 60으로 스냅.
    await pressNth('10시', 1);
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ durationMinutes: 60 }),
    );
  });

  test('매일 목표 방식에서는 창 길이 잠금이 없다', async () => {
    await renderSheet();
    await press('180분');
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ durationMinutes: 180 }),
    );
  });
});

// 프리셋 칩 밖 임의 분(GROMO-1098) — 칩과 직접 입력은 durationText 하나를 쓰는 단일 소스다.
describe('목표 시간 직접 입력', () => {
  test('프리셋 밖 임의 분(45)을 치면 그대로 제출된다', async () => {
    await renderSheet();
    await typeDuration('45');
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
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(GROUP_ID, {
      missionCategory: 'FOCUS',
      missionType: 'TIME_WINDOW',
      durationMinutes: 90,
      windowStart: `${todayStrKst()}T09:00:00+09:00`,
      windowEnd: `${todayStrKst()}T12:00:00+09:00`,
    });
  });

  test.each(['0', '1441'])('범위 밖(%s)은 인라인 안내를 띄우고 제출을 막는다', async (bad) => {
    await renderSheet();
    await typeDuration(bad);

    expect(screen.getByText('목표 시간은 1~1,440분 사이로 입력해 주세요')).toBeOnTheScreen();
    await press('만들기');
    expect(mockCreateChallenge).not.toHaveBeenCalled();
  });

  test('빈 값은 제출만 막고 빨간 안내는 띄우지 않는다(치우는 중일 뿐이다)', async () => {
    await renderSheet();
    await typeDuration('');

    expect(screen.queryByText('목표 시간은 1~1,440분 사이로 입력해 주세요')).toBeNull();
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
    await typeDuration('0007');

    const input = await screen.findByTestId('group.challenge.durationInput');
    expect(input.props.value).toBe('7');
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ durationMinutes: 7 }),
    );
  });

  test('시간대 방식에서 창 길이를 넘는 입력은 안내를 띄우고 제출을 막는다', async () => {
    await renderSheet();
    await press('시간대');
    // 기본 창 09:00~12:00 = 180분 — 200분은 창보다 길다.
    await typeDuration('200');

    expect(screen.getByText('시간대보다 길어요. 180분 이하로 입력해 주세요')).toBeOnTheScreen();
    await press('만들기');
    expect(mockCreateChallenge).not.toHaveBeenCalled();

    // 같은 값도 매일 목표 방식에서는 창 제한이 없다 — 그대로 제출된다.
    await press('매일 목표');
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ missionType: 'DURATION', durationMinutes: 200 }),
    );
  });

  test('칩을 탭하면 입력값이 그 칩 값으로 바뀐다(단일 소스)', async () => {
    await renderSheet();
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
});

describe('안내 문구', () => {
  test('카테고리에 따라 목표의 방향(이상/이하) 캡션이 바뀐다', async () => {
    await renderSheet();
    expect(screen.getByText('하루에 목표 시간 이상 집중하면 달성이에요')).toBeOnTheScreen();

    await press('스크린타임');
    expect(
      screen.getByText(
        '하루 스크린타임을 목표 이하로 유지하면 달성이에요. 권한을 허용한 멤버만 참여해요',
      ),
    ).toBeOnTheScreen();
  });

  // 계약이 문구까지 고정했다(contract.md §2) — FOCUS 창은 판정 관용치, SCREEN_TIME 창은
  // 15분 눈금 측정 한계. 돈이 걸릴 수 있는 판정 기준이라 만들기 전에 고지한다.
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

describe('생성 결과', () => {
  test('nonParticipants가 있으면 안내 Alert를 띄우고 그래도 성공으로 닫는다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateChallenge.mockResolvedValue({
      id: 'c1',
      nonParticipants: [{ userId: 'u2', nickname: '수빈' }],
    });
    await renderSheet();
    await press('스크린타임');
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
    await press('만들기');

    expect(alertSpy).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalled();
  });
});

describe('실패', () => {
  // 목록 조회 이후에 다른 방장이 같은 조합을 만들면 세그먼트를 막아 뒀어도 409가 온다 —
  // 공통 문구로 떨어뜨리면 "잠시 후 다시 시도"를 반복해도 영원히 같은 실패만 본다.
  // V20 신설 CHALLENGE_DUPLICATE와 구서버 ACTIVE_CHALLENGE_EXISTS는 같은 사실이다.
  test.each(['ACTIVE_CHALLENGE_EXISTS', 'CHALLENGE_DUPLICATE'])(
    '%s는 해결 방법이 담긴 전용 문구로 알린다',
    async (code) => {
      mockCreateChallenge.mockRejectedValueOnce(axiosErrorWith(409, code));
      await renderSheet();
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

  test('CHALLENGE_WINDOW_OVERLAP은 시간대를 바꾸라는 전용 문구로 알린다', async () => {
    mockCreateChallenge.mockRejectedValueOnce(axiosErrorWith(409, 'CHALLENGE_WINDOW_OVERLAP'));
    await renderSheet();
    await press('시간대');
    await press('만들기');

    expect(
      screen.getByText(
        '다른 종류의 시간대 챌린지와 시간이 겹쳐요. 겹치지 않는 시간대로 바꿔주세요.',
      ),
    ).toBeOnTheScreen();
    expect(onCreated).not.toHaveBeenCalled();
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
    await press('만들기');
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ missionCategory: 'SCREEN_TIME' }),
    );
  });

  test('카테고리를 바꿀 때 그 카테고리에서 찬 방식을 피해 준다', async () => {
    await renderSheet([{ category: 'SCREEN_TIME', type: 'DURATION' }]);
    // 초기: FOCUS×매일 목표(비어 있음). 스크린타임으로 바꾸면 매일 목표가 차 있어 시간대로 민다.
    await press('스크린타임');
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

    await press('만들기');
    expect(mockCreateChallenge).not.toHaveBeenCalled();
  });

  // 그룹 생성이 챌린지를 만들지 않게 된 뒤(D18)로 '창형만 있는 카테고리'가 실제로 생긴다 —
  // 예전 문자열 하위 호환(카테고리 = DURATION 점유 해석)이 남아 있으면 이 경우 매트릭스가
  // 100% 반전됐다(되는 매일 목표가 잠기고, 409가 확정된 시간대가 열린다 — GROMO-1222).
  test('창형만 있는 카테고리는 매일 목표가 열려 초기 선택으로 오고 제출된다', async () => {
    await renderSheet([{ category: 'FOCUS', type: 'TIME_WINDOW' }]);
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ missionCategory: 'FOCUS', missionType: 'DURATION' }),
    );
  });

  test('두 카테고리 모두 창형만 있으면 매일 목표는 양쪽 다 열려 있다', async () => {
    await renderSheet([
      { category: 'FOCUS', type: 'TIME_WINDOW' },
      { category: 'SCREEN_TIME', type: 'TIME_WINDOW' },
    ]);

    // 초기 선택은 비어 있는 FOCUS×매일 목표 — 방식 세그먼트가 잠겨 있지 않다.
    expect(screen.getByTestId('group.challenge.type.DURATION')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: false, selected: true }),
    );
    // 스크린타임으로 바꿔도 매일 목표는 열려 있다 — 점유된 것은 창형뿐이다.
    await press('스크린타임');
    expect(screen.getByTestId('group.challenge.type.DURATION')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: false, selected: true }),
    );

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

// GROMO-1110 — 오늘 창이 이미 지난 시간대로 만들 때의 안내. 창은 매일 반복되는 time-of-day라
// 생성 자체는 정상이다. 막지 않고 사실만 알린다.
describe('내일부터 적용 안내', () => {
  const NOTE = '오늘 시간대가 지나 내일부터 적용돼요';

  test('오늘 창이 지났으면(KST 기준) 안내가 뜬다', async () => {
    mockNowSeconds.mockReturnValue(13 * 3600); // KST 13:00 — 기본 창 09:00~12:00은 이미 끝났다
    await renderSheet();
    await press('시간대');

    expect(screen.getByTestId('group.challenge.tomorrowNote')).toBeOnTheScreen();
    expect(screen.getByText(NOTE)).toBeOnTheScreen();
    // 판정 축은 반드시 Asia/Seoul 벽시계다 — 기기 로컬 시각이면 비KST 기기에서 하루 어긋난다.
    expect(mockNowSeconds).toHaveBeenCalledWith('Asia/Seoul');
  });

  test('창이 아직 안 끝났으면 안내가 없다', async () => {
    mockNowSeconds.mockReturnValue(10 * 3600); // 창 한가운데
    await renderSheet();
    await press('시간대');

    expect(screen.queryByTestId('group.challenge.tomorrowNote')).toBeNull();
  });

  test('매일 목표(DURATION)에는 안내가 없다 — 창이 없으니 지날 것도 없다', async () => {
    mockNowSeconds.mockReturnValue(23 * 3600);
    await renderSheet();

    expect(screen.queryByTestId('group.challenge.tomorrowNote')).toBeNull();
  });

  test('자정 걸침 창은 안내하지 않는다 — 실질 마감이 자정이라 "오늘 창이 지났다"가 성립하지 않는다', async () => {
    mockNowSeconds.mockReturnValue(23 * 3600);
    await renderSheet();
    await press('시간대');
    // 09:00~08:00 자정 걸침으로 바꾼다.
    await pressNth('8시', 1);

    expect(screen.queryByTestId('group.challenge.tomorrowNote')).toBeNull();
  });

  test('안내가 떠도 생성을 막지 않는다', async () => {
    mockNowSeconds.mockReturnValue(13 * 3600);
    await renderSheet();
    await press('시간대');
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ missionType: 'TIME_WINDOW' }),
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
    expect(locked).toHaveProp('accessibilityLabel', '매일 목표');
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
  test('전송 중에는 세그먼트·칩·직접 입력이 전부 잠기고 처리 중 안내가 뜬다', async () => {
    let settle: (v: CreateChallengeResponse) => void = () => {};
    mockCreateChallenge.mockReturnValue(
      new Promise<CreateChallengeResponse>((resolve) => {
        settle = resolve;
      }),
    );
    await renderSheet();
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
    // 직접 입력도 잠긴다 — editable prop이 신뢰 채널이다.
    expect(input).toHaveProp('editable', false);

    await act(async () => {
      settle({ id: 'c1', nonParticipants: [] });
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  // DrumPicker엔 잠금 prop이 없어 휠 영역을 pointerEvents로 걷는다 — 창이 바뀌면 사라질
  // '내일부터' 안내가 전송 중 휠 탭에도 그대로면 창이 잠겨 있다는 뜻이다.
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
    expect(screen.getByTestId('group.challenge.tomorrowNote')).toBeOnTheScreen();
    await press('만들기');

    // 종료 시 휠(두 번째 시 휠)의 23시 onChange가 pointerEvents를 우회해 도달한다 —
    // 가드가 없으면 창이 09:00~23:00이 되어 '내일부터' 안내가 사라진다.
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
      expect.objectContaining({ windowEnd: `${todayStrKst()}T12:00:00+09:00` }),
    );
    expect(onCreated).toHaveBeenCalled();
  });

  // 캡션 텍스트 삽입만으로는 TalkBack/VoiceOver가 읽지 않는다 — 전송 시작을 능동 안내한다.
  test('전송 시작을 announceForAccessibility로 스크린리더에 능동 안내한다', async () => {
    const announceSpy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
    await renderSheet();
    expect(announceSpy).not.toHaveBeenCalled();

    await press('만들기');
    expect(announceSpy).toHaveBeenCalledWith('처리 중이에요…');
  });
});
