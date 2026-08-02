// GroupSettingsScreen(A-1 관리 허브) 계약 테스트 — 명세 3차 A-1.
//
// 이 화면의 핵심 계약:
//  1) 상세를 로드해 이름·소개·정원·공개설정을 폼에 초기화한다.
//  2) 저장은 기준값과 **달라진 필드만** PATCH하고, 계측도 바뀐 fields만 발행한다
//     (부분 수정이라 안 바뀐 값을 실어 보내면 의도치 않은 덮어쓰기가 된다).
//  3) 바뀐 게 없으면 저장은 no-op이다(버튼도 잠긴다).
//  4) 관리 진입 3행은 각각 올바른 라우트·파라미터로 navigate한다.
//  5) 방장이 아니면 편집 폼 대신 권한 안내를 세운다(방어적 권한 체크).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import GroupSettingsScreen from './GroupSettingsScreen';
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
// 실제 useNavigation/useRoute는 렌더마다 같은 객체를 준다 — 매번 새 객체를 주면 신원이 흔들린다.
const mockNavigation = { goBack: mockGoBack, navigate: mockNavigate };
const mockRoute = { params: { groupId: GROUP_ID } };
// useFocusEffect 콜백을 홀더에 캡처해, 위임/강퇴 화면에서 돌아오는 '재포커스'를 테스트가 수동 트리거한다.
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

// userId를 바꿔 방어적 권한 체크를 검증할 수 있게 홀더 객체에 담는다(jest.mock 팩토리 제약).
const mockUser = { userId: 'me' as string | null };
jest.mock('@/store/UserContext', () => ({
  useUser: () => mockUser,
}));

jest.mock('@/services/analyticsEvents', () => ({ logGroupSettingsUpdated: jest.fn() }));

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
      { userId: 'u2', nickname: '친구', role: 'MEMBER', focusTimeMinutes: 10, totalFocusMinutes: 20 },
    ],
    ...over,
  };
}

async function renderScreen() {
  const result = await render(<GroupSettingsScreen />);
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

    expect(screen.getByTestId('group.settings.screen')).toBeOnTheScreen();
    // 이름·소개는 value로 들어간다.
    expect(screen.getByDisplayValue('아침 6시 집중방')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('매일 아침 함께 집중해요')).toBeOnTheScreen();
    // 정원은 스텝퍼 값으로.
    expect(screen.getByText('5명')).toBeOnTheScreen();
    // 공개설정 토글은 isPrivate=false로.
    expect(screen.getByTestId('group.settings.private').props.value).toBe(false);
  });
});

describe('저장 — 바뀐 필드만 PATCH(부분 수정)', () => {
  test('이름만 바꾸면 name 하나만 담아 호출하고, 계측 fields도 name뿐이다', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent.changeText(screen.getByDisplayValue('아침 6시 집중방'), '저녁 스터디');
    });
    await press('group.settings.save');

    expect(mockUpdateGroup).toHaveBeenCalledWith(GROUP_ID, { name: '저녁 스터디' });
    // 안 바뀐 필드는 실려선 안 된다 — 키가 정확히 name 하나여야 한다.
    const body = mockUpdateGroup.mock.calls[0][1];
    expect(Object.keys(body)).toEqual(['name']);
    expect(mockLog).toHaveBeenCalledWith({ group_id: GROUP_ID, fields: ['name'] });
  });

  test('여러 필드를 바꾸면 바뀐 필드만 함께 실린다', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent.changeText(screen.getByDisplayValue('아침 6시 집중방'), '저녁 스터디');
    });
    // 공개설정 토글을 켠다.
    await act(async () => {
      fireEvent(screen.getByTestId('group.settings.private'), 'valueChange', true);
    });
    await press('group.settings.save');

    expect(mockUpdateGroup).toHaveBeenCalledWith(GROUP_ID, { name: '저녁 스터디', isPrivate: true });
    expect(mockLog).toHaveBeenCalledWith({ group_id: GROUP_ID, fields: ['name', 'isPrivate'] });
  });

  test('바뀐 게 없으면 저장은 no-op이다', async () => {
    await renderScreen();

    await press('group.settings.save');

    expect(mockUpdateGroup).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  test('저장 성공 후에는 다시 눌러도 no-op이다(변경 없음으로 되돌린다)', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent.changeText(screen.getByDisplayValue('아침 6시 집중방'), '저녁 스터디');
    });
    await press('group.settings.save');
    expect(mockUpdateGroup).toHaveBeenCalledTimes(1);

    // 기준값이 방금 보낸 값으로 굳었으니 재저장은 no-op.
    await press('group.settings.save');
    expect(mockUpdateGroup).toHaveBeenCalledTimes(1);
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

    // 이름을 바꿔 저장을 활성화한다(정원 스텝퍼 하한이 막혀 있어 값 자체는 그대로 둔다).
    await act(async () => {
      fireEvent.changeText(screen.getByDisplayValue('아침 6시 집중방'), '저녁 스터디');
    });
    await press('group.settings.save');

    expect(Alert.alert).toHaveBeenCalledWith('정원을 줄일 수 없어요', expect.any(String));
  });
});

describe('관리 진입 — 올바른 라우트·파라미터로 navigate', () => {
  test('방장 넘기기 → GroupOwnerTransfer(source: settings)', async () => {
    await renderScreen();
    await press('group.settings.transfer');
    expect(mockNavigate).toHaveBeenCalledWith('GroupOwnerTransfer', {
      groupId: GROUP_ID,
      source: 'settings',
    });
  });

  test('멤버 관리 → GroupMemberManage', async () => {
    await renderScreen();
    await press('group.settings.members');
    expect(mockNavigate).toHaveBeenCalledWith('GroupMemberManage', { groupId: GROUP_ID });
  });

  test('공지 권한 → GroupNoticePermission', async () => {
    await renderScreen();
    await press('group.settings.noticePermission');
    expect(mockNavigate).toHaveBeenCalledWith('GroupNoticePermission', { groupId: GROUP_ID });
  });
});

describe('방어적 권한 체크', () => {
  test('내가 OWNER가 아니면 편집 폼 대신 권한 안내를 세운다', async () => {
    // 내 role을 MEMBER로 — members에 OWNER인 내가 없다.
    mockGetGroupDetail.mockResolvedValue(
      detail({
        members: [
          { userId: 'me', nickname: '나', role: 'MEMBER', focusTimeMinutes: 0, totalFocusMinutes: 0 },
          { userId: 'u2', nickname: '친구', role: 'OWNER', focusTimeMinutes: 10, totalFocusMinutes: 20 },
        ],
      }),
    );
    await renderScreen();

    expect(screen.getByText('방장만 접근할 수 있어요')).toBeOnTheScreen();
    // 편집 폼·저장 버튼은 없다.
    expect(screen.queryByTestId('group.settings.save')).toBeNull();
    // 백버튼은 남는다(탈출 경로).
    expect(screen.getByLabelText('뒤로')).toBeOnTheScreen();
  });

  test('같은 세션에서 방장을 넘긴 뒤 허브로 돌아오면(재포커스 재조회) 폼이 사라진다', async () => {
    // 최초: 내가 OWNER → 편집 폼·저장 버튼이 보인다.
    await renderScreen();
    expect(screen.getByTestId('group.settings.save')).toBeOnTheScreen();

    // 위임 화면에서 방장을 넘기고 goBack — 서버 상세에선 내 role이 MEMBER로 바뀌어 있다.
    mockGetGroupDetail.mockResolvedValue(
      detail({
        members: [
          { userId: 'me', nickname: '나', role: 'MEMBER', focusTimeMinutes: 30, totalFocusMinutes: 30 },
          { userId: 'u2', nickname: '친구', role: 'OWNER', focusTimeMinutes: 10, totalFocusMinutes: 20 },
        ],
      }),
    );
    // 스택 화면은 뒤로가기 시 언마운트되지 않으므로, 재포커스 재조회로만 권한이 갱신된다.
    await act(async () => {
      mockFocus.cb?.();
    });
    await act(async () => {});

    // stale OWNER로 남지 않고 권한 안내로 바뀐다 — 편집 폼·저장 버튼이 사라진다.
    expect(screen.getByText('방장만 접근할 수 있어요')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.settings.save')).toBeNull();
  });
});
