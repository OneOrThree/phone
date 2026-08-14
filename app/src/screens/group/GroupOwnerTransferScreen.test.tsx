// GroupOwnerTransferScreen 위임 계약 테스트 — A-2, 명세 docs/app/group-plan.md §A-2.
//
// 이 화면의 핵심 계약은 두 가지다:
//  1) 위임 대상은 **본인을 제외한 전 멤버**다(방장은 자기에게 넘길 수 없다).
//  2) 위임 성공 뒤 동작이 source로 갈린다 — withdraw만 위임 직후 그룹 나가기까지 이어간다.
// 확인은 네이티브 Alert가 아니라 앱 컨셉 카드 모달이다(GROMO-1251 — 정책 D8의 「확인이 필요한
// 2버튼」은 토스트가 아니라 2버튼 형태를 유지하되 표면만 카드로 옮긴다). 문구는 기존 그대로.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import GroupOwnerTransferScreen from './GroupOwnerTransferScreen';
import { getGroupDetail, transferOwner, withdrawGroup } from '@/services/groupApi';
import { logGroupOwnerTransferred } from '@/services/analyticsEvents';
import { getAuthSessionGeneration, triggerLogout } from '@/services/api';
import type { GroupDetailMemberResponse, GroupDetailResponse } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';

// useRoute는 렌더마다 같은 객체를 준다 — source는 테스트마다 바꿔야 해서 홀더로 두고
// 렌더 전에 params를 갈아 끼운다(실제 useRoute도 같은 참조를 유지한다).
const mockGoBack = jest.fn();
const mockPopToTop = jest.fn();
const mockNavigation = { goBack: mockGoBack, popToTop: mockPopToTop, navigate: jest.fn() };
const mockRoute: { params: { groupId: string; source: 'settings' | 'withdraw' | 'account' } } = {
  params: { groupId: GROUP_ID, source: 'settings' },
};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => mockRoute,
}));

jest.mock('@/store/UserContext', () => ({
  useUser: () => ({ userId: 'me' }),
}));

jest.mock('@/services/analyticsEvents', () => ({ logGroupOwnerTransferred: jest.fn() }));

// 위임 성공 통보가 전역 토스트로 나간다(GROMO-1381) — useToast는 Provider 밖에서 throw하므로
// 훅 자체를 목으로 대체한다(화면을 ToastProvider로 감싸지 않아도 되게).
const mockToastShow = jest.fn();
jest.mock('@/store/ToastContext', () => ({ useToast: () => ({ show: mockToastShow }) }));

// groupErrorCode는 실제 구현을 남긴다(§3-2 code 분기까지 검증).
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getGroupDetail: jest.fn(),
  transferOwner: jest.fn(),
  withdrawGroup: jest.fn(),
}));

// 유저 부재 분기가 부르는 세션 경계(GROMO-1247) — 어떤 세대로 불렸는지만 본다.
jest.mock('@/services/api', () => ({
  ...jest.requireActual('@/services/api'),
  getAuthSessionGeneration: jest.fn(() => 0),
  triggerLogout: jest.fn(),
}));

const mockGetGroupDetail = getGroupDetail as jest.MockedFunction<typeof getGroupDetail>;
const mockTransferOwner = transferOwner as jest.MockedFunction<typeof transferOwner>;
const mockWithdrawGroup = withdrawGroup as jest.MockedFunction<typeof withdrawGroup>;
const mockLog = logGroupOwnerTransferred as jest.MockedFunction<typeof logGroupOwnerTransferred>;
const mockTriggerLogout = triggerLogout as jest.MockedFunction<typeof triggerLogout>;
const mockGetAuthSessionGeneration = getAuthSessionGeneration as jest.MockedFunction<
  typeof getAuthSessionGeneration
>;

// 재로그인 안내(취소 없는 단일 확인)의 확인 버튼을 눌러 로그아웃까지 진행한다.
function pressReloginConfirm(spy: jest.SpyInstance): void {
  const [, , buttons] = spy.mock.calls[0] as unknown as [
    string,
    string,
    { text: string; onPress?: () => void }[],
  ];
  buttons[0].onPress?.();
}

function member(over: Partial<GroupDetailMemberResponse>): GroupDetailMemberResponse {
  return {
    userId: 'u',
    nickname: '멤버',
    role: 'MEMBER',
    focusTimeMinutes: 0,
    totalFocusMinutes: 0,
    ...over,
  };
}

// 기본: 방장(me) + 멤버 둘. 위임 대상은 본인을 뺀 u2·u3 두 명이다.
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
      member({ userId: 'me', nickname: '나', role: 'OWNER', totalFocusMinutes: 120 }),
      member({ userId: 'u2', nickname: '수빈', totalFocusMinutes: 90 }),
      member({ userId: 'u3', nickname: '지민', totalFocusMinutes: 60 }),
    ],
  };
}

// 마운트 조회를 흘려보낸다 — GroupRoomRouteScreen.test와 같은 패턴(render를 await한 뒤 빈 act).
async function mountScreen() {
  await render(<GroupOwnerTransferScreen />);
  await act(async () => {});
}

// 마운트 → 대상 멤버 선택 → '넘기기' 탭까지. 확인 카드는 confirmTransfer가 이어서 누른다.
async function mountAndSelect(targetUserId: string) {
  await mountScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId(`group.owner.transfer.member.${targetUserId}`));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.owner.transfer.submit'));
  });
}

// 서버 code 분기(§3-2) 검증용 — groupErrorCode가 실제 구현이라 code가 실려야 갈린다.
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

// 확인 카드('방장 넘기기')의 '넘기기'를 눌러 위임을 확정한다(GROMO-1251 — 종전 네이티브 Alert).
async function confirmTransfer() {
  expect(screen.getByTestId('group.owner.transfer.confirm')).toBeOnTheScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.owner.transfer.confirm.primary'));
  });
}

// 확인이 카드로 옮겨져(GROMO-1251) 이 화면에서 Alert는 '재시도가 유효한 실패'에만 남는다.
// 스파이는 스위트 공통으로 걸어 두고, 각 테스트가 "Alert가 아예 안 떴다"까지 단언한다.
let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockGetAuthSessionGeneration.mockReturnValue(0);
  mockRoute.params = { groupId: GROUP_ID, source: 'settings' };
  mockGetGroupDetail.mockResolvedValue(detail());
  mockTransferOwner.mockResolvedValue(undefined);
  mockWithdrawGroup.mockResolvedValue(undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('위임 대상 목록', () => {
  test('본인을 제외한 멤버만 선택지로 렌더한다', async () => {
    await mountScreen();

    expect(screen.getByTestId('group.owner.transfer.member.u2')).toBeOnTheScreen();
    expect(screen.getByTestId('group.owner.transfer.member.u3')).toBeOnTheScreen();
    // 본인(방장)은 위임 대상이 아니다.
    expect(screen.queryByTestId('group.owner.transfer.member.me')).toBeNull();
  });

  test('멤버가 본인뿐이면(1인 그룹) 빈 상태 문구를 보여준다', async () => {
    mockGetGroupDetail.mockResolvedValue(
      detail([member({ userId: 'me', nickname: '나', role: 'OWNER' })]),
    );
    await mountScreen();

    expect(screen.getByText('넘길 멤버가 없어요')).toBeOnTheScreen();
    expect(screen.queryByTestId('group.owner.transfer.submit')).toBeNull();
  });
});

describe('위임 확정 + source별 후속', () => {
  test('멤버 선택 후 넘기기→확인 시 transferOwner와 계측이 올바른 source로 나간다', async () => {
    await mountAndSelect('u2');

    await confirmTransfer();

    expect(mockTransferOwner).toHaveBeenCalledWith(GROUP_ID, 'u2');
    expect(mockLog).toHaveBeenCalledWith({ group_id: GROUP_ID, source: 'settings' });
  });

  test("source==='settings'면 위임 성공 후 나가기를 부르지 않고 goBack한다", async () => {
    await mountAndSelect('u2');

    await confirmTransfer();

    expect(mockWithdrawGroup).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
    expect(mockPopToTop).not.toHaveBeenCalled();
  });

  // 성공 통보는 Alert가 아니라 토스트로 나간다(GROMO-1381 알럿 이관) — 직후 goBack이라
  // 화면 전환을 넘어 살아남아야 해서 전역 토스트를 쓴다.
  test('위임 성공은 새 방장 이름을 담은 토스트로 알린다', async () => {
    await mountAndSelect('u2');

    await confirmTransfer();

    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('수빈') }),
    );
    // 확인까지 카드로 옮겨져(GROMO-1251) 성공 흐름엔 네이티브 Alert가 하나도 뜨지 않는다.
    expect(alertSpy).not.toHaveBeenCalled();
  });

  // 확인 카드 문구는 기존 Alert 그대로다 — withdraw 경로만 '넘긴 뒤 나갑니다'를 덧붙인다.
  test('확인 카드는 대상 이름을 담고, withdraw 경로엔 나가기 예고가 붙는다', async () => {
    mockRoute.params = { groupId: GROUP_ID, source: 'withdraw' };
    await mountAndSelect('u2');

    expect(
      screen.getByText('수빈님에게 방장을 넘길까요?\n넘긴 뒤 그룹에서 나가요.'),
    ).toBeOnTheScreen();
    // 취소하면 위임은 나가지 않는다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.owner.transfer.confirm.secondary'));
    });
    expect(mockTransferOwner).not.toHaveBeenCalled();
  });

  // 되돌릴 수 없는 동작이라 「닫힘 = 취소」가 참이어야 한다 — 진행 중에는 모든 닫기·재실행을 막는다.
  test('위임 요청 중에는 취소·스크림·재탭이 모두 막힌다', async () => {
    // 응답이 오지 않는 요청 — 진행 중 상태를 그대로 관찰한다.
    mockTransferOwner.mockReturnValueOnce(new Promise<void>(() => {}));
    await mountAndSelect('u2');
    await confirmTransfer();

    // '취소'는 아예 렌더되지 않는다 — 눌리는데 아무 일도 없으면 그 또한 거짓 신호다.
    expect(screen.queryByTestId('group.owner.transfer.confirm.secondary')).toBeNull();
    // 스크림 탭도 닫지 않는다 — 닫히면 위임이 취소된 것처럼 보이지만 요청은 계속돼 방장이 바뀐다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.owner.transfer.confirm.backdrop'));
    });
    expect(screen.getByTestId('group.owner.transfer.confirm')).toBeOnTheScreen();
    // 주 버튼 재탭도 병렬 요청을 만들지 않는다.
    await act(async () => {
      fireEvent.press(screen.getByTestId('group.owner.transfer.confirm.primary'));
    });
    expect(mockTransferOwner).toHaveBeenCalledTimes(1);
  });

  test("source==='withdraw'면 위임 성공 직후 withdrawGroup까지 부르고 루트로 복귀한다", async () => {
    mockRoute.params = { groupId: GROUP_ID, source: 'withdraw' };
    await mountAndSelect('u3');

    await confirmTransfer();

    expect(mockTransferOwner).toHaveBeenCalledWith(GROUP_ID, 'u3');
    expect(mockLog).toHaveBeenCalledWith({ group_id: GROUP_ID, source: 'withdraw' });
    expect(mockWithdrawGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(mockPopToTop).toHaveBeenCalled();
  });
});

// 실패 통보 이관(GROMO-1491 / 정책 D19 — docs/prd/motion-v2/policy.md, 상위 정본 병합 전까지
// 여기가 정본) — 재시도해도 같은 결과인 종결 실패는 확인 버튼이 필요 없으므로 tone:'error'
// 토스트로 나간다. '잠시 후 다시 시도'는 재시도가 유효해 Alert로 남는다.
describe('위임 실패 통보', () => {
  test.each([
    ['NOT_FOUND', 404, '이미 사라졌거나 나간 그룹이에요'],
    ['MEMBER_ONLY', 403, '방장이 아니라서 넘길 수 없어요'],
  ])('%s는 tone:error 토스트로 알린다', async (code, status, message) => {
    mockTransferOwner.mockRejectedValueOnce(axiosErrorWith(status, code));
    await mountAndSelect('u2');

    await confirmTransfer();

    expect(mockToastShow).toHaveBeenCalledWith({ message, tone: 'error' });
    // 실패 Alert가 뜨지 않는다(확인도 카드로 옮겨져 이 흐름엔 Alert가 0건이다).
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  // GROMO-1247 — 유저 부재는 '그룹을 찾을 수 없어요'가 아니다. 없어진 건 내 계정이라
  // 재시도·다른 대상 선택으로 풀리지 않는다. 유일한 탈출구인 재로그인으로 보낸다.
  test('유저 부재(USER_NOT_FOUND)는 그룹 부재로 위장하지 않고 재로그인을 유도한다', async () => {
    mockGetAuthSessionGeneration.mockReturnValue(3);
    mockTransferOwner.mockRejectedValueOnce(axiosErrorWith(404, 'USER_NOT_FOUND'));
    await mountAndSelect('u2');

    await confirmTransfer();

    expect(mockToastShow).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      '로그인이 필요해요',
      '로그인 정보가 만료됐어요. 다시 로그인해 주세요.',
      [expect.objectContaining({ text: '확인' })],
      { cancelable: false },
    );
    // 로그아웃은 **요청을 띄운 세션**에만 적용된다 — 안내를 읽는 사이 세션이 교체되면
    // App.tsx 핸들러가 이 세대를 대조해 무시한다(GROMO-1247 P1).
    pressReloginConfirm(alertSpy);
    expect(mockTriggerLogout).toHaveBeenCalledWith(3);
    expect(mockTriggerLogout).not.toHaveBeenCalledWith(undefined);
  });

  // 진입 조회(멤버 목록)의 404 — 위임 실패와 **다른 자리**다. 이미 없는 계정으로 들어오면
  // 여기서 안 잡을 경우 '멤버를 불러오지 못했어요 → 다시 시도'만 무한히 누르게 된다.
  test('진입 조회가 USER_NOT_FOUND면 재시도 안내에 가두지 않고 재로그인을 유도한다', async () => {
    mockGetAuthSessionGeneration.mockReturnValue(6);
    mockGetGroupDetail.mockRejectedValue(axiosErrorWith(404, 'USER_NOT_FOUND'));

    await mountScreen();

    expect(screen.getByText('멤버를 불러오지 못했어요')).toBeOnTheScreen();
    expect(alertSpy).toHaveBeenCalledWith(
      '로그인이 필요해요',
      '로그인 정보가 만료됐어요. 다시 로그인해 주세요.',
      [expect.objectContaining({ text: '확인' })],
      { cancelable: false },
    );
    pressReloginConfirm(alertSpy);
    expect(mockTriggerLogout).toHaveBeenCalledWith(6);
  });

  test('진입 조회의 다른 실패는 종전대로 에러+다시 시도로 남는다', async () => {
    mockGetGroupDetail.mockRejectedValue(axiosErrorWith(500));

    await mountScreen();

    expect(screen.getByText('멤버를 불러오지 못했어요')).toBeOnTheScreen();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockTriggerLogout).not.toHaveBeenCalled();
  });

  test('그 밖의 실패는 재시도가 유효하므로 Alert로 남는다', async () => {
    mockTransferOwner.mockRejectedValueOnce(axiosErrorWith(500));
    await mountAndSelect('u2');

    await confirmTransfer();

    expect(alertSpy).toHaveBeenLastCalledWith(
      '방장을 넘기지 못했어요',
      '잠시 후 다시 시도해 주세요.',
      expect.anything(),
      expect.anything(),
    );
    expect(mockToastShow).not.toHaveBeenCalled();
  });
});
