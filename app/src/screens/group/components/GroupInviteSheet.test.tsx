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
const onLogin = jest.fn();

// RTL v14의 render는 async다 — 반드시 await한다(안 하면 쿼리가 붙지 않은 thenable이 돌아온다).
// 마운트 직후 프리뷰 조회(getMyGroups→getGroupOverview) 프라미스까지 흘려보낸다 —
// act 밖에서 setState가 돌면 경고가 쏟아진다.
async function renderSheet() {
  const result = await render(
    <GroupInviteSheet groupId={GROUP_ID} onClose={onClose} onJoined={onJoined} onLogin={onLogin} />,
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

    // 이동·시트 내리기는 부모(onLogin)의 몫이다. 이 시트는 RN 네이티브 Modal이라
    // 그대로 두면 계정 화면 위에 남아 소셜 로그인 버튼을 가린다(로그인 자체가 불가능해진다).
    // 대신 onClose는 부르지 않는다 — onClose는 초대 버퍼까지 비워 로그인 후 복귀(§6-6)를 깬다.
    await press('로그인하고 참여하기');
    expect(onLogin).toHaveBeenCalled();
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

  // fail-open이면 이미 A 그룹에 있는 사용자가 B에도 가입돼 앱이 못 보여주는 그룹이 생긴다(§0).
  test('소속 그룹을 끝내 확인하지 못하면 참여를 막는다(fail-closed)', async () => {
    mockGetMyGroups.mockRejectedValue(new Error('network'));
    mockGetGroupOverview.mockResolvedValue(overview());
    await renderSheet();

    // 프리뷰까지는 보여준다 — 막는 것은 참여뿐이다.
    expect(await screen.findByText('아침 6시 집중방')).toBeOnTheScreen();

    await press('참여하기');

    expect(
      await screen.findByText('소속 그룹을 확인하지 못했어요. 잠시 후 다시 시도해주세요.'),
    ).toBeOnTheScreen();
    expect(mockJoinGroup).not.toHaveBeenCalled();
    expect(mockGetMyGroups).toHaveBeenCalledTimes(2); // 마운트 시 1회 + 참여 직전 재확인 1회
  });

  // 마지막 멤버가 나가면 서버가 그룹을 ENDED로 내린다(Group.close()). 그런데 서버 join은
  // 상태를 보지 않아, 그대로 두면 종료된 그룹에 멤버십만 생기는 모순 데이터가 만들어진다.
  test('종료된(ENDED) 그룹은 사라진 그룹과 같이 끝낸다', async () => {
    mockGetGroupOverview.mockResolvedValue(overview({ status: 'ENDED' }));
    await renderSheet();

    expect(await screen.findByText('사라진 그룹이에요')).toBeOnTheScreen();
    expect(screen.queryByText('참여하기')).toBeNull();
  });

  // 비밀번호는 폐기 개념(§0)이라 앱은 항상 빈 바디로 join한다 — 기존 비번 그룹을 그냥 두면
  // 눌러도 WRONG_PASSWORD로만 끝나고 화면엔 공통 실패 문구밖에 뜨지 않는다.
  test('비밀번호가 걸린 그룹은 이유를 밝히고 참여를 막는다', async () => {
    mockGetGroupOverview.mockResolvedValue(overview({ hasPassword: true }));
    await renderSheet();

    expect(await screen.findByText('비밀번호가 걸린 그룹이라 참여할 수 없어요')).toBeOnTheScreen();
    await press('참여하기');
    expect(mockJoinGroup).not.toHaveBeenCalled();
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

  // 시트는 key 없이 재사용된다(GroupScreen) — groupId만 바뀌므로 이전 그룹의 차단 상태가
  // 남으면 정상 프리뷰를 보여줘야 할 그룹에 게스트 차단 화면이 뜬다.
  test('연속 초대 링크 — groupId가 바뀌면 GUEST_FORBIDDEN 차단이 따라오지 않는다', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(403, 'GUEST_FORBIDDEN'));
    const { rerender } = await renderSheet();

    await press('참여하기');
    expect(await screen.findByText('로그인하면 그룹에 참여할 수 있어요')).toBeOnTheScreen();

    mockGetGroupOverview.mockResolvedValue(overview({ id: OTHER_GROUP_ID, name: '저녁 스터디방' }));
    await act(async () => {
      rerender(
        <GroupInviteSheet
          groupId={OTHER_GROUP_ID}
          onClose={onClose}
          onJoined={onJoined}
          onLogin={onLogin}
        />,
      );
    });

    expect(await screen.findByText('저녁 스터디방')).toBeOnTheScreen();
    expect(screen.queryByText('로그인하면 그룹에 참여할 수 있어요')).toBeNull();
  });

  // 프리뷰 조회에는 alive 가드가 있지만 참여 요청에는 없었다 — 초대 A의 참여가 진행 중일 때
  // 초대 B 링크가 도착하면 groupId만 갈리므로, 늦게 온 A의 ROOM_FULL이 B 프리뷰를 차단했다.
  test('연속 초대 링크 — 늦게 도착한 앞 그룹의 참여 실패가 새 프리뷰를 막지 않는다', async () => {
    let rejectJoin: (e: unknown) => void = () => {};
    mockJoinGroup.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectJoin = reject; // 초대 A의 참여 응답을 붙잡아 둔다
        }),
    );
    const { rerender } = await renderSheet();

    await press('참여하기');

    // A 응답이 오기 전에 초대 B가 도착한다.
    mockGetGroupOverview.mockResolvedValue(overview({ id: OTHER_GROUP_ID, name: '저녁 스터디방' }));
    await act(async () => {
      rerender(
        <GroupInviteSheet
          groupId={OTHER_GROUP_ID}
          onClose={onClose}
          onJoined={onJoined}
          onLogin={onLogin}
        />,
      );
    });
    expect(await screen.findByText('저녁 스터디방')).toBeOnTheScreen();

    await act(async () => {
      rejectJoin(axiosErrorWith(409, 'ROOM_FULL'));
    });

    expect(screen.queryByText('정원이 가득 찼어요')).toBeNull();
    // B는 그대로 참여 가능한 상태다(A가 끝났으므로 잠금이 풀려 있다).
    mockJoinGroup.mockResolvedValueOnce(undefined);
    await press('참여하기');
    expect(mockJoinGroup).toHaveBeenLastCalledWith(OTHER_GROUP_ID);
  });

  // 위 가드는 '늦게 온 응답을 버린다'까지만 한다 — A가 **아직 진행 중일 때** 잠금까지 풀면
  // B의 참여가 함께 나가고, 서버는 그룹 1개를 강제하지 않아(GroupService:207-243) 둘 다
  // 성공한다. 그러면 앱은 groups[0]만 보여줘 나머지 한 곳은 나갈 수도 없이 남는다(§0).
  test('연속 초대 링크 — 앞 그룹의 참여가 끝나기 전에는 새 프리뷰도 참여를 보내지 않는다', async () => {
    let resolveJoin: () => void = () => {};
    mockJoinGroup.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveJoin = resolve; // 초대 A의 참여 응답을 붙잡아 둔다
        }),
    );
    const { rerender } = await renderSheet();

    await press('참여하기');
    expect(mockJoinGroup).toHaveBeenCalledTimes(1);

    // A 응답이 오기 전에 초대 B가 도착한다.
    mockGetGroupOverview.mockResolvedValue(overview({ id: OTHER_GROUP_ID, name: '저녁 스터디방' }));
    await act(async () => {
      rerender(
        <GroupInviteSheet
          groupId={OTHER_GROUP_ID}
          onClose={onClose}
          onJoined={onJoined}
          onLogin={onLogin}
        />,
      );
    });
    expect(await screen.findByText('저녁 스터디방')).toBeOnTheScreen();

    // A가 멤버십을 바꾸는 중이라 B의 버튼은 잠긴 채(스피너) 뜬다 — 눌러도 요청이 나가지 않는다.
    expect(screen.queryByText('참여하기')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.invite.join'));
    });
    expect(mockJoinGroup).toHaveBeenCalledTimes(1);
    expect(mockJoinGroup).toHaveBeenLastCalledWith(GROUP_ID);

    // A가 끝나면 잠금이 풀린다 — 세대가 갈렸어도 여기서 풀지 않으면 B가 영영 잠긴다.
    mockJoinGroup.mockResolvedValueOnce(undefined);
    await act(async () => {
      resolveJoin();
    });
    await press('참여하기');
    expect(mockJoinGroup).toHaveBeenLastCalledWith(OTHER_GROUP_ID);
  });

  // setJoining(true)가 소속 재확인(await) **뒤에** 있었을 땐 재확인이 도는 동안 버튼이 살아 있어,
  // 같은 프레임의 두 번째 탭이 재조회와 joinGroup을 한 벌 더 띄웠다 — 첫 요청의 성공과 뒤따르는
  // ALREADY_MEMBER가 각각 onJoined·계측을 불러 부모 콜백과 분석 이벤트가 중복됐다.
  test('소속 재확인 중의 연타로 참여가 두 번 나가지 않는다', async () => {
    let resolveMine: (gs: GroupSummaryResponse[]) => void = () => {};
    mockGetMyGroups
      .mockRejectedValueOnce(new Error('network')) // 마운트 조회 실패 — 소속을 '모름'으로 남긴다
      .mockImplementationOnce(
        () =>
          new Promise<GroupSummaryResponse[]>((resolve) => {
            resolveMine = resolve; // 참여 직전 재확인 — 응답을 붙잡아 둔다
          }),
      );
    mockGetGroupOverview.mockResolvedValue(overview());
    mockJoinGroup.mockResolvedValue(undefined);
    await renderSheet();

    const btn = await screen.findByTestId('group.invite.join');
    await act(async () => {
      fireEvent.press(btn); // 첫 탭 — 소속 재확인에서 멈춘다
    });
    await act(async () => {
      fireEvent.press(btn); // 재확인이 끝나기 전의 두 번째 탭
    });

    await act(async () => {
      resolveMine([]);
    });

    expect(mockGetMyGroups).toHaveBeenCalledTimes(2); // 마운트 1 + 재확인 1 — 연타로 늘지 않는다
    expect(mockJoinGroup).toHaveBeenCalledTimes(1);
    expect(onJoined).toHaveBeenCalledTimes(1);
    expect(logGroupJoinAttempted).toHaveBeenCalledTimes(1);
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
