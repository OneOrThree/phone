// GroupNoticePermissionScreen 계약 테스트 — A-4 공지 작성 권한(방장 전용).
//
// 이 화면의 핵심 계약을 잠근다:
//  1) 로드 후 멤버별 granted Switch. 방장 행(userId === myUserId)은 항상 on + disabled(잠금).
//  2) 비방장 멤버 토글 → 그 멤버 하나만 담아 PATCH(항목별 upsert) + 계측 발행 + 로컬 on.
//  3) PATCH 실패 → 그 멤버 Switch가 이전 값으로 롤백.
//  4) 방장 Switch는 조작해도 PATCH가 나가지 않는다(서버도 방장 항목을 무시).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import GroupNoticePermissionScreen from './GroupNoticePermissionScreen';
import { getGroupSettings, updateGroupSettings } from '@/services/groupApi';
import { logGroupNoticeGrantChanged } from '@/services/analyticsEvents';
import type { GroupSettingsResponse } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const OWNER_ID = 'owner-1';
const GROUP_ID = 'group-1';

const mockGoBack = jest.fn();
// 렌더마다 같은 객체를 준다 — 실제 useNavigation/useRoute의 신원 안정성을 흉내낸다.
const mockNavigation = { goBack: mockGoBack };
const mockRoute = { params: { groupId: GROUP_ID } };
jest.mock('@react-navigation/native', () => ({
  // 실제 모듈을 깔고 필요한 것만 덮는다 — navigationRef가 createNavigationContainerRef를
  // 모듈 로드 시점에 부르기 때문에, 빠뜨리면 이 화면을 import하는 것만으로 스위트가 죽는다.
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
  useRoute: () => mockRoute,
}));

// 방장 = 현재 로그인 유저 — userId를 방장 id로 고정한다(화면의 방장 식별 근거).
jest.mock('@/store/UserContext', () => ({
  useUser: () => ({ userId: 'owner-1' }),
}));

jest.mock('@/services/analyticsEvents', () => ({ logGroupNoticeGrantChanged: jest.fn() }));

jest.mock('@/services/groupApi', () => ({
  getGroupSettings: jest.fn(),
  updateGroupSettings: jest.fn(),
}));

const mockGetGroupSettings = getGroupSettings as jest.MockedFunction<typeof getGroupSettings>;
const mockUpdateGroupSettings = updateGroupSettings as jest.MockedFunction<
  typeof updateGroupSettings
>;
const mockLog = logGroupNoticeGrantChanged as jest.MockedFunction<
  typeof logGroupNoticeGrantChanged
>;

function settings(): GroupSettingsResponse {
  return {
    announcementGrants: [
      { userId: OWNER_ID, nickname: '방장', granted: true },
      { userId: 'member-1', nickname: '멤버1', granted: false },
      { userId: 'member-2', nickname: '멤버2', granted: true },
    ],
  };
}

async function renderScreen() {
  const result = await render(<GroupNoticePermissionScreen />);
  // 마운트 시 getGroupSettings 프라미스를 흘려보낸다.
  await act(async () => {});
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  // 실패 분기가 부르는 Alert를 잡아 둔다(네이티브 호출 방지 + 호출 검증).
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockGetGroupSettings.mockResolvedValue(settings());
  mockUpdateGroupSettings.mockResolvedValue(undefined);
});

describe('공지 권한 관리(A-4)', () => {
  test('로드 후 멤버별 granted Switch를 그리고, 방장 행은 disabled·항상 on이다', async () => {
    await renderScreen();

    expect(screen.getByTestId('group.notice.permission.screen')).toBeOnTheScreen();

    const owner = screen.getByTestId(`group.notice.toggle.${OWNER_ID}`);
    expect(owner.props.value).toBe(true);
    expect(owner.props.disabled).toBe(true);

    // 멤버 행은 각자 granted 그대로.
    expect(screen.getByTestId('group.notice.toggle.member-1').props.value).toBe(false);
    expect(screen.getByTestId('group.notice.toggle.member-2').props.value).toBe(true);
  });

  test('비방장 멤버를 켜면 그 멤버만 담아 PATCH하고 이벤트를 발행하며 로컬이 on이 된다', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent(screen.getByTestId('group.notice.toggle.member-1'), 'valueChange', true);
    });

    expect(mockUpdateGroupSettings).toHaveBeenCalledWith(GROUP_ID, {
      announcementGrants: [{ userId: 'member-1', granted: true }],
    });
    expect(mockLog).toHaveBeenCalledWith({ group_id: GROUP_ID, granted: true });
    expect(screen.getByTestId('group.notice.toggle.member-1').props.value).toBe(true);
  });

  test('PATCH가 실패하면 그 멤버 Switch가 이전(off)으로 롤백된다', async () => {
    mockUpdateGroupSettings.mockRejectedValueOnce(new Error('network'));
    await renderScreen();

    await act(async () => {
      fireEvent(screen.getByTestId('group.notice.toggle.member-1'), 'valueChange', true);
    });

    // 낙관적으로 켰다가 실패로 다시 off.
    expect(screen.getByTestId('group.notice.toggle.member-1').props.value).toBe(false);
    // 실패는 계측하지 않는다.
    expect(mockLog).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalled();
  });

  test('방장 Switch는 조작해도 PATCH가 나가지 않는다', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent(screen.getByTestId(`group.notice.toggle.${OWNER_ID}`), 'valueChange', false);
    });

    expect(mockUpdateGroupSettings).not.toHaveBeenCalled();
  });
});
