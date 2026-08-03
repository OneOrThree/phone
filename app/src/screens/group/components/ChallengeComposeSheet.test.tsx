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
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import ChallengeComposeSheet, { type ExistingChallengeCombo } from './ChallengeComposeSheet';
import { createChallenge } from '@/services/groupApi';
import { logGroupChallengeCreated } from '@/services/analyticsEvents';
import { todayStr } from '@/utils/localDate';
import type { CreateChallengeResponse, MissionCategory } from '@/types/dto/group';

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

async function renderSheet(existing: (MissionCategory | ExistingChallengeCombo)[] = []) {
  const result = await render(
    <ChallengeComposeSheet
      groupId={GROUP_ID}
      existingCategories={existing}
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
      windowStart: `${todayStr()}T09:00:00+09:00`,
      windowEnd: `${todayStr()}T12:00:00+09:00`,
    });
  });

  test('휠로 바꾼 창 시각이 그대로 나간다', async () => {
    await renderSheet();
    await press('시간대');
    // 종료 시(두 번째 시 휠)를 먼저 15시로 늘린 뒤 시작 시(첫 번째 시 휠)를 13시로 —
    // 시작을 먼저 13시로 올리면 기본 종료(12:00)보다 늦어져 거부된다(뒤집힘 방지 규칙).
    await pressNth('15시', 1);
    await pressNth('13시', 0);
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({
        windowStart: `${todayStr()}T13:00:00+09:00`,
        windowEnd: `${todayStr()}T15:00:00+09:00`,
      }),
    );
  });

  test('시작 ≥ 종료가 되는 선택은 거부한다(휠 값 거부 = 선택 유지)', async () => {
    await renderSheet();
    await press('시간대');
    // 종료를 08시로 — 시작(09:00)보다 이르다. 거부되어 12:00이 유지된다.
    await pressNth('8시', 1);
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ windowEnd: `${todayStr()}T12:00:00+09:00` }),
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
      windowStart: `${todayStr()}T09:00:00+09:00`,
      windowEnd: `${todayStr()}T12:00:00+09:00`,
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

  // 현재 부모(GroupRoomScreen — A3 전유)는 카테고리 문자열만 넘긴다 — 구 만들기 경로가
  // DURATION만 만들었으므로 DURATION 점유로 해석한다(오독은 서버 CHALLENGE_DUPLICATE가 받는다).
  test('하위 호환: 카테고리 문자열은 DURATION 점유로 해석한다', async () => {
    await renderSheet(['FOCUS']);
    await press('만들기');

    // FOCUS×매일 목표가 차 있다고 보고, 비어 있는 FOCUS×시간대로 초기 선택이 온다.
    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ missionCategory: 'FOCUS', missionType: 'TIME_WINDOW' }),
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
