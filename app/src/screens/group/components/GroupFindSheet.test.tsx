// GroupFindSheet 검색·참여 분기 테스트 — 명세 docs/app/group-plan.md §6-3·§11(공개방 경로).
// 특히 참여 실패 표현이 Alert가 아니라 **인라인**이라는 규칙(파일 상단 주석)을 여기서 잠근다 —
// Alert로 되돌아가면 시트 위에 레이어가 두 겹이 되고 §11의 '정원 찬 그룹' 확인이 어긋난다.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import GroupFindSheet from './GroupFindSheet';
import { getMyGroups, joinGroup, searchGroups } from '@/services/groupApi';
import { logGroupJoinAttempted, logGroupSearchPerformed } from '@/services/analyticsEvents';
import type { GroupSearchResponse, GroupSummaryResponse } from '@/types/dto/group';
import { isJoinLocked, resetJoinLock } from '../joinLock';

// SheetShell이 useSafeAreaInsets를 쓴다 — 테스트 트리엔 SafeAreaProvider가 없어 고정값으로 대체한다.
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('@/services/analyticsEvents', () => ({
  logGroupJoinAttempted: jest.fn(),
  logGroupSearchPerformed: jest.fn(),
}));

// groupErrorCode는 실제 구현을 남긴다(§3-2 code 분기까지 검증).
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  searchGroups: jest.fn(),
  joinGroup: jest.fn(),
  getMyGroups: jest.fn(),
}));

const mockSearchGroups = searchGroups as jest.MockedFunction<typeof searchGroups>;
const mockJoinGroup = joinGroup as jest.MockedFunction<typeof joinGroup>;
const mockGetMyGroups = getMyGroups as jest.MockedFunction<typeof getMyGroups>;

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

function row(over: Partial<GroupSearchResponse> = {}): GroupSearchResponse {
  return {
    groupId: '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55',
    name: '아침 6시 집중방',
    currentMembers: 2,
    maxMembers: 5,
    status: 'WAITING',
    hasPassword: false,
    ...over,
  };
}

function summary(over: Partial<GroupSummaryResponse> = {}): GroupSummaryResponse {
  return {
    groupId: '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55',
    name: '아침 6시 집중방',
    code: null,
    currentMembers: 2,
    maxMembers: 5,
    role: 'MEMBER',
    status: 'WAITING',
    ...over,
  };
}

const onClose = jest.fn();
const onJoined = jest.fn();

// 검색 디바운스(350ms)와 같은 값 — 가짜 타이머를 이만큼 감아 검색을 발화시킨다.
const SEARCH_DEBOUNCE_MS = 350;

// RTL v14의 render는 async다 — 반드시 await한다.
async function renderSheet() {
  const result = await render(<GroupFindSheet onClose={onClose} onJoined={onJoined} />);
  await act(async () => {});
  return result;
}

// 검색어를 넣고 디바운스가 지나 결과가 뜰 때까지 기다린다.
// 가짜 타이머 + act로 디바운스 발화와 그 뒤 setState를 전부 act 안에 가둔다 —
// 실시간 타이머로 두면 검색 이펙트발 act 경고가 콘솔에 쌓여, 진짜 '언마운트 후 업데이트' 경고가
// 섞여 들어와도 알아채지 못한다.
async function searchFor(name: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByPlaceholderText('그룹 이름으로 검색'), '집중');
  });
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
  return screen.findByText(name);
}

// 참여 확인 Alert의 '참여하기' 버튼을 눌러준다(확인 Alert는 규칙상 그대로 유지된다).
async function confirmJoinAlert() {
  const alertMock = Alert.alert as jest.MockedFunction<typeof Alert.alert>;
  const buttons = alertMock.mock.calls.at(-1)?.[2];
  await act(async () => {
    buttons?.find((b) => b.text === '참여하기')?.onPress?.();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockGetMyGroups.mockResolvedValue([]); // 기본: 소속 그룹 없음(뱃지 없음)
  // 참여 잠금은 모듈 스코프다(joinLock.ts) — 응답을 붙잡아 둔 테스트가 잠금을 쥔 채 끝나면
  // 뒤 테스트의 행이 처음부터 비활성이다. 테스트 사이를 확실히 끊는다.
  resetJoinLock();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('검색', () => {
  test('빈 검색어는 서버를 부르지 않는다(디바운스 이전 안내 문구만)', async () => {
    await renderSheet();

    expect(screen.getByText('찾고 싶은 그룹 이름을 입력해보세요')).toBeOnTheScreen();
    await waitFor(() => expect(mockSearchGroups).not.toHaveBeenCalled());
  });

  test('결과 도착 시 계측을 1회 쏜다(query_length·result_count)', async () => {
    mockSearchGroups.mockResolvedValue([row()]);
    await renderSheet();

    await searchFor('아침 6시 집중방');
    expect(logGroupSearchPerformed).toHaveBeenCalledWith({ query_length: 2, result_count: 1 });
  });

  // 참여 실패 후의 조용한 갱신에는 예전엔 토큰이 없었다 — 늦게 끝난 A 갱신이 setResults를 해서
  // 입력창은 B인데 목록은 A가 됐고, 사용자는 자기가 찾지도 않은 그룹을 탭할 수 있었다.
  test('늦게 도착한 이전 검색어의 조용한 갱신이 새 검색 결과를 덮지 않는다', async () => {
    const rowA = row({ name: '아침 6시 집중방' });
    const rowB = row({ groupId: '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8dbb', name: '저녁 스터디' });
    let resolveStaleRefresh: (rows: GroupSearchResponse[]) => void = () => {};

    mockSearchGroups
      .mockResolvedValueOnce([rowA]) // 검색어 A
      .mockImplementationOnce(
        () =>
          new Promise<GroupSearchResponse[]>((resolve) => {
            resolveStaleRefresh = resolve; // ROOM_FULL 뒤의 A 갱신 — 응답을 잡아 둔다
          }),
      )
      .mockResolvedValueOnce([rowB]); // 검색어 B
    mockJoinGroup.mockRejectedValue(axiosErrorWith(409, 'ROOM_FULL'));

    await renderSheet();
    const input = screen.getByPlaceholderText('그룹 이름으로 검색');

    await act(async () => {
      fireEvent.changeText(input, '집중');
    });
    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    await act(async () => {
      fireEvent.press(screen.getByText('아침 6시 집중방'));
    });
    await confirmJoinAlert();
    expect(screen.getByText('정원이 가득 찼어요. 다른 그룹을 찾아보세요.')).toBeOnTheScreen();

    // A 갱신이 도착하기 전에 사용자가 B를 친다.
    await act(async () => {
      fireEvent.changeText(input, '스터디');
    });
    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(screen.getByText('저녁 스터디')).toBeOnTheScreen();

    // 뒤늦게 도착한 A 갱신 — 무시돼야 한다.
    await act(async () => {
      resolveStaleRefresh([rowA]);
    });
    expect(screen.getByText('저녁 스터디')).toBeOnTheScreen();
    expect(screen.queryByText('아침 6시 집중방')).toBeNull();
  });

  // 실패를 빈 목록으로 뭉개면 '그런 이름의 공개 그룹이 없어요'가 떠서, 실제로 있는 그룹을
  // 찾는 사용자가 이름이 틀렸다고 오인하고 검색을 포기한다.
  test('조회 실패는 결과 없음과 구분한다 — 안내 + 다시 시도로 복구된다', async () => {
    mockSearchGroups.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce([row()]);
    await renderSheet();

    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('그룹 이름으로 검색'), '집중');
    });
    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });

    expect(await screen.findByText('검색하지 못했어요')).toBeOnTheScreen();
    expect(screen.queryByText('그런 이름의 공개 그룹이 없어요')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText('다시 시도'));
    });
    expect(await screen.findByText('아침 6시 집중방')).toBeOnTheScreen();
    expect(screen.queryByText('검색하지 못했어요')).toBeNull();
  });

  // 이전엔 새 검색어를 쳐도 results를 그대로 뒀다 — 입력창은 B인데 목록엔 A의 행이 활성 상태로
  // 남아, 디바운스+요청이 끝나기 전에 그 행을 누른 사용자가 B를 검색한 화면에서 A에 참여했다.
  test('검색어를 바꾸면 이전 결과를 즉시 비운다', async () => {
    mockSearchGroups
      .mockResolvedValueOnce([row({ name: '아침 6시 집중방' })])
      .mockImplementationOnce(() => new Promise<GroupSearchResponse[]>(() => {})); // B 응답을 붙잡아 둔다
    await renderSheet();
    const input = screen.getByPlaceholderText('그룹 이름으로 검색');

    await act(async () => {
      fireEvent.changeText(input, '집중');
    });
    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(await screen.findByText('아침 6시 집중방')).toBeOnTheScreen();

    // B로 바꾼 직후 — 디바운스도 지나기 전이다.
    await act(async () => {
      fireEvent.changeText(input, '스터디');
    });
    expect(screen.queryByText('아침 6시 집중방')).toBeNull();
    expect(screen.getByText('검색 중…')).toBeOnTheScreen();

    // 응답을 기다리는 동안에도 옛 행은 돌아오지 않는다.
    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(screen.queryByText('아침 6시 집중방')).toBeNull();
  });

  // 서버는 검색에서 상태·비밀번호를 거르지 않는데 join은 둘 다 통과시키지 않는다(ENDED는
  // 멤버십만 생기는 모순, 비번 그룹은 항상 WRONG_PASSWORD) — 탭할 수 없는 행은 아예 숨긴다.
  test('종료된 그룹과 비밀번호 그룹은 결과에서 제외한다', async () => {
    mockSearchGroups.mockResolvedValue([
      row({ name: '아침 6시 집중방' }),
      row({
        groupId: '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d11',
        name: '끝난 집중방',
        status: 'ENDED',
      }),
      row({
        groupId: '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d22',
        name: '비번 집중방',
        hasPassword: true,
      }),
    ]);
    await renderSheet();

    await searchFor('아침 6시 집중방');
    expect(screen.queryByText('끝난 집중방')).toBeNull();
    expect(screen.queryByText('비번 집중방')).toBeNull();
    // 계측 result_count는 화면에 실제로 뜬 개수를 따른다
    expect(logGroupSearchPerformed).toHaveBeenCalledWith({ query_length: 2, result_count: 1 });
  });

  test('정원이 찬 그룹은 정원 가득 표시 + 탭 비활성(§6-3)', async () => {
    mockSearchGroups.mockResolvedValue([row({ currentMembers: 5, maxMembers: 5 })]);
    await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    expect(screen.getByText('정원 가득')).toBeOnTheScreen();

    fireEvent.press(name);
    expect(Alert.alert).not.toHaveBeenCalled(); // 확인 Alert 자체가 뜨지 않는다
  });
});

// 멀티 그룹(2차 §3-3) — 검색 결과에 내 그룹이 섞여 나온다. 그 행은 참여 대상이 아니라 이동 대상이다.
describe('이미 소속한 그룹', () => {
  const MY_GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
  const OTHER_GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8dcc';

  test('참여 중 뱃지가 붙고 탭해도 참여 Alert·joinGroup이 나가지 않는다', async () => {
    mockGetMyGroups.mockResolvedValue([summary()]);
    mockSearchGroups.mockResolvedValue([row()]);
    await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    expect(screen.getByText('참여 중')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(name);
    });
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockJoinGroup).not.toHaveBeenCalled();
  });

  // 내 그룹이 2건 이상이면 그룹 탭은 목록을 그리고 있다 — 그룹방을 스택에 올려야 한다.
  test('내 그룹이 2건 이상이면 시트를 닫고 해당 그룹방으로 이동한다', async () => {
    mockGetMyGroups.mockResolvedValue([
      summary(),
      summary({ groupId: OTHER_GROUP_ID, name: '저녁 스터디' }),
    ]);
    mockSearchGroups.mockResolvedValue([row()]);
    await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    await act(async () => {
      fireEvent.press(name);
    });

    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('GroupRoom', { groupId: MY_GROUP_ID });
  });

  // 1건이면 그룹 탭이 이미 그 방을 내장 렌더한다 — push 하면 같은 방이 겹친다(배관 결정 6).
  test('내 그룹이 1건이면 push 대신 부모에게 넘긴다(같은 방이 겹치지 않게)', async () => {
    mockGetMyGroups.mockResolvedValue([summary()]);
    mockSearchGroups.mockResolvedValue([row()]);
    await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    await act(async () => {
      fireEvent.press(name);
    });

    expect(onJoined).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // 소속 조회 실패는 뱃지만 포기한다(fail-open) — 탭하면 서버 ALREADY_MEMBER가 같은 곳으로 보낸다.
  test('소속 조회가 실패하면 뱃지 없이 평소대로 동작한다', async () => {
    mockGetMyGroups.mockRejectedValue(new Error('network'));
    mockSearchGroups.mockResolvedValue([row()]);
    mockJoinGroup.mockRejectedValue(axiosErrorWith(409, 'ALREADY_MEMBER'));
    await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    expect(screen.queryByText('참여 중')).toBeNull();

    await act(async () => {
      fireEvent.press(name);
    });
    await confirmJoinAlert();

    await waitFor(() => expect(onJoined).toHaveBeenCalled());
  });

  // 내 그룹이 정원까지 찼어도 나는 이미 안에 있다 — full 흐림·탭 비활성에 걸리면 못 들어간다.
  test('정원이 찬 내 그룹도 들어갈 수 있다(참여 중 판정이 정원보다 우선)', async () => {
    mockGetMyGroups.mockResolvedValue([
      summary({ currentMembers: 5 }),
      summary({ groupId: OTHER_GROUP_ID, name: '저녁 스터디' }),
    ]);
    mockSearchGroups.mockResolvedValue([row({ currentMembers: 5, maxMembers: 5 })]);
    await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    expect(screen.queryByText('정원 가득')).toBeNull();

    await act(async () => {
      fireEvent.press(name);
    });
    expect(mockNavigate).toHaveBeenCalledWith('GroupRoom', { groupId: MY_GROUP_ID });
  });
});

describe('참여 실패는 Alert가 아니라 인라인으로 띄운다', () => {
  beforeEach(() => {
    mockSearchGroups.mockResolvedValue([row()]);
  });

  test('성공하면 계측 후 부모에게 넘긴다(join_method=search)', async () => {
    mockJoinGroup.mockResolvedValue(undefined);
    await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    await act(async () => {
      fireEvent.press(name);
    });
    await confirmJoinAlert();

    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(logGroupJoinAttempted).toHaveBeenCalledWith({ join_method: 'search' });
  });

  test('ROOM_FULL — 인라인 문구 + 목록 재조회(계측은 쏘지 않는다)', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(409, 'ROOM_FULL'));
    await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    await act(async () => {
      fireEvent.press(name);
    });
    await confirmJoinAlert();

    expect(
      await screen.findByText('정원이 가득 찼어요. 다른 그룹을 찾아보세요.'),
    ).toBeOnTheScreen();
    expect(mockSearchGroups).toHaveBeenCalledTimes(2); // 최초 검색 + 실패 후 재조회
    expect(logGroupSearchPerformed).toHaveBeenCalledTimes(1); // 재조회는 사용자 검색이 아니다
  });

  // 2차 신규 — 상한은 그룹이 아니라 내 사정이라, ROOM_FULL과 달리 목록을 재조회하지 않는다.
  test('GROUP_LIMIT_EXCEEDED — 상한 안내(목록 재조회 없음)', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(409, 'GROUP_LIMIT_EXCEEDED'));
    await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    await act(async () => {
      fireEvent.press(name);
    });
    await confirmJoinAlert();

    expect(await screen.findByText('참여할 수 있는 그룹 수를 초과했어요')).toBeOnTheScreen();
    expect(onJoined).not.toHaveBeenCalled();
    expect(mockSearchGroups).toHaveBeenCalledTimes(1); // 최초 검색뿐
  });

  test('NOT_FOUND — 인라인 문구 + 해당 행 제거', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(404, 'NOT_FOUND'));
    await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    await act(async () => {
      fireEvent.press(name);
    });
    await confirmJoinAlert();

    expect(
      await screen.findByText('사라진 그룹이에요. 방장이 그룹을 없앴을 수 있어요.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText('아침 6시 집중방')).toBeNull();
  });

  test('ALREADY_MEMBER는 성공 취급 — 그룹방으로 보낸다(시도 계측은 한 번만)', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(409, 'ALREADY_MEMBER'));
    await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    await act(async () => {
      fireEvent.press(name);
    });
    await confirmJoinAlert();

    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(logGroupJoinAttempted).toHaveBeenCalledTimes(1); // 요청 직전 1회 — 실패 분기가 더하지 않는다
  });

  // group_join_attempted는 서버 소유 group_joined의 분모다 — 성공에서만 쏘면 실패한 시도가
  // 통째로 빠져 전환율이 언제나 100%가 된다.
  test('참여가 실패해도 시도 계측은 남는다', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(409, 'ROOM_FULL'));
    await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    await act(async () => {
      fireEvent.press(name);
    });
    await confirmJoinAlert();

    expect(
      await screen.findByText('정원이 가득 찼어요. 다른 그룹을 찾아보세요.'),
    ).toBeOnTheScreen();
    expect(logGroupJoinAttempted).toHaveBeenCalledWith({ join_method: 'search' });
  });

  test('모르는 code는 공통 문구로 떨어진다(§5-2)', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(500, 'SOMETHING_NEW'));
    await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    await act(async () => {
      fireEvent.press(name);
    });
    await confirmJoinAlert();

    expect(
      await screen.findByText('참여하지 못했어요. 잠시 후 다시 시도해주세요.'),
    ).toBeOnTheScreen();
  });

  // 참여 요청에도 검색 세대가 필요하다 — 없으면 늦게 온 A의 ROOM_FULL이 B 화면에 문구를 띄우고,
  // 뒤이은 refreshResults가 B의 세대 번호를 달고 A를 다시 조회해 B 결과를 정상 요청처럼 덮는다.
  test('검색어가 바뀐 뒤 도착한 참여 실패는 새 검색 화면에 반영되지 않는다', async () => {
    const rowA = row({ name: '아침 6시 집중방' });
    const rowB = row({ groupId: '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8dbb', name: '저녁 스터디' });
    let rejectJoin: (e: unknown) => void = () => {};

    mockSearchGroups.mockResolvedValueOnce([rowA]).mockResolvedValueOnce([rowB]);
    mockJoinGroup.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectJoin = reject; // A의 참여 응답을 붙잡아 둔다
        }),
    );

    await renderSheet();
    const input = screen.getByPlaceholderText('그룹 이름으로 검색');

    await act(async () => {
      fireEvent.changeText(input, '집중');
    });
    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    await act(async () => {
      fireEvent.press(screen.getByText('아침 6시 집중방'));
    });
    await confirmJoinAlert();

    // A 응답이 오기 전에 검색어를 B로 바꾼다.
    await act(async () => {
      fireEvent.changeText(input, '스터디');
    });
    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(screen.getByText('저녁 스터디')).toBeOnTheScreen();

    await act(async () => {
      rejectJoin(axiosErrorWith(409, 'ROOM_FULL'));
    });

    expect(screen.queryByText('정원이 가득 찼어요. 다른 그룹을 찾아보세요.')).toBeNull();
    expect(screen.getByText('저녁 스터디')).toBeOnTheScreen();
    expect(mockSearchGroups).toHaveBeenCalledTimes(2); // A 갱신(refreshResults)이 나가지 않았다
  });

  // 이 시트의 참여는 **전역 잠금**을 쥔다(joinLock.ts). 초대 링크가 도착하면 부모가 이 시트를
  // 내리고 초대 시트를 여는데, 언마운트가 진행 중인 요청을 취소하지는 않는다 — 잠금이 남아
  // 있어야 새 시트의 참여가 함께 나가 두 그룹에 걸치는 일을 막는다(§0).
  test('참여 요청이 떠 있는 동안 전역 잠금을 쥔다 — 시트를 내려도 유지된다', async () => {
    let resolveJoin: () => void = () => {};
    mockJoinGroup.mockImplementation(() => new Promise<void>((res) => (resolveJoin = () => res())));
    const { unmount } = await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    await act(async () => {
      fireEvent.press(name);
    });
    await confirmJoinAlert();
    expect(isJoinLocked()).toBe(true);

    await act(async () => {
      unmount(); // 초대 링크 수신 → 부모가 찾기 시트를 내린다
    });
    expect(isJoinLocked()).toBe(true); // 요청은 아직 살아 있다

    await act(async () => {
      resolveJoin();
    });
    expect(isJoinLocked()).toBe(false);
  });

  test('GUEST_FORBIDDEN만 예외 — 시트를 닫고 로그인 유도 Alert를 띄운다', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(403, 'GUEST_FORBIDDEN'));
    await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    await act(async () => {
      fireEvent.press(name);
    });
    await confirmJoinAlert();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(Alert.alert).toHaveBeenLastCalledWith(
      '로그인이 필요해요',
      expect.any(String),
      expect.any(Array),
    );
  });
});
