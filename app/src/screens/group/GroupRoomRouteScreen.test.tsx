// GroupRoomRouteScreen 진입 계약 테스트 — 명세 docs/app/group-plan-2.md §0-2·§0-3.
//
// 이 래퍼는 로직이 없는 대신 **계약이 전부**다. 그래서 그 계약만 잠근다:
//  1) 뒤로가기. 루트 스택은 headerShown:false이고 이 화면엔 탭바도 없다 —
//     백버튼을 안 그리면 목록으로 돌아갈 명시 경로가 0개가 되고, ⋯ 메뉴에 남는 항목이
//     '그룹 나가기'(되돌릴 수 없는 파괴적 액션) 하나뿐이라 그게 탈출구처럼 보인다.
//  2) onShowGroups 미전달. 이미 목록에서 들어온 화면이라 ⋯ 메뉴의 '그룹 전환·추가'는 중복이다.
//  3) 콜백 신원 고정. GroupRoomScreen의 load→reload→useFocusEffect가 이 신원에 매달려 있어
//     인라인 함수를 넘기면 스택이 재렌더될 때마다 3콜이 한 세트씩 더 나간다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import GroupRoomRouteScreen from './GroupRoomRouteScreen';
import { getAnnouncements, getChallenges, getGroupDetail } from '@/services/groupApi';
import type { GroupDetailResponse } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';

// 포커스 이펙트가 몇 번 돌았는지를 세어 콜백 신원 고정을 검증한다.
const focusRuns = { count: 0 };
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
// 실제 useNavigation/useRoute는 렌더마다 같은 객체를 준다 — 매번 새 객체를 주면
// 여기서 검증하려는 '콜백 신원 고정'이 목 때문에 깨진다.
const mockNavigation = { goBack: mockGoBack, navigate: mockNavigate };
const mockRoute = { params: { groupId: '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55' } };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => mockRoute,
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => {
      focusRuns.count++;
      return cb();
    }, [cb]);
  },
}));

jest.mock('@/store/UserContext', () => ({
  useUser: () => ({ userId: 'me' }),
}));

// 그룹방이 정산 감지 시 잔액을 다시 받는다(CoinContext) — 테스트 트리엔 Provider가 없다.
// refresh는 **한 개를 계속 돌려준다** — 렌더마다 새 함수를 주면 load→reload 신원이 흔들려
// 이 파일이 잠그려는 '콜백 신원 고정'이 목 때문에 깨진다(실제 Provider도 useCallback으로 고정한다).
jest.mock('@/store/CoinContext', () => {
  const refresh = jest.fn(async () => true);
  const latestCoinsVersion = () => 1;
  return {
    useCoins: () => ({
      coins: 100,
      coinsLoaded: true,
      coinsVersion: 1,
      latestCoinsVersion,
      refresh,
    }),
  };
});

jest.mock('@/services/analyticsEvents', () => ({ logGroupInviteShared: jest.fn() }));

jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getGroupDetail: jest.fn(),
  getAnnouncements: jest.fn(),
  getChallenges: jest.fn(),
  withdrawGroup: jest.fn(),
}));

jest.mock('@/utils/localDate', () => ({ todayStr: jest.fn(() => '2026-08-01') }));

const mockGetGroupDetail = getGroupDetail as jest.MockedFunction<typeof getGroupDetail>;
const mockGetAnnouncements = getAnnouncements as jest.MockedFunction<typeof getAnnouncements>;
const mockGetChallenges = getChallenges as jest.MockedFunction<typeof getChallenges>;

function detail(): GroupDetailResponse {
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
    members: [{ userId: 'me', nickname: '나', role: 'OWNER', focusTimeMinutes: 30 }],
  };
}

async function renderRoute() {
  const result = await render(<GroupRoomRouteScreen />);
  await act(async () => {});
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  focusRuns.count = 0;
  mockGetGroupDetail.mockResolvedValue(detail());
  mockGetAnnouncements.mockResolvedValue([]);
  mockGetChallenges.mockResolvedValue([]);
});

describe('라우트 진입 계약', () => {
  test('헤더에 백버튼을 세우고, 누르면 목록으로 돌아간다', async () => {
    await renderRoute();

    expect(screen.getByTestId('group.room.route')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('뒤로'));
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  // 백버튼이 정상 헤더에만 있으면, 첫 조회가 도는 동안·실패했을 때 화면에 남는 건
  // 스피너 또는 '다시 시도'뿐이다 — 네이티브 헤더도 탭바도 없어 탈출구가 0개가 된다.
  test('상세 도착 전(로딩)에도 백버튼이 있다', async () => {
    // 영원히 끝나지 않는 상세 조회 — 로딩 분기에 머문다.
    mockGetGroupDetail.mockReturnValue(new Promise<GroupDetailResponse>(() => {}));
    await renderRoute();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('뒤로'));
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  test('상세 조회가 실패해도 백버튼이 남는다', async () => {
    mockGetGroupDetail.mockRejectedValue(new Error('network'));
    await renderRoute();
    expect(screen.getByText('그룹을 불러오지 못했어요')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('뒤로'));
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  test('⋯ 메뉴에 그룹 전환·추가를 노출하지 않는다(onShowGroups 미전달)', async () => {
    await renderRoute();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('그룹 메뉴'));
    });
    // 메뉴 자체는 열려 있다 — '그룹 나가기'는 두 진입 경로 모두에 있다.
    expect(screen.getByText('그룹 나가기')).toBeOnTheScreen();
    expect(screen.queryByText('그룹 전환·추가')).toBeNull();
  });

  test('재렌더돼도 포커스 재조회가 다시 돌지 않는다(콜백 신원 고정)', async () => {
    const { rerender } = await renderRoute();
    expect(focusRuns.count).toBe(1);
    expect(mockGetGroupDetail).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender(<GroupRoomRouteScreen />);
    });

    // 인라인 콜백이면 여기서 cleanup + 재실행이 일어나 상세·공지·챌린지 3콜이 한 세트 더 나간다.
    expect(focusRuns.count).toBe(1);
    expect(mockGetGroupDetail).toHaveBeenCalledTimes(1);
  });
});
