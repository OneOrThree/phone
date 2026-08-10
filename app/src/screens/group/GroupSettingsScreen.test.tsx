// GroupSettingsScreen(A-1 관리 허브) 테스트 — A안 개편(그룹방 ⋯ 가 이 화면을 바로 연다).
//
// 이 화면의 계약:
//  1) 방장은 관리 행(프로필설정하기·방장넘기기·멤버관리·공지권한) + 나가기, 비방장은 나가기만 본다.
//  2) 관리 행은 각각 올바른 라우트·파라미터로 navigate 한다.
//  3) 나가기: 성공 → popToTop(목록 복귀). 방장(HOST_WITHDRAW) → 위임 화면 유도.
//     이미 빠져 있음(NOT_FOUND·MEMBER_ONLY) → 성공과 같게 popToTop.
//  (프로필 편집 폼 자체는 GroupProfileEditScreen.test.tsx 에서 검증한다.)
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import GroupSettingsScreen from './GroupSettingsScreen';
import { getGroupDetail, withdrawGroup } from '@/services/groupApi';
import type { GroupDetailResponse } from '@/types/dto/group';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { __resetGroupCardEmojiQueueForTest, writeGroupCardEmoji } from './groupCardEmojiStore';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';

const mockNavigate = jest.fn();
const mockPopToTop = jest.fn();
const mockGoBack = jest.fn();
const mockNavigation = { navigate: mockNavigate, popToTop: mockPopToTop, goBack: mockGoBack };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: { groupId: '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55' } }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb]);
  },
}));

const mockUser = { userId: 'me' as string | null };
jest.mock('@/store/UserContext', () => ({
  useUser: () => mockUser,
}));

// analyticsEvents는 firebase 네이티브 모듈을 물어 온다 — groupApi(requireActual)가 전이 import
// 하므로 목으로 막지 않으면 스위트가 로드 단계에서 죽는다. 허브 화면 자체는 계측을 쓰지 않는다.
jest.mock('@/services/analyticsEvents', () => ({
  logGroupChallengeDeleted: jest.fn(),
}));

// groupErrorCode는 실제 구현을 남긴다(§3-2 code 분기까지 검증).
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getGroupDetail: jest.fn(),
  withdrawGroup: jest.fn(),
}));

const mockGetGroupDetail = getGroupDetail as jest.MockedFunction<typeof getGroupDetail>;
const mockWithdrawGroup = withdrawGroup as jest.MockedFunction<typeof withdrawGroup>;

// 서버 에러 바디({ code })를 실은 axios 에러 — 화면은 status가 아니라 code로 분기한다.
function axiosErrorWith(status: number, code: string): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { code },
  });
}

// 기본 상세 — over로 members를 갈아 방장/비방장을 만든다.
function detail(over: Partial<GroupDetailResponse> = {}): GroupDetailResponse {
  return {
    id: GROUP_ID,
    name: '아침 6시 집중방',
    description: '매일 아침 함께 집중해요',
    missionCategory: 'FOCUS',
    missionType: 'DURATION',
    durationMinutes: 60,
    windowStart: null,
    windowEnd: null,
    isPrivate: false,
    maxMembers: 5,
    status: 'WAITING',
    code: null,
    codeExpiresAt: null,
    noticeGrantedUserIds: [],
    members: [
      { userId: 'me', nickname: '나', role: 'OWNER', focusTimeMinutes: 30, totalFocusMinutes: 30 },
      {
        userId: 'u2',
        nickname: '친구',
        role: 'MEMBER',
        focusTimeMinutes: 10,
        totalFocusMinutes: 20,
      },
    ],
    ...over,
  } as GroupDetailResponse;
}

// 비방장(내가 MEMBER)인 상세.
function memberDetail(): GroupDetailResponse {
  return detail({
    members: [
      {
        userId: 'owner',
        nickname: '방장',
        role: 'OWNER',
        focusTimeMinutes: 0,
        totalFocusMinutes: 0,
      },
      { userId: 'me', nickname: '나', role: 'MEMBER', focusTimeMinutes: 0, totalFocusMinutes: 0 },
    ],
  });
}

async function renderScreen() {
  const result = await render(<GroupSettingsScreen />);
  await screen.findByTestId('group.settings.leave');
  return result;
}

// 나가기 확인 Alert의 '나가기' 버튼을 눌러 요청을 보낸다.
async function pressLeaveAndConfirm(alertSpy: jest.SpyInstance) {
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.settings.leave'));
  });
  await act(async () => {
    alertSpy.mock.calls[0][2]?.find((b: { text?: string }) => b.text === '나가기')?.onPress?.();
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetGroupCardEmojiQueueForTest();
  jest.clearAllMocks();
  mockUser.userId = 'me';
  mockGetGroupDetail.mockResolvedValue(detail());
  mockWithdrawGroup.mockResolvedValue(undefined);
});

describe('허브 — 행 노출', () => {
  test('방장은 역할 공통 아이콘 + 관리 행 + 나가기를 본다', async () => {
    await renderScreen();

    expect(screen.getByTestId('group.settings.cardEmoji')).toBeOnTheScreen();
    expect(screen.getByText(/현재 아이콘 목표/)).toBeOnTheScreen();
    expect(screen.getByTestId('group.settings.profile')).toBeOnTheScreen();
    expect(screen.getByTestId('group.settings.transfer')).toBeOnTheScreen();
    expect(screen.getByTestId('group.settings.members')).toBeOnTheScreen();
    expect(screen.getByTestId('group.settings.noticePermission')).toBeOnTheScreen();
    expect(screen.getByTestId('group.settings.leave')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.profile'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('GroupProfileEdit', { groupId: GROUP_ID });
  });

  test('아이콘 설정 행은 현재 계정·그룹의 선택 이름을 보조값으로 보여준다', async () => {
    await writeGroupCardEmoji('me', GROUP_ID, '📚');
    await renderScreen();

    expect(screen.getByText('현재 아이콘 책 · 이 기기에서 나에게만 보여요')).toBeOnTheScreen();
  });

  test('MEMBER도 아이콘과 나가기는 보지만 OWNER 관리 행은 보지 않는다', async () => {
    mockGetGroupDetail.mockResolvedValue(memberDetail());
    await renderScreen();

    expect(screen.getByTestId('group.settings.leave')).toBeOnTheScreen();
    expect(screen.getByTestId('group.settings.cardEmoji')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.settings.profile')).toBeNull();
    expect(screen.queryByTestId('group.settings.transfer')).toBeNull();
    expect(screen.queryByTestId('group.settings.members')).toBeNull();
  });

  test('OWNER와 MEMBER 모두 같은 로컬 아이콘 편집 route로 이동한다', async () => {
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.cardEmoji'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('GroupCardEmojiEdit', { groupId: GROUP_ID });

    mockGetGroupDetail.mockResolvedValue(memberDetail());
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.cardEmoji'));
    });
    expect(mockNavigate).toHaveBeenLastCalledWith('GroupCardEmojiEdit', { groupId: GROUP_ID });
  });
});

describe('관리 진입 — 올바른 라우트·파라미터로 navigate', () => {
  test('방장 넘기기 → GroupOwnerTransfer(source: settings)', async () => {
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.transfer'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('GroupOwnerTransfer', {
      groupId: GROUP_ID,
      source: 'settings',
    });
  });

  test('멤버 관리 → GroupMemberManage', async () => {
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.members'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('GroupMemberManage', { groupId: GROUP_ID });
  });

  test('공지 권한 → GroupNoticePermission', async () => {
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.noticePermission'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('GroupNoticePermission', { groupId: GROUP_ID });
  });
});

describe('그룹 나가기', () => {
  test('나가기에 성공하면 목록으로 돌아간다(popToTop)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(memberDetail());
    mockWithdrawGroup.mockResolvedValueOnce(undefined);
    await renderScreen();

    await pressLeaveAndConfirm(alertSpy);

    expect(mockWithdrawGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(mockPopToTop).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test('방장이 나가려다 실패하면 위임 카드 모달로 유도한다(HOST_WITHDRAW)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockWithdrawGroup.mockRejectedValueOnce(axiosErrorWith(409, 'HOST_WITHDRAW'));
    await renderScreen();

    await pressLeaveAndConfirm(alertSpy);

    // 네이티브 Alert 강하 없이 앱 컨셉 카드 모달이 뜬다(GROMO-1210) — 문구는 기존 그대로.
    expect(screen.getByTestId('group.settings.hostBlocked')).toBeOnTheScreen();
    expect(screen.getByText('방장은 바로 나갈 수 없어요')).toBeOnTheScreen();
    expect(
      screen.getByText('그룹을 이어갈 멤버에게 방장을 넘기면 나갈 수 있어요.'),
    ).toBeOnTheScreen();
    // Alert는 나가기 확인(나갈까요?) 한 번뿐 — 블록 안내가 Alert로 새지 않는다.
    expect(alertSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.settings.hostBlocked.primary'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('GroupOwnerTransfer', {
      groupId: GROUP_ID,
      source: 'withdraw',
    });
    expect(mockPopToTop).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test('이미 빠져 있으면 성공과 같게 목록으로 돌아간다(MEMBER_ONLY)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetGroupDetail.mockResolvedValue(memberDetail());
    mockWithdrawGroup.mockRejectedValueOnce(axiosErrorWith(403, 'MEMBER_ONLY'));
    await renderScreen();

    await pressLeaveAndConfirm(alertSpy);

    expect(mockPopToTop).toHaveBeenCalled();
    // 확인 Alert(나갈까요?) 외에 추가 실패 Alert는 없다.
    expect(alertSpy).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });
});
