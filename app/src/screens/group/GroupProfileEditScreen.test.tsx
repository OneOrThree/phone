// GroupProfileEditScreen(그룹 프로필 편집) 테스트 — A안 개편으로 GroupSettings에서 분리된 폼.
//
// 이 화면의 계약:
//  1) 상세를 로드해 이름·소개·정원·공개설정을 폼에 초기화한다.
//  2) 저장은 기준값과 **달라진 필드만** PATCH하고, 계측도 바뀐 fields만 발행한다.
//  3) 바뀐 게 없으면 저장은 no-op이다(버튼도 잠긴다).
//  4) 방장이 아니면 편집 폼 대신 권한 안내를 세운다(방어적 권한 체크 + 재포커스 재조회).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import GroupProfileEditScreen from './GroupProfileEditScreen';
import { getGroupDetail, updateGroup } from '@/services/groupApi';
import { logGroupSettingsUpdated } from '@/services/analyticsEvents';
import type { GroupDetailResponse } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockNavigation = { goBack: mockGoBack, navigate: mockNavigate };
const mockRoute = { params: { groupId: GROUP_ID } };
// useFocusEffect 콜백을 홀더에 캡처해, 관리 화면에서 돌아오는 '재포커스'를 테스트가 수동 트리거한다.
const mockFocus: { cb: null | (() => void | (() => void)) } = { cb: null };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => mockRoute,
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    mockFocus.cb = cb;
    useEffect(() => cb(), [cb]);
  },
}));

const mockUser = { userId: 'me' as string | null };
jest.mock('@/store/UserContext', () => ({
  useUser: () => mockUser,
}));

jest.mock('@/services/analyticsEvents', () => ({ logGroupSettingsUpdated: jest.fn() }));

// 저장 성공 통보가 전역 토스트로 나간다(GROMO-1381) — useToast는 Provider 밖에서 throw하므로
// 훅 자체를 목으로 대체한다(화면을 ToastProvider로 감싸지 않아도 되게).
const mockToastShow = jest.fn();
jest.mock('@/store/ToastContext', () => ({ useToast: () => ({ show: mockToastShow }) }));

// groupErrorCode는 실제 구현을 남긴다(§3-2 code 분기까지 검증).
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getGroupDetail: jest.fn(),
  updateGroup: jest.fn(),
}));

const mockGetGroupDetail = getGroupDetail as jest.MockedFunction<typeof getGroupDetail>;
const mockUpdateGroup = updateGroup as jest.MockedFunction<typeof updateGroup>;
const mockLog = logGroupSettingsUpdated as jest.MockedFunction<typeof logGroupSettingsUpdated>;

// 기본 상세 — 내가 OWNER, 멤버 2명, 공개방, 정원 5.
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

// 내가 MEMBER인 상세(방어적 권한 체크용).
function asMember(): GroupDetailResponse {
  return detail({
    members: [
      { userId: 'me', nickname: '나', role: 'MEMBER', focusTimeMinutes: 0, totalFocusMinutes: 0 },
      {
        userId: 'u2',
        nickname: '친구',
        role: 'OWNER',
        focusTimeMinutes: 10,
        totalFocusMinutes: 20,
      },
    ],
  });
}

async function renderScreen() {
  const result = await render(<GroupProfileEditScreen />);
  // 마운트 시 getGroupDetail 프라미스를 흘려보낸다.
  await act(async () => {});
  return result;
}

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.userId = 'me';
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockGetGroupDetail.mockResolvedValue(detail());
  mockUpdateGroup.mockResolvedValue(undefined);
});

describe('로드 · 초기값', () => {
  test('상세 로드 후 이름·소개·정원·공개설정 초기값이 폼에 반영된다', async () => {
    await renderScreen();

    expect(screen.getByTestId('group.profile.screen')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('아침 6시 집중방')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('매일 아침 함께 집중해요')).toBeOnTheScreen();
    expect(screen.getByText('5명')).toBeOnTheScreen();
    expect(screen.getByTestId('group.profile.private').props.value).toBe(false);
  });
});

describe('저장 — 바뀐 필드만 PATCH(부분 수정)', () => {
  test('이름만 바꾸면 name 하나만 담아 호출하고, 계측 fields도 name뿐이다', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent.changeText(screen.getByDisplayValue('아침 6시 집중방'), '저녁 스터디');
    });
    await press('group.profile.save');

    expect(mockUpdateGroup).toHaveBeenCalledWith(GROUP_ID, { name: '저녁 스터디' });
    const body = mockUpdateGroup.mock.calls[0][1];
    expect(Object.keys(body)).toEqual(['name']);
    expect(mockLog).toHaveBeenCalledWith({ group_id: GROUP_ID, fields: ['name'] });
  });

  test('여러 필드를 바꾸면 바뀐 필드만 함께 실린다', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent.changeText(screen.getByDisplayValue('아침 6시 집중방'), '저녁 스터디');
    });
    await act(async () => {
      fireEvent(screen.getByTestId('group.profile.private'), 'valueChange', true);
    });
    await press('group.profile.save');

    expect(mockUpdateGroup).toHaveBeenCalledWith(GROUP_ID, {
      name: '저녁 스터디',
      isPrivate: true,
    });
    expect(mockLog).toHaveBeenCalledWith({ group_id: GROUP_ID, fields: ['name', 'isPrivate'] });
  });

  test('바뀐 게 없으면 저장은 no-op이다', async () => {
    await renderScreen();

    await press('group.profile.save');

    expect(mockUpdateGroup).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  test('저장 성공 후에는 다시 눌러도 no-op이다(변경 없음으로 되돌린다)', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent.changeText(screen.getByDisplayValue('아침 6시 집중방'), '저녁 스터디');
    });
    await press('group.profile.save');
    expect(mockUpdateGroup).toHaveBeenCalledTimes(1);

    await press('group.profile.save');
    expect(mockUpdateGroup).toHaveBeenCalledTimes(1);
  });

  // 성공 통보는 Alert가 아니라 토스트로 나간다(GROMO-1381 알럿 이관). 실패 알럿은 그대로 Alert다.
  test('저장 성공은 Alert 없이 토스트로 알린다', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent.changeText(screen.getByDisplayValue('아침 6시 집중방'), '저녁 스터디');
    });
    await press('group.profile.save');

    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('저장') }),
    );
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('정원을 현재 인원 미만으로 줄이면 서버 MAX_MEMBERS_TOO_SMALL를 안내한다', async () => {
    const { AxiosError, AxiosHeaders } = require('axios');
    const config = { headers: new AxiosHeaders() };
    mockUpdateGroup.mockRejectedValue(
      new AxiosError('bad', 'ERR_BAD_REQUEST', config, null, {
        status: 400,
        statusText: '',
        headers: {},
        config,
        data: { code: 'MAX_MEMBERS_TOO_SMALL', message: '...' },
      }),
    );
    await renderScreen();

    await act(async () => {
      fireEvent.changeText(screen.getByDisplayValue('아침 6시 집중방'), '저녁 스터디');
    });
    await press('group.profile.save');

    expect(Alert.alert).toHaveBeenCalledWith(
      '정원을 줄일 수 없어요',
      expect.any(String),
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('방어적 권한 체크', () => {
  test('내가 OWNER가 아니면 편집 폼 대신 권한 안내를 세운다', async () => {
    mockGetGroupDetail.mockResolvedValue(asMember());
    await renderScreen();

    expect(screen.getByText('방장만 접근할 수 있어요')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.profile.save')).toBeNull();
    expect(screen.getByLabelText('뒤로')).toBeOnTheScreen();
  });

  test('같은 세션에서 방장을 넘긴 뒤 돌아오면(재포커스 재조회) 폼이 사라진다', async () => {
    await renderScreen();
    expect(screen.getByTestId('group.profile.save')).toBeOnTheScreen();

    // 위임 화면에서 방장을 넘기고 돌아옴 — 서버 상세에선 내 role이 MEMBER로 바뀌어 있다.
    mockGetGroupDetail.mockResolvedValue(asMember());
    await act(async () => {
      mockFocus.cb?.();
    });
    await act(async () => {});

    expect(screen.getByText('방장만 접근할 수 있어요')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.profile.save')).toBeNull();
  });
});
