// GroupInviteSheet 분기 테스트 — 명세 docs/app/group-plan.md §6-6·§11(비공개방 경로).
// 이 시트는 비공개 그룹의 유일한 입구다. 분기가 하나라도 조용히 뒤집히면 초대가 죽거나
// (프리뷰가 안 뜸) 그룹 1개 전제가 깨진다(다른 그룹에 겹쳐 가입). §11의 비공개방 7항목 중
// 링크 수신(실기기)을 뺀 '시트가 무엇을 보여주는가' 부분을 여기서 잠근다.
//
// 네트워크 3종만 목으로 갈아끼우고 groupErrorCode는 실제 구현을 쓴다 —
// code 기반 분기(§3-2)가 실제로 맞물리는지까지 함께 검증하기 위해서다.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import GroupInviteSheet from './GroupInviteSheet';
import { getGroupOverview, getMyGroups, joinGroup } from '@/services/groupApi';
import { logGroupJoinAttempted } from '@/services/analyticsEvents';
import type { GroupOverviewResponse, GroupSummaryResponse } from '@/types/dto/group';

// SheetShell이 useSafeAreaInsets를 쓴다 — 테스트 트리엔 SafeAreaProvider가 없어 고정값으로 대체한다.
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

let mockIsGuest = false;
jest.mock('@/store/UserContext', () => ({
  useUser: () => ({ isGuest: mockIsGuest }),
}));

jest.mock('@/services/analyticsEvents', () => ({
  logGroupJoinAttempted: jest.fn(),
}));

// groupErrorCode는 실제 구현을 남긴다(§3-2 code 분기까지 검증).
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getGroupOverview: jest.fn(),
  getMyGroups: jest.fn(),
  joinGroup: jest.fn(),
}));

const mockGetGroupOverview = getGroupOverview as jest.MockedFunction<typeof getGroupOverview>;
const mockGetMyGroups = getMyGroups as jest.MockedFunction<typeof getMyGroups>;
const mockJoinGroup = joinGroup as jest.MockedFunction<typeof joinGroup>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const OTHER_GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d99';

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

// overview의 식별자 필드는 groupId가 아니라 id다(§7 DTO 미러).
function overview(over: Partial<GroupOverviewResponse> = {}): GroupOverviewResponse {
  return {
    id: GROUP_ID,
    name: '아침 6시 집중방',
    description: null,
    missionCategory: 'FOCUS',
    missionType: 'DURATION',
    durationMinutes: 60,
    windowStart: null,
    windowEnd: null,
    maxMembers: 5,
    memberCount: 2,
    status: 'WAITING',
    hasPassword: false,
    isMember: false,
    ...over,
  };
}

function summary(groupId: string): GroupSummaryResponse {
  return {
    groupId,
    name: '다른 그룹',
    code: null,
    currentMembers: 1,
    maxMembers: 5,
    role: 'MEMBER',
    status: 'WAITING',
  };
}

const onClose = jest.fn();
const onJoined = jest.fn();

// RTL v14의 render는 async다 — 반드시 await한다(안 하면 쿼리가 붙지 않은 thenable이 돌아온다).
// 마운트 직후 프리뷰 조회(getMyGroups→getGroupOverview) 프라미스까지 흘려보낸다 —
// act 밖에서 setState가 돌면 경고가 쏟아진다.
async function renderSheet() {
  const result = await render(
    <GroupInviteSheet groupId={GROUP_ID} onClose={onClose} onJoined={onJoined} />,
  );
  await act(async () => {});
  return result;
}

// 비동기 핸들러(참여 등)를 부르는 탭 — fireEvent만으론 이어지는 setState가 act 밖으로 샌다.
async function press(label: string) {
  const el = await screen.findByText(label);
  await act(async () => {
    fireEvent.press(el);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsGuest = false;
  mockGetMyGroups.mockResolvedValue([]); // 기본: 소속 그룹 없음
});

describe('프리뷰 조회 분기', () => {
  test('게스트는 조회 없이 로그인 유도만 띄운다(§5-3 — 왕복을 아낀다)', async () => {
    mockIsGuest = true;
    await renderSheet();

    expect(screen.getByText('로그인하면 그룹에 참여할 수 있어요')).toBeOnTheScreen();
    expect(mockGetGroupOverview).not.toHaveBeenCalled();

    // 로그인으로 보내되 시트를 닫지 않는다 — 초대 버퍼가 살아 있어야 로그인 후 같은 그룹으로 복귀한다(§6-6).
    await press('로그인하고 참여하기');
    expect(mockNavigate).toHaveBeenCalledWith('SettingsAccount');
    expect(onClose).not.toHaveBeenCalled();
  });

  test('이미 멤버면 프리뷰 없이 곧장 그룹방으로 넘긴다', async () => {
    mockGetGroupOverview.mockResolvedValue(overview({ isMember: true }));
    await renderSheet();

    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(screen.queryByText('참여하기')).toBeNull();
  });

  // 와이어 레벨 회귀 — 지금 서버는 Jackson이 'is'를 떼서 `member` 키로 내려준다.
  // 앱이 isMember만 읽으면 이 분기가 통째로 죽어 프리뷰가 그대로 뜬다(§6-6 표 위반).
  test('서버가 isMember 대신 member 키로 내려줘도 같은 분기를 탄다', async () => {
    mockGetGroupOverview.mockResolvedValue(overview({ isMember: undefined, member: true }));
    await renderSheet();

    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(screen.queryByText('참여하기')).toBeNull();
  });

  test('정원이 찬 그룹은 안내 + 참여 차단', async () => {
    mockGetGroupOverview.mockResolvedValue(overview({ memberCount: 5, maxMembers: 5 }));
    await renderSheet();

    expect(await screen.findByText('정원이 가득 찼어요')).toBeOnTheScreen();
    await press('참여하기');
    expect(mockJoinGroup).not.toHaveBeenCalled();
  });

  test('다른 그룹에 이미 소속이면 참여를 막는다(그룹 1개 전제 §0 — 백엔드가 검사하지 않는다)', async () => {
    mockGetMyGroups.mockResolvedValue([summary(OTHER_GROUP_ID)]);
    mockGetGroupOverview.mockResolvedValue(overview());
    await renderSheet();

    expect(
      await screen.findByText('이미 참여 중인 그룹이 있어요. 나가고 참여해주세요.'),
    ).toBeOnTheScreen();
    await press('참여하기');
    expect(mockJoinGroup).not.toHaveBeenCalled();
  });

  test('같은 그룹에 이미 소속이면 막지 않는다(자기 그룹 링크를 자기가 열었을 때)', async () => {
    mockGetMyGroups.mockResolvedValue([summary(GROUP_ID)]);
    mockGetGroupOverview.mockResolvedValue(overview({ isMember: true }));
    await renderSheet();

    await waitFor(() => expect(onJoined).toHaveBeenCalled());
  });

  test('404는 사라진 그룹으로 안내한다', async () => {
    mockGetGroupOverview.mockRejectedValue(axiosErrorWith(404, 'NOT_FOUND'));
    await renderSheet();

    expect(await screen.findByText('사라진 그룹이에요')).toBeOnTheScreen();
  });

  test('바디 없는 404도 사라진 그룹으로 본다', async () => {
    mockGetGroupOverview.mockRejectedValue(axiosErrorWith(404));
    await renderSheet();

    expect(await screen.findByText('사라진 그룹이에요')).toBeOnTheScreen();
  });

  test('그 밖의 조회 실패는 다시 시도 — 초대장을 버리지 않는다', async () => {
    mockGetGroupOverview.mockRejectedValueOnce(axiosErrorWith(500));
    mockGetGroupOverview.mockResolvedValueOnce(overview());
    await renderSheet();

    expect(await screen.findByText('초대장을 열지 못했어요')).toBeOnTheScreen();

    await press('다시 시도');
    expect(await screen.findByText('아침 6시 집중방')).toBeOnTheScreen();
  });

  test('정상 프리뷰 — 이름·인원·목표를 보여준다', async () => {
    mockGetGroupOverview.mockResolvedValue(overview());
    await renderSheet();

    expect(await screen.findByText('아침 6시 집중방')).toBeOnTheScreen();
    expect(screen.getByText('2/5명')).toBeOnTheScreen();
    expect(screen.getByText('하루 60분 집중')).toBeOnTheScreen();
  });
});

describe('참여 분기', () => {
  beforeEach(() => {
    mockGetGroupOverview.mockResolvedValue(overview());
  });

  test('성공하면 계측 후 부모에게 넘긴다(join_method=invite)', async () => {
    mockJoinGroup.mockResolvedValue(undefined);
    await renderSheet();

    await press('참여하기');

    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(mockJoinGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(logGroupJoinAttempted).toHaveBeenCalledWith({ join_method: 'invite' });
  });

  test('ALREADY_MEMBER(409)는 성공 취급 — 링크를 두 번 눌러도 막히지 않는다', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(409, 'ALREADY_MEMBER'));
    await renderSheet();

    await press('참여하기');

    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(logGroupJoinAttempted).toHaveBeenCalledWith({ join_method: 'invite' });
  });

  test('ROOM_FULL(409)은 같은 409라도 code로 갈려 참여를 막는다', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(409, 'ROOM_FULL'));
    await renderSheet();

    await press('참여하기');

    expect(await screen.findByText('정원이 가득 찼어요')).toBeOnTheScreen();
    expect(onJoined).not.toHaveBeenCalled();
  });

  test('참여 중 NOT_FOUND는 사라진 그룹으로 전환한다', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(404, 'NOT_FOUND'));
    await renderSheet();

    await press('참여하기');

    expect(await screen.findByText('사라진 그룹이에요')).toBeOnTheScreen();
  });

  test('GUEST_FORBIDDEN(403)은 로그인 화면으로 떨어뜨린다(구 세션 태깅 어긋남)', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(403, 'GUEST_FORBIDDEN'));
    await renderSheet();

    await press('참여하기');

    expect(await screen.findByText('로그인하면 그룹에 참여할 수 있어요')).toBeOnTheScreen();
  });

  test('모르는 code는 공통 문구로 떨어진다(§5-2)', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(500, 'SOMETHING_NEW'));
    await renderSheet();

    await press('참여하기');

    expect(
      await screen.findByText('참여하지 못했어요. 잠시 후 다시 시도해주세요.'),
    ).toBeOnTheScreen();
  });
});
