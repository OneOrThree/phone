// GroupMemberManageScreen 테스트 — A-3 멤버 강퇴 + 재가입 차단(방장 전용).
//
// 이 화면은 포커스 재조회가 없다(스택 화면, 진입 시 1회 조회) — 그래서 잠그는 건 강퇴 흐름 그 자체다:
//   1) 본인·방장은 강퇴 대상에서 제외한다(본인 강퇴는 서버 CANNOT_KICK_SELF, 방장은 강퇴 개념 없음).
//   2) '내보내기'→확인 시 kickMember 호출 + logGroupMemberKicked 발행 + 목록에서 제거.
//   3) NOT_FOUND(이미 나감)는 결과가 강퇴와 같아 목록에서 제거로 취급한다.
//   4) 강퇴 대상이 없으면(본인/방장뿐) 빈 상태 문구를 세운다.
//
// 네트워크만 목으로 갈아끼우고 groupErrorCode는 실제 구현을 쓴다(code 분기까지 검증).
// 확인 Alert의 onPress는 GroupRoomScreen 테스트들처럼 jest.spyOn(Alert,'alert')로 직접 호출한다.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import GroupMemberManageScreen from './GroupMemberManageScreen';
import { getGroupDetail, kickMember } from '@/services/groupApi';
import { logGroupMemberKicked } from '@/services/analyticsEvents';
import type { GroupDetailMemberResponse, GroupDetailResponse } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useRoute: () => ({ params: { groupId: '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55' } }),
}));

// 본인은 'me' — 강퇴 대상에서 빠지는 기준(방장 제외와 독립적으로 검증하기 위해 방장은 별도 계정으로 둔다).
jest.mock('@/store/UserContext', () => ({
  useUser: () => ({ userId: 'me' }),
}));

jest.mock('@/services/analyticsEvents', () => ({ logGroupMemberKicked: jest.fn() }));

jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getGroupDetail: jest.fn(),
  kickMember: jest.fn(),
}));

const mockGetGroupDetail = getGroupDetail as jest.MockedFunction<typeof getGroupDetail>;
const mockKickMember = kickMember as jest.MockedFunction<typeof kickMember>;
const mockLogKicked = logGroupMemberKicked as jest.MockedFunction<typeof logGroupMemberKicked>;

// 서버 GlobalExceptionHandler의 { code, message } 바디를 실은 axios 에러.
function axiosErrorWith(status: number, code: string): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { code, message: '...' },
  });
}

function member(over: Partial<GroupDetailMemberResponse> = {}): GroupDetailMemberResponse {
  return {
    userId: 'alice',
    nickname: '앨리스',
    role: 'MEMBER',
    focusTimeMinutes: 0,
    totalFocusMinutes: 0,
    ...over,
  };
}

// 본인(me)·방장(owner)·강퇴 대상 2명(alice·bob). me를 MEMBER로 둬서 '본인 제외'와 '방장 제외'
// 두 조건을 각각 독립적으로 검증한다(둘 다 me가 되면 방장 제외 분기가 가려진다).
function detail(members?: GroupDetailMemberResponse[]): GroupDetailResponse {
  return {
    id: GROUP_ID,
    name: '아침 6시 집중방',
    description: null,
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
    members: members ?? [
      member({ userId: 'me', nickname: '나', role: 'MEMBER' }),
      member({ userId: 'owner', nickname: '방장', role: 'OWNER' }),
      member({ userId: 'alice', nickname: '앨리스', role: 'MEMBER' }),
      member({ userId: 'bob', nickname: '밥', role: 'MEMBER' }),
    ],
  };
}

async function renderScreen() {
  const result = await render(<GroupMemberManageScreen />);
  await act(async () => {});
  return result;
}

// 확인 Alert의 '내보내기' 액션 onPress를 직접 눌러 확정한다(spyOn 방식).
async function confirmKick(alertSpy: jest.SpyInstance) {
  await act(async () => {
    alertSpy.mock.calls[0][2]?.find((b: { text?: string }) => b.text === '내보내기')?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetGroupDetail.mockResolvedValue(detail());
  mockKickMember.mockResolvedValue(undefined);
});

describe('멤버 관리(강퇴)', () => {
  test('본인·방장을 제외한 멤버만 강퇴 대상으로 렌더한다', async () => {
    await renderScreen();

    expect(screen.getByTestId('group.member.manage.screen')).toBeOnTheScreen();
    // 강퇴 대상(alice·bob)은 버튼이 뜨고, 본인(me)·방장(owner)은 뜨지 않는다.
    expect(screen.getByTestId('group.member.kick.alice')).toBeOnTheScreen();
    expect(screen.getByTestId('group.member.kick.bob')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.member.kick.me')).toBeNull();
    expect(screen.queryByTestId('group.member.kick.owner')).toBeNull();
    // 제외된 두 사람은 행 자체가 없다.
    expect(screen.queryByText('나')).toBeNull();
    expect(screen.queryByText('방장')).toBeNull();
  });

  test('내보내기→확인 시 kickMember 호출 + 로그 발행 + 목록에서 제거', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.member.kick.alice'));
    });
    // 확인 Alert 문구에 되돌릴 수 없음(재가입 차단) 안내가 들어간다.
    expect(alertSpy).toHaveBeenCalledWith(
      '내보내기',
      expect.stringContaining('다시 들어올 수 없어요'),
      expect.any(Array),
    );

    await confirmKick(alertSpy);

    expect(mockKickMember).toHaveBeenCalledWith(GROUP_ID, 'alice');
    expect(mockLogKicked).toHaveBeenCalledWith({ group_id: GROUP_ID });
    // alice는 목록에서 사라지고 bob은 남는다.
    await waitFor(() => expect(screen.queryByTestId('group.member.kick.alice')).toBeNull());
    expect(screen.getByTestId('group.member.kick.bob')).toBeOnTheScreen();

    alertSpy.mockRestore();
  });

  test('NOT_FOUND(이미 나감)도 목록에서 제거로 취급한다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockKickMember.mockRejectedValueOnce(axiosErrorWith(404, 'NOT_FOUND'));
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('group.member.kick.alice'));
    });
    await confirmKick(alertSpy);

    expect(mockKickMember).toHaveBeenCalledWith(GROUP_ID, 'alice');
    // 실패했지만 결과가 강퇴와 같아 목록에서 제거된다 — 로그·실패 Alert는 없다.
    await waitFor(() => expect(screen.queryByTestId('group.member.kick.alice')).toBeNull());
    expect(mockLogKicked).not.toHaveBeenCalled();
    // spyOn 이후 낸 Alert는 확인용 첫 호출뿐 — 실패 Alert가 추가로 뜨지 않는다.
    expect(alertSpy).toHaveBeenCalledTimes(1);

    alertSpy.mockRestore();
  });

  test('강퇴 대상이 없으면(본인/방장뿐) 빈 상태 문구를 세운다', async () => {
    mockGetGroupDetail.mockResolvedValue(
      detail([member({ userId: 'me', nickname: '나', role: 'OWNER' })]),
    );
    await renderScreen();

    expect(screen.getByText('관리할 멤버가 없어요')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.member.kick.me')).toBeNull();
  });

  // 로딩·에러 분기에도 백버튼이 남아야 목록으로 돌아갈 경로가 유지된다(루트 스택 headerShown:false).
  test('상세 조회가 실패해도 백버튼이 남고, 누르면 목록으로 돌아간다', async () => {
    mockGetGroupDetail.mockRejectedValue(new Error('network'));
    await renderScreen();

    expect(screen.getByText('멤버를 불러오지 못했어요')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('뒤로'));
    });
    expect(mockGoBack).toHaveBeenCalled();
  });
});
