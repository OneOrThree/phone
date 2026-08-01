// ChallengeComposeSheet 전송값·안내 테스트 — 명세 docs/app/group-plan-2.md §3-2.
//
// 여기서 잠그는 것:
//  1) 전송 계약. missionType은 **항상 DURATION**이다 — TIME_WINDOW는 서버가 진행률을
//     지원하지 않아(백 명세 결정 3) 이 폼에서 만들 수 있으면 안 된다.
//  2) nonParticipants 안내. 생성은 성공했지만 그 멤버들은 집계되지 않는다 —
//     조용히 넘기면 방장이 "왜 저 사람만 계속 —인가"를 알 방법이 없다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import ChallengeComposeSheet from './ChallengeComposeSheet';
import { createChallenge } from '@/services/groupApi';
import type { MissionCategory } from '@/types/dto/group';

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

async function renderSheet(existingCategories: MissionCategory[] = []) {
  const result = await render(
    <ChallengeComposeSheet
      groupId={GROUP_ID}
      existingCategories={existingCategories}
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

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateChallenge.mockResolvedValue({ id: 'c1', nonParticipants: [] });
});

describe('전송값', () => {
  test('기본값은 FOCUS · 60분이고 missionType은 DURATION 고정이다', async () => {
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
  // 목록 조회 이후에 다른 방장이 같은 종류를 만들면 세그먼트를 막아 뒀어도 409가 온다 —
  // 공통 문구로 떨어뜨리면 "잠시 후 다시 시도"를 반복해도 영원히 같은 실패만 본다.
  test('ACTIVE_CHALLENGE_EXISTS는 해결 방법이 담긴 전용 문구로 알린다', async () => {
    mockCreateChallenge.mockRejectedValueOnce(axiosErrorWith(409, 'ACTIVE_CHALLENGE_EXISTS'));
    await renderSheet();
    await press('만들기');

    expect(
      screen.getByText('이미 같은 종류의 챌린지가 있어요. 기존 챌린지를 삭제하고 만들어주세요.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText('챌린지를 만들지 못했어요. 잠시 후 다시 시도해주세요.')).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();

    // 실패 후에도 다시 시도할 수 있어야 한다(submitting이 걸려 있으면 안 된다).
    mockCreateChallenge.mockResolvedValueOnce({ id: 'c1', nonParticipants: [] });
    await press('만들기');
    expect(onCreated).toHaveBeenCalled();
  });

  test('사라진 그룹(NOT_FOUND)은 전용 문구로 알린다', async () => {
    mockCreateChallenge.mockRejectedValueOnce(axiosErrorWith(404, 'NOT_FOUND'));
    await renderSheet();
    await press('만들기');

    expect(screen.getByText('사라진 그룹이에요.')).toBeOnTheScreen();
  });
});

// 그룹 생성이 대표 챌린지를 항상 하나 만들기 때문에, 기본값(FOCUS) 그대로 제출하면 409가 뜨는 것이
// 예외가 아니라 **기본 상태**였다. 애초에 실패할 조합을 못 고르게 막는다.
describe('이미 있는 카테고리', () => {
  test('비어 있는 카테고리가 초기 선택이 된다', async () => {
    await renderSheet(['FOCUS']);
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(GROUP_ID, {
      missionCategory: 'SCREEN_TIME',
      missionType: 'DURATION',
      durationMinutes: 60,
    });
  });

  test('이미 있는 카테고리는 눌러도 선택되지 않는다', async () => {
    await renderSheet(['FOCUS']);
    await press('집중 시간');
    await press('만들기');

    expect(mockCreateChallenge).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ missionCategory: 'SCREEN_TIME' }),
    );
  });

  test('둘 다 있으면 만들기 자체를 막고 이유를 알린다', async () => {
    await renderSheet(['FOCUS', 'SCREEN_TIME']);
    expect(screen.getByText('모든 종류의 챌린지가 이미 있어요')).toBeOnTheScreen();

    await press('만들기');
    expect(mockCreateChallenge).not.toHaveBeenCalled();
  });
});

describe('목표 라벨', () => {
  test('카테고리에 따라 라벨이 갈린다(그룹 만들기 폼과 같은 문구)', async () => {
    await renderSheet();
    expect(screen.getByText('하루 목표 집중 시간')).toBeOnTheScreen();

    await press('스크린타임');
    expect(screen.getByText('하루 목표 스크린타임')).toBeOnTheScreen();
  });
});
