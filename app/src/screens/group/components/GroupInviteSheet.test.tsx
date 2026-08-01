// GroupInviteSheet 분기 테스트 — 명세 docs/app/group-plan.md §6-6·§11(비공개방 경로)
// + 2차 docs/app/group-plan-2.md §3-3(멀티 그룹 개방).
// 이 시트는 비공개 그룹의 유일한 입구다. 분기가 하나라도 조용히 뒤집히면 초대가 죽는다(프리뷰가 안 뜸).
// §11의 비공개방 7항목 중 링크 수신(실기기)을 뺀 '시트가 무엇을 보여주는가' 부분을 여기서 잠근다.
//
// ⚠️ 1차의 '이미 다른 그룹에 소속이면 차단' 계열 케이스는 2차에서 **참여가 허용된다**로 뒤집혔다.
// 케이스를 지우지 않고 새 동작(참여 허용·상한 초과 분기)으로 갈아 끼워, 가드가 되살아나면 깨지게 둔다.
//
// 네트워크 2종만 목으로 갈아끼우고 groupErrorCode는 실제 구현을 쓴다 —
// code 기반 분기(§3-2)가 실제로 맞물리는지까지 함께 검증하기 위해서다.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import GroupInviteSheet from './GroupInviteSheet';
import { getGroupOverview, getMyGroups, joinGroup } from '@/services/groupApi';
import { logGroupJoinAttempted } from '@/services/analyticsEvents';
import type { GroupOverviewResponse } from '@/types/dto/group';
import { acquireJoinLock, releaseJoinLock, resetJoinLock } from '../joinLock';

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
// 두 번째 초대 링크 — 시트는 key 없이 재사용돼 groupId만 갈린다(세대 가드 케이스).
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

const onClose = jest.fn();
const onJoined = jest.fn();
const onLogin = jest.fn();

// RTL v14의 render는 async다 — 반드시 await한다(안 하면 쿼리가 붙지 않은 thenable이 돌아온다).
// 마운트 직후 프리뷰 조회(getGroupOverview) 프라미스까지 흘려보낸다 —
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
  // 참여 잠금은 모듈 스코프다(joinLock.ts) — 한 테스트가 잠금을 쥔 채 끝나면 뒤 테스트의
  // 참여 버튼이 처음부터 잠겨 있다. 테스트 사이를 확실히 끊는다.
  resetJoinLock();
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

    // 목적지도 함께 넘긴다 — 부모는 이 id로 그룹방을 연다.
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith(GROUP_ID));
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

  // 1차의 '이미 다른 그룹에 소속이면 차단'을 대체한 케이스(2차 §0-6).
  test('다른 그룹에 이미 소속이어도 참여할 수 있다(멀티 그룹 개방)', async () => {
    mockGetMyGroups.mockResolvedValue([]); // 불려선 안 되지만, 불릴 경우 예전 가드가 살아나게 둔다
    mockGetGroupOverview.mockResolvedValue(overview());
    mockJoinGroup.mockResolvedValue(undefined);
    await renderSheet();

    expect(screen.queryByText('이미 참여 중인 그룹이 있어요. 나가고 참여해주세요.')).toBeNull();
    await press('참여하기');

    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(mockJoinGroup).toHaveBeenCalledWith(GROUP_ID);
  });

  // 사전 조회는 이제 아예 나가지 않는다 — 남아 있으면 시트가 왕복 한 번만큼 늦게 뜨고,
  // 그 응답으로 참여를 막던 fail-closed 경로가 되살아날 여지가 생긴다.
  test('소속 그룹 사전 조회(getMyGroups)를 부르지 않는다', async () => {
    mockGetGroupOverview.mockResolvedValue(overview());
    await renderSheet();

    expect(await screen.findByText('아침 6시 집중방')).toBeOnTheScreen();
    expect(mockGetMyGroups).not.toHaveBeenCalled();
  });

  // 소속 조회가 실패해도 참여가 막히지 않는다(1차 fail-closed 폐기) — 애초에 조회가 없다.
  test('소속 조회가 실패하는 상황에서도 참여를 막지 않는다', async () => {
    mockGetMyGroups.mockRejectedValue(new Error('network'));
    mockGetGroupOverview.mockResolvedValue(overview());
    mockJoinGroup.mockResolvedValue(undefined);
    await renderSheet();

    expect(await screen.findByText('아침 6시 집중방')).toBeOnTheScreen();
    await press('참여하기');

    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(
      screen.queryByText('소속 그룹을 확인하지 못했어요. 잠시 후 다시 시도해주세요.'),
    ).toBeNull();
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

  // windowStart/windowEnd는 서버가 UTC Instant로 들고 있어 ISO 문자열로 온다.
  // 문자열을 그대로 자르면 KST 기기에서 9시간 어긋난 시간대가 초대장에 찍힌다.
  // (jest.config.js가 TZ=Asia/Seoul을 고정하므로 이 기대값이 곧 KST 변환 검증이다.)
  test('시간대 미션은 UTC 원문이 아니라 기기 로컬 시각으로 보여준다', async () => {
    mockGetGroupOverview.mockResolvedValue(
      overview({
        missionType: 'TIME_WINDOW',
        durationMinutes: null,
        windowStart: '2026-08-01T21:00:00Z',
        windowEnd: '2026-08-01T23:30:00Z',
      }),
    );
    await renderSheet();

    expect(await screen.findByText('매일 06:00~08:30 집중')).toBeOnTheScreen();
  });

  // 스크린타임은 목표의 방향이 집중과 반대다(이하). 이 시트는 참여를 결정하는 유일한 정보
  // 화면인데 `목표 · 하루 60분 스크린타임` 한 줄뿐이면 60분을 채우라는 뜻으로 뒤집혀 읽힌다.
  test('스크린타임 그룹은 목표가 이하라는 뜻을 한 줄로 덧붙인다', async () => {
    mockGetGroupOverview.mockResolvedValue(overview({ missionCategory: 'SCREEN_TIME' }));
    await renderSheet();

    expect(await screen.findByText('하루 60분 스크린타임')).toBeOnTheScreen();
    expect(screen.getByText('하루 스크린타임을 목표 이하로 유지하면 달성이에요')).toBeOnTheScreen();
  });

  test('집중 그룹에는 그 캡션이 붙지 않는다(설명이 필요 없는 기본값)', async () => {
    mockGetGroupOverview.mockResolvedValue(overview());
    await renderSheet();

    expect(await screen.findByText('하루 60분 집중')).toBeOnTheScreen();
    expect(screen.queryByText('하루 스크린타임을 목표 이하로 유지하면 달성이에요')).toBeNull();
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

  // 2차 신규 — 멀티 그룹을 열면서 생긴 유일한 참여 상한. 같은 초대장에선 다시 눌러도 결과가
  // 같으므로 문구만 띄우는 게 아니라 버튼까지 잠근다.
  test('GROUP_LIMIT_EXCEEDED(409)는 상한 안내 + 참여 버튼을 잠근다', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(409, 'GROUP_LIMIT_EXCEEDED'));
    await renderSheet();

    await press('참여하기');

    expect(await screen.findByText('참여할 수 있는 그룹 수를 초과했어요')).toBeOnTheScreen();
    expect(onJoined).not.toHaveBeenCalled();

    await press('참여하기'); // 잠겼으므로 두 번째 호출이 나가지 않는다
    expect(mockJoinGroup).toHaveBeenCalledTimes(1);
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
  // B의 참여가 함께 나간다. 2차에서 멀티 그룹이 열려 '두 그룹에 걸침' 자체는 더 이상 사고가
  // 아니지만, 사용자가 **의도하지 않은** 두 번째 가입이 한 번의 탭으로 나가는 것은 그대로 사고다.
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

  // 성공은 세대를 보지 않고 넘긴다(실제로 가입됐으므로) — 그래서 부모가 목적지를 현재 groupId로
  // 잡으면 가입한 A 대신 나중에 온 B로 가려다 아무 방도 못 연다. 통지에 **가입된 그룹 id**를 싣는다.
  test('연속 초대 링크 — 늦게 도착한 앞 그룹의 참여 성공은 그 그룹 id로 통지한다', async () => {
    let resolveJoin: () => void = () => {};
    mockJoinGroup.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveJoin = resolve; // 초대 A의 참여 응답을 붙잡아 둔다
        }),
    );
    mockGetGroupOverview.mockResolvedValue(overview());
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

    await act(async () => {
      resolveJoin();
    });

    expect(onJoined).toHaveBeenCalledWith(GROUP_ID);
  });

  // joining(state)만으로 버튼을 잠그면 리렌더 전까지 버튼이 살아 있어, 같은 프레임의 두 번째 탭이
  // joinGroup을 한 벌 더 띄웠다 — 첫 요청의 성공과 뒤따르는 ALREADY_MEMBER가 각각 onJoined·계측을
  // 불러 부모 콜백과 분석 이벤트가 중복됐다. 이제 join()이 요청 직전에 ref로 동기 잠근다.
  // (1차엔 '소속 재확인이 도는 동안'이 그 창이었지만, 2차에서 사전 조회가 사라져 참여 요청 자체의
  //  왕복이 유일한 창이다 — 잠금 대상만 바뀌었을 뿐 막아야 할 중복은 그대로다.)
  test('참여 요청이 도는 중의 연타로 참여가 두 번 나가지 않는다', async () => {
    let resolveJoin: () => void = () => {};
    mockJoinGroup.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveJoin = resolve; // 첫 참여 응답을 붙잡아 둔다
        }),
    );
    mockGetGroupOverview.mockResolvedValue(overview());
    await renderSheet();

    const btn = await screen.findByTestId('group.invite.join');
    await act(async () => {
      fireEvent.press(btn); // 첫 탭 — 참여 응답에서 멈춘다
    });
    await act(async () => {
      fireEvent.press(btn); // 응답이 오기 전의 두 번째 탭
    });

    await act(async () => {
      resolveJoin();
    });

    expect(mockJoinGroup).toHaveBeenCalledTimes(1);
    expect(onJoined).toHaveBeenCalledTimes(1);
    expect(logGroupJoinAttempted).toHaveBeenCalledTimes(1);
  });

  // 시트 안의 잠금만으로는 **시트를 가로지르는 경합**을 못 막았다 — 찾기 시트에서 A 참여가
  // 진행 중일 때 초대 링크가 도착하면 GroupScreen이 찾기 시트를 내리고 이 시트를 여는데,
  // 언마운트는 진행 중인 요청을 취소하지 않으므로 B 참여가 함께 나가 두 요청이 겹쳤다.
  // (1차엔 여기에 '잠금이 풀리면 캐시한 소속을 재확인한다' 케이스가 하나 더 붙어 있었다 —
  //  그 재확인은 그룹 1개 전제를 지키려던 것이고, 2차에서 전제 자체가 폐기돼 함께 사라졌다.
  //  참여 상한은 이제 서버의 GROUP_LIMIT_EXCEEDED만 판정한다. 직렬화 자체는 그대로 남는다.)
  test('찾기 시트의 참여가 진행 중이면 초대 참여 버튼이 잠긴다', async () => {
    const foreign = acquireJoinLock(); // 찾기 시트가 A 참여를 보낸 상태
    await renderSheet();

    expect(await screen.findByText('아침 6시 집중방')).toBeOnTheScreen();
    expect(screen.queryByText('참여하기')).toBeNull(); // 스피너 — 버튼은 비활성
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.invite.join'));
    });
    expect(mockJoinGroup).not.toHaveBeenCalled();

    // A가 끝나면 이 버튼도 함께 살아난다(잠금 구독) — 그러지 않으면 초대가 영영 못 눌린다.
    await act(async () => {
      releaseJoinLock(foreign!);
    });
    expect(await screen.findByText('참여하기')).toBeOnTheScreen();
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
