// GroupOwnerTransferScreen 위임 계약 테스트 — A-2, 명세 docs/app/group-plan.md §A-2.
//
// 이 화면의 핵심 계약은 두 가지다:
//  1) 위임 대상은 **본인을 제외한 전 멤버**다(방장은 자기에게 넘길 수 없다).
//  2) 위임 성공 뒤 동작이 source로 갈린다 — withdraw만 위임 직후 그룹 나가기까지 이어간다.
// 확인 Alert는 spyOn으로 잡아 '넘기기' 액션의 onPress를 직접 호출해 확정 흐름을 검증한다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import GroupOwnerTransferScreen from './GroupOwnerTransferScreen';
import { getGroupDetail, transferOwner, withdrawGroup } from '@/services/groupApi';
import { logGroupOwnerTransferred } from '@/services/analyticsEvents';
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

const mockGetGroupDetail = getGroupDetail as jest.MockedFunction<typeof getGroupDetail>;
const mockTransferOwner = transferOwner as jest.MockedFunction<typeof transferOwner>;
const mockWithdrawGroup = withdrawGroup as jest.MockedFunction<typeof withdrawGroup>;
const mockLog = logGroupOwnerTransferred as jest.MockedFunction<typeof logGroupOwnerTransferred>;

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

// 마운트 → 대상 멤버 선택 → '넘기기' 탭까지. 확인 Alert는 confirmTransfer가 이어서 누른다.
async function mountAndSelect(targetUserId: string) {
  await mountScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId(`group.owner.transfer.member.${targetUserId}`));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('group.owner.transfer.submit'));
  });
}

// 확인 Alert('방장 넘기기')의 '넘기기' 액션을 직접 눌러 위임을 확정한다.
async function confirmTransfer(alertSpy: jest.SpyInstance) {
  await act(async () => {
    await alertSpy.mock.calls[0][2]
      ?.find((b: { text?: string }) => b.text === '넘기기')
      ?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRoute.params = { groupId: GROUP_ID, source: 'settings' };
  mockGetGroupDetail.mockResolvedValue(detail());
  mockTransferOwner.mockResolvedValue(undefined);
  mockWithdrawGroup.mockResolvedValue(undefined);
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
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mountAndSelect('u2');

    await confirmTransfer(alertSpy);

    expect(mockTransferOwner).toHaveBeenCalledWith(GROUP_ID, 'u2');
    expect(mockLog).toHaveBeenCalledWith({ group_id: GROUP_ID, source: 'settings' });
  });

  test("source==='settings'면 위임 성공 후 나가기를 부르지 않고 goBack한다", async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mountAndSelect('u2');

    await confirmTransfer(alertSpy);

    expect(mockWithdrawGroup).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
    expect(mockPopToTop).not.toHaveBeenCalled();
  });

  // 성공 통보는 Alert가 아니라 토스트로 나간다(GROMO-1381 알럿 이관) — 직후 goBack이라
  // 화면 전환을 넘어 살아남아야 해서 전역 토스트를 쓴다. 확인 Alert(위임 전)는 그대로 Alert다.
  test('위임 성공은 새 방장 이름을 담은 토스트로 알린다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mountAndSelect('u2');

    await confirmTransfer(alertSpy);

    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('수빈') }),
    );
    // 확인 Alert 1건 외에 성공 Alert가 추가로 뜨지 않는다.
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  test("source==='withdraw'면 위임 성공 직후 withdrawGroup까지 부르고 루트로 복귀한다", async () => {
    mockRoute.params = { groupId: GROUP_ID, source: 'withdraw' };
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mountAndSelect('u3');

    await confirmTransfer(alertSpy);

    expect(mockTransferOwner).toHaveBeenCalledWith(GROUP_ID, 'u3');
    expect(mockLog).toHaveBeenCalledWith({ group_id: GROUP_ID, source: 'withdraw' });
    expect(mockWithdrawGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(mockPopToTop).toHaveBeenCalled();
  });
});
