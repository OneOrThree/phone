// GroupFindSheet 검색·참여 분기 테스트 — 명세 docs/app/group-plan.md §6-3·§11(공개방 경로).
// 특히 참여 실패 표현이 Alert가 아니라 **인라인**이라는 규칙(파일 상단 주석)을 여기서 잠근다 —
// Alert로 되돌아가면 시트 위에 레이어가 두 겹이 되고 §11의 '정원 찬 그룹' 확인이 어긋난다.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import GroupFindSheet from './GroupFindSheet';
import { joinGroup, searchGroups } from '@/services/groupApi';
import { logGroupJoinAttempted, logGroupSearchPerformed } from '@/services/analyticsEvents';
import type { GroupSearchResponse } from '@/types/dto/group';

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
}));

const mockSearchGroups = searchGroups as jest.MockedFunction<typeof searchGroups>;
const mockJoinGroup = joinGroup as jest.MockedFunction<typeof joinGroup>;

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

const onClose = jest.fn();
const onJoined = jest.fn();

// RTL v14의 render는 async다 — 반드시 await한다.
function renderSheet() {
  return render(<GroupFindSheet onClose={onClose} onJoined={onJoined} />);
}

// 검색어를 넣고 디바운스(350ms)가 지나 결과가 뜰 때까지 기다린다.
//
// ⚠️ 이 파일에서는 act()를 쓰지 않는다(GroupInviteSheet.test.tsx와 다른 점).
//    디바운스 setTimeout이 살아 있는 상태에서 act가 돌면 RTL v14의 auto-cleanup과 어긋나
//    **다음 테스트의 render가 빈 트리를 낸다**(5건 동시 실패로 확인). 그 대가로 검색 이펙트발
//    act 경고가 콘솔에 몇 줄 남는다 — 실패가 아니라 의도한 트레이드오프다.
async function searchFor(name: string) {
  fireEvent.changeText(screen.getByPlaceholderText('그룹 이름으로 검색'), '집중');
  return screen.findByText(name);
}

// 참여 확인 Alert의 '참여하기' 버튼을 눌러준다(확인 Alert는 규칙상 그대로 유지된다).
function confirmJoinAlert() {
  const alertMock = Alert.alert as jest.MockedFunction<typeof Alert.alert>;
  const buttons = alertMock.mock.calls.at(-1)?.[2];
  buttons?.find((b) => b.text === '참여하기')?.onPress?.();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
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

  test('정원이 찬 그룹은 마감 표시 + 탭 비활성(§6-3)', async () => {
    mockSearchGroups.mockResolvedValue([row({ currentMembers: 5, maxMembers: 5 })]);
    await renderSheet();

    const name = await searchFor('아침 6시 집중방');
    expect(screen.getByText('마감')).toBeOnTheScreen();

    fireEvent.press(name);
    expect(Alert.alert).not.toHaveBeenCalled(); // 확인 Alert 자체가 뜨지 않는다
  });
});

describe('참여 실패는 Alert가 아니라 인라인으로 띄운다', () => {
  beforeEach(() => {
    mockSearchGroups.mockResolvedValue([row()]);
  });

  test('성공하면 계측 후 부모에게 넘긴다(join_method=search)', async () => {
    mockJoinGroup.mockResolvedValue(undefined);
    await renderSheet();

    fireEvent.press(await searchFor('아침 6시 집중방'));
    confirmJoinAlert();

    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(logGroupJoinAttempted).toHaveBeenCalledWith({ join_method: 'search' });
  });

  test('ROOM_FULL — 인라인 문구 + 목록 재조회(계측은 쏘지 않는다)', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(409, 'ROOM_FULL'));
    await renderSheet();

    fireEvent.press(await searchFor('아침 6시 집중방'));
    confirmJoinAlert();

    expect(
      await screen.findByText('정원이 가득 찼어요. 다른 그룹을 찾아보세요.'),
    ).toBeOnTheScreen();
    expect(mockSearchGroups).toHaveBeenCalledTimes(2); // 최초 검색 + 실패 후 재조회
    expect(logGroupSearchPerformed).toHaveBeenCalledTimes(1); // 재조회는 사용자 검색이 아니다
  });

  test('NOT_FOUND — 인라인 문구 + 해당 행 제거', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(404, 'NOT_FOUND'));
    await renderSheet();

    fireEvent.press(await searchFor('아침 6시 집중방'));
    confirmJoinAlert();

    expect(
      await screen.findByText('사라진 그룹이에요. 방장이 그룹을 없앴을 수 있어요.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText('아침 6시 집중방')).toBeNull();
  });

  test('ALREADY_MEMBER는 성공 취급 — 계측 없이 그룹방으로 보낸다', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(409, 'ALREADY_MEMBER'));
    await renderSheet();

    fireEvent.press(await searchFor('아침 6시 집중방'));
    confirmJoinAlert();

    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(logGroupJoinAttempted).not.toHaveBeenCalled();
  });

  test('모르는 code는 공통 문구로 떨어진다(§5-2)', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(500, 'SOMETHING_NEW'));
    await renderSheet();

    fireEvent.press(await searchFor('아침 6시 집중방'));
    confirmJoinAlert();

    expect(
      await screen.findByText('참여하지 못했어요. 잠시 후 다시 시도해주세요.'),
    ).toBeOnTheScreen();
  });

  test('GUEST_FORBIDDEN만 예외 — 시트를 닫고 로그인 유도 Alert를 띄운다', async () => {
    mockJoinGroup.mockRejectedValue(axiosErrorWith(403, 'GUEST_FORBIDDEN'));
    await renderSheet();

    fireEvent.press(await searchFor('아침 6시 집중방'));
    confirmJoinAlert();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(Alert.alert).toHaveBeenLastCalledWith(
      '로그인이 필요해요',
      expect.any(String),
      expect.any(Array),
    );
  });
});
