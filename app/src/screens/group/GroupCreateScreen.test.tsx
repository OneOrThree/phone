// GroupCreateScreen 전송 계약 + 생성 요청 구간 테스트 — 명세 docs/app/group-plan.md §6-2 + 2차 §3-3.
//
// 이 화면이 서버로 보내는 바디는 그룹의 성격을 통째로 정한다(카테고리·목표·공개 여부).
// 특히 2차에서 missionCategory가 'FOCUS' 고정 → 세그먼트 선택값으로 바뀌었다 —
// 선택이 바디에 실리지 않으면 스크린타임 그룹을 만들 방법이 앱에서 사라지고,
// password·description이 실리면 아무도 못 들어오는 그룹이 만들어진다(§3-1-3).
//
// 바디와 별개로, 이 화면의 위험 구간은 "요청은 떠 있는데 화면은 계속 열려 있는" 몇 초다.
//   1) 그 사이 이름을 고치면 초대 문구가 실제 그룹 이름과 갈린다 → 요청에 실어 보낸 이름을 굳힌다
//   2) 그 사이 이탈하면 취소한 줄 아는 그룹에 OWNER로 갇힌다(§14 — 삭제·위임 UI가 없다)
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import GroupCreateScreen from './GroupCreateScreen';
import { createGroup } from '@/services/groupApi';
import type { CreateGroupResponse } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

// 이탈 차단 리스너를 테스트가 직접 굴린다(실제 스택 없이).
// jest.mock 팩토리는 mock 접두 변수만 참조할 수 있어 홀더 객체에 담는다.
const mockNav = {
  goBack: jest.fn(),
  navigate: jest.fn(),
  beforeRemove: null as ((e: { preventDefault: () => void }) => void) | null,
};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockNav.goBack,
    navigate: mockNav.navigate,
    addListener: (event: string, cb: (e: { preventDefault: () => void }) => void) => {
      if (event === 'beforeRemove') mockNav.beforeRemove = cb;
      return () => {};
    },
  }),
}));

jest.mock('@/services/analyticsEvents', () => ({
  logGroupCreateStarted: jest.fn(),
  logGroupInviteShared: jest.fn(),
}));

// groupErrorCode는 실제 구현을 남긴다(§3-2 code 분기까지 검증).
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  createGroup: jest.fn(),
}));

const mockCreateGroup = createGroup as jest.MockedFunction<typeof createGroup>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';

// 서버 GlobalExceptionHandler의 { code, message } 바디를 실은 axios 에러.
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

async function renderScreen() {
  const result = await render(<GroupCreateScreen />);
  await act(async () => {});
  return result;
}

// 비동기 핸들러(생성)를 부르는 탭 — fireEvent만으론 이어지는 setState가 act 밖으로 샌다.
async function press(label: string) {
  const el = await screen.findByText(label);
  await act(async () => {
    fireEvent.press(el);
  });
}

async function typeName(name: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByPlaceholderText('예) 아침 6시 집중방'), name);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNav.beforeRemove = null;
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockCreateGroup.mockResolvedValue({ groupId: GROUP_ID, code: 'ignored' });
});

describe('챌린지 종류 세그먼트(2차 §3-3)', () => {
  test('기본은 집중 시간 — 카테고리를 건드리지 않으면 FOCUS를 보낸다', async () => {
    await renderScreen();
    await typeName('아침 6시 집중방');

    await press('만들기');

    expect(mockCreateGroup).toHaveBeenCalledWith({
      name: '아침 6시 집중방',
      maxMembers: 5,
      missionType: 'DURATION',
      missionCategory: 'FOCUS',
      durationMinutes: 60,
      isPrivate: false,
    });
  });

  test('스크린타임을 고르면 missionCategory가 SCREEN_TIME으로 나간다(missionType은 DURATION 유지)', async () => {
    await renderScreen();
    await typeName('스크린타임 줄이기');
    await press('스크린타임');

    await press('만들기');

    expect(mockCreateGroup).toHaveBeenCalledWith(
      expect.objectContaining({ missionCategory: 'SCREEN_TIME', missionType: 'DURATION' }),
    );
  });

  // 권한이 없는 멤버는 서버가 챌린지 참여자에서 빼 버린다 — 고르기 전에 알려주지 않으면
  // 방장은 '왜 절반이 빠졌는지' 모른 채 그룹을 만든다.
  // 캡션에는 **목표의 방향(이하)** 도 함께 들어간다 — 이 문장이 빠지면 '하루 목표 스크린타임
  // 60분'이 "60분을 채워라"로 뒤집혀 읽힌다(챌린지 만들기 시트는 이미 알려주는 정보다).
  test('캡션은 스크린타임을 고른 동안에만 뜨고, 목표가 이하라는 뜻을 함께 알려준다', async () => {
    await renderScreen();
    const caption =
      '하루 스크린타임을 목표 이하로 유지하면 달성이에요. 스크린타임 권한을 허용한 멤버만 참여할 수 있어요';

    expect(screen.queryByText(caption)).toBeNull();

    await press('스크린타임');
    expect(screen.getByText(caption)).toBeOnTheScreen();

    await press('집중 시간');
    expect(screen.queryByText(caption)).toBeNull();
  });

  // 폼에서 고르는 목표는 '대표 챌린지 하나'뿐이라, 여기서 못 고른 종류를 영영 못 만드는 것으로
  // 읽힐 수 있다 — 추가 경로가 있다는 사실을 카테고리와 무관하게 항상 노출한다.
  test('목표 시간 아래에 그룹방에서 챌린지를 더 추가할 수 있다는 안내가 항상 뜬다', async () => {
    await renderScreen();
    const hint = '만든 뒤 그룹방에서 챌린지를 더 추가할 수 있어요';

    expect(screen.getByText(hint)).toBeOnTheScreen();

    await press('스크린타임');
    expect(screen.getByText(hint)).toBeOnTheScreen();
  });

  // 목표는 FOCUS면 '이상', SCREEN_TIME이면 '이하'다 — 라벨이 고정이면 의미가 뒤집힌다.
  test('목표 시간 라벨이 카테고리를 따라간다', async () => {
    await renderScreen();

    expect(screen.getByText('하루 목표 집중 시간')).toBeOnTheScreen();

    await press('스크린타임');
    expect(screen.getByText('하루 목표 스크린타임')).toBeOnTheScreen();
    expect(screen.queryByText('하루 목표 집중 시간')).toBeNull();
  });
});

describe('나머지 전송 계약(§3-1)', () => {
  test('목표 시간 칩·공개 설정 선택이 그대로 실린다', async () => {
    await renderScreen();
    await typeName('저녁 스터디');
    await press('120분');
    await press('비공개');

    await press('만들기');

    expect(mockCreateGroup).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 120, isPrivate: true }),
    );
  });

  // 폐기된 개념(§0) — 하나라도 실리면 그 그룹은 아무도 못 들어오거나 3시간 뒤 입구가 닫힌다.
  test('password·description·code는 절대 보내지 않는다', async () => {
    await renderScreen();
    await typeName('아침 6시 집중방');

    await press('만들기');

    const body = mockCreateGroup.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual([
      'durationMinutes',
      'isPrivate',
      'maxMembers',
      'missionCategory',
      'missionType',
      'name',
    ]);
  });

  test('이름이 비면 만들기가 눌리지 않는다', async () => {
    await renderScreen();

    await press('만들기');

    expect(mockCreateGroup).not.toHaveBeenCalled();
  });
});

describe('요청이 떠 있는 구간(§6-2)', () => {
  test('공유 문구는 생성 요청에 실어 보낸 이름을 쓴다(요청 중 이름을 고쳐도)', async () => {
    let resolveCreate: (v: CreateGroupResponse) => void = () => {};
    mockCreateGroup.mockImplementation(
      () => new Promise((res) => (resolveCreate = res)) as Promise<CreateGroupResponse>,
    );
    await renderScreen();

    await typeName('아침 6시 집중방');
    await press('비공개'); // 비공개여야 초대 링크 다이얼로그가 뜬다
    await press('만들기');

    // 요청이 떠 있는 동안 입력은 살아 있다 — 여기서 고친 이름은 서버에 가지 않는다.
    await typeName('저녁 10시 집중방');
    await act(async () => {
      resolveCreate({ groupId: GROUP_ID } as CreateGroupResponse);
    });

    expect(mockCreateGroup).toHaveBeenCalledWith(
      expect.objectContaining({ name: '아침 6시 집중방' }),
    );

    await press('공유하기');
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('아침 6시 집중방') }),
    );
    expect(Share.share).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('저녁 10시') }),
    );
  });

  test('생성 요청이 떠 있는 동안에는 이탈을 막는다', async () => {
    let resolveCreate: (v: CreateGroupResponse) => void = () => {};
    mockCreateGroup.mockImplementation(
      () => new Promise((res) => (resolveCreate = res)) as Promise<CreateGroupResponse>,
    );
    await renderScreen();

    await typeName('아침 6시 집중방');
    await press('만들기');

    const blocked = { preventDefault: jest.fn() };
    mockNav.beforeRemove?.(blocked);
    expect(blocked.preventDefault).toHaveBeenCalled();

    // 응답 직후 풀린다 — 공개 그룹의 성공 경로는 goBack()으로 나가야 한다.
    await act(async () => {
      resolveCreate({ groupId: GROUP_ID } as CreateGroupResponse);
    });
    const after = { preventDefault: jest.fn() };
    mockNav.beforeRemove?.(after);
    expect(after.preventDefault).not.toHaveBeenCalled();
    expect(mockNav.goBack).toHaveBeenCalled();
  });
});

// 백 계약은 **생성·참가 양쪽 모두** 상한 10을 검사한다(GroupService.ensureJoinedGroupLimit).
// 초대·찾기 시트는 이미 분기를 갖고 있었지만 생성 경로만 빠져 있었다 — 409는 status 400도 아니라
// 공통 문구 '잠시 후 다시 시도'로 떨어졌고, 시간이 지나도 절대 풀리지 않는 조건이라
// 사용자는 서버 장애로 이해하고 재시도만 반복했다.
describe('에러 분기(§3-2 — status가 아니라 code로 본다)', () => {
  test('GROUP_LIMIT_EXCEEDED — 상한 안내 Alert(공통 실패 문구가 아니다)', async () => {
    mockCreateGroup.mockRejectedValue(axiosErrorWith(409, 'GROUP_LIMIT_EXCEEDED'));
    await renderScreen();
    await typeName('아침 6시 집중방');

    await press('만들기');

    expect(Alert.alert).toHaveBeenCalledWith(
      '더 이상 만들 수 없어요',
      '참여할 수 있는 그룹 수를 초과했어요(최대 10개)',
    );
    expect(Alert.alert).not.toHaveBeenCalledWith('그룹을 만들지 못했어요', expect.any(String));
  });

  test('모르는 code는 공통 문구로 떨어진다', async () => {
    mockCreateGroup.mockRejectedValue(axiosErrorWith(500, 'SOMETHING_NEW'));
    await renderScreen();
    await typeName('아침 6시 집중방');

    await press('만들기');

    expect(Alert.alert).toHaveBeenCalledWith(
      '그룹을 만들지 못했어요',
      '잠시 후 다시 시도해주세요.',
    );
  });

  test('400은 이름 필드를 짚어준다(Alert 아님)', async () => {
    mockCreateGroup.mockRejectedValue(axiosErrorWith(400));
    await renderScreen();
    await typeName('아침 6시 집중방');

    await press('만들기');

    expect(screen.getByText('그룹 이름을 다시 확인해주세요')).toBeOnTheScreen();
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
