// AccountScreen 회원 탈퇴 플로우 테스트 — GROMO-1210 (방장 블록 안내: 네이티브 Alert → 카드 모달).
//
// 이 화면의 탈퇴 계약:
//  1) 탈퇴 400 + code HOST_WITHDRAW → 위임 유도 카드 모달(§3-2: status가 아니라 code로 분기).
//     위임 대상은 내 소유(OWNER)·다중 멤버(currentMembers > 1) 그룹만이다.
//  2) '방장 넘기러 가기' → GroupOwnerTransfer(source: 'account')로 navigate.
//  3) 위임 대상이 없거나(0개) 목록 조회에 실패하면 일반 안내 카드로 폴백.
//  4) HOST_WITHDRAW가 아닌 오류(무관한 400 포함)는 방장 문구 없이 일반 오류 Alert.
//  5) 탈퇴 성공 시 triggerLogout까지 이어진다(무회귀).
//  6) 로그아웃·연동 해제 확인도 네이티브 2버튼 Alert가 아니라 같은 카드 모달이다
//     (GROMO-1251 — 정책 D8: 확인이 필요한 2버튼은 토스트 대상이 아니라 표면만 카드로 옮긴다).
//     문구는 기존 Alert 그대로이고, 실패 안내(재시도 유도)는 Alert로 남는다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import AccountScreen from './AccountScreen';
import { getSocialLinks, unlinkSocialAccount, withdraw } from '@/services/userApi';
import { getMyGroups } from '@/services/groupApi';
import { triggerLogout } from '@/services/api';
import { clearLastAuthProvider } from '@/services/auth';
import { logWithdrawalConfirmed } from '@/services/analyticsEvents';
import type { GroupSummaryResponse } from '@/types/dto/group';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb]);
  },
}));

jest.mock('@/store/UserContext', () => ({
  useUser: () => ({ isGuest: false }),
}));

// auth는 카카오·구글 네이티브 SDK를 전이 import 한다 — 통째로 목킹(이 스위트는 탈퇴만 본다).
jest.mock('@/services/auth', () => ({
  kakaoLogin: jest.fn(),
  appleLogin: jest.fn(),
  googleLogin: jest.fn(),
  trackAuthSuccess: jest.fn(),
  clearLastAuthProvider: jest.fn(),
  statusCodes: { SIGN_IN_CANCELLED: 'sign_in_cancelled' },
}));

// analyticsEvents는 firebase 네이티브 모듈을 물어 온다 — groupApi(requireActual)가 전이 import
// 하므로 목으로 막지 않으면 스위트가 로드 단계에서 죽는다(GroupSettingsScreen.test와 동일).
jest.mock('@/services/analyticsEvents', () => ({
  logGuestSocialLoginAttempted: jest.fn(),
  logLogout: jest.fn(),
  logWithdrawalConfirmed: jest.fn(),
}));

jest.mock('@/services/userApi', () => ({
  getSocialLinks: jest.fn(),
  unlinkSocialAccount: jest.fn(),
  withdraw: jest.fn(),
}));

// groupErrorCode는 실제 구현을 남긴다(§3-2 code 분기까지 검증).
jest.mock('@/services/groupApi', () => ({
  ...jest.requireActual('@/services/groupApi'),
  getMyGroups: jest.fn(),
}));

jest.mock('@/services/api', () => ({
  ...jest.requireActual('@/services/api'),
  triggerLogout: jest.fn(),
  triggerRelogin: jest.fn(),
}));

const mockGetSocialLinks = getSocialLinks as jest.MockedFunction<typeof getSocialLinks>;
const mockWithdraw = withdraw as jest.MockedFunction<typeof withdraw>;
const mockGetMyGroups = getMyGroups as jest.MockedFunction<typeof getMyGroups>;
const mockTriggerLogout = triggerLogout as jest.MockedFunction<typeof triggerLogout>;
const mockClearLastAuthProvider = clearLastAuthProvider as jest.MockedFunction<
  typeof clearLastAuthProvider
>;
const mockLogWithdrawalConfirmed = logWithdrawalConfirmed as jest.MockedFunction<
  typeof logWithdrawalConfirmed
>;
const mockUnlinkSocialAccount = unlinkSocialAccount as jest.MockedFunction<
  typeof unlinkSocialAccount
>;

// 서버 에러 바디({ code })를 실은 axios 에러 — 화면은 status가 아니라 code로 분기한다.
function axiosErrorWith(status: number, code: string): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { code },
  });
}

// 내 그룹 목록 항목 — over로 role·인원을 갈아 위임 대상 필터를 검증한다.
function group(over: Partial<GroupSummaryResponse>): GroupSummaryResponse {
  return {
    groupId: 'g',
    name: '그룹',
    code: null,
    currentMembers: 2,
    maxMembers: 5,
    role: 'OWNER',
    status: 'WAITING',
    ...over,
  };
}

// 탈퇴 확인 카드를 열고 '탈퇴할게요'까지 누른다(탈퇴 요청 발사).
async function pressWithdrawAndConfirm() {
  await render(<AccountScreen />);
  const row = await screen.findByText('회원 탈퇴');
  await act(async () => {
    fireEvent.press(row);
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('account.withdraw.confirm.primary'));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSocialLinks.mockResolvedValue([{ provider: 'KAKAO', linkedAt: '2026-01-01T00:00:00Z' }]);
  mockWithdraw.mockResolvedValue(undefined);
  mockGetMyGroups.mockResolvedValue([]);
  mockUnlinkSocialAccount.mockResolvedValue(undefined);
});

describe('회원 탈퇴 — 방장 블록(HOST_WITHDRAW)', () => {
  test('400 + HOST_WITHDRAW code면 위임 유도 카드 모달이 뜬다(소유·다중 멤버 그룹만 집계)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockWithdraw.mockRejectedValueOnce(axiosErrorWith(400, 'HOST_WITHDRAW'));
    mockGetMyGroups.mockResolvedValueOnce([
      group({ groupId: 'g-member', role: 'MEMBER', currentMembers: 4 }), // 내 소유 아님 — 제외
      group({ groupId: 'g-solo', role: 'OWNER', currentMembers: 1 }), // 1인 소유 — 서버가 자동 종료, 제외
      group({ groupId: 'g-target', name: '아침 6시 집중방', role: 'OWNER', currentMembers: 3 }),
    ]);

    await pressWithdrawAndConfirm();

    expect(await screen.findByTestId('account.withdraw.hostBlocked')).toBeOnTheScreen();
    expect(screen.getByText('먼저 방장을 넘겨주세요')).toBeOnTheScreen();
    expect(
      screen.getByText(
        '방장으로 있는 그룹이 1개 있어요.\n"아침 6시 집중방"의 방장을 넘기고 다시 탈퇴해 주세요.',
      ),
    ).toBeOnTheScreen();
    // 네이티브 Alert 강하가 없다(GROMO-1210) + 로그아웃으로 새지 않는다.
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockTriggerLogout).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test("'방장 넘기러 가기' → GroupOwnerTransfer(source: account)로 이동하고 모달이 닫힌다", async () => {
    mockWithdraw.mockRejectedValueOnce(axiosErrorWith(400, 'HOST_WITHDRAW'));
    mockGetMyGroups.mockResolvedValueOnce([
      group({ groupId: 'g-target', name: '아침 6시 집중방', role: 'OWNER', currentMembers: 3 }),
    ]);

    await pressWithdrawAndConfirm();
    await screen.findByTestId('account.withdraw.hostBlocked');

    await act(async () => {
      fireEvent.press(screen.getByTestId('account.withdraw.hostBlocked.primary'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('GroupOwnerTransfer', {
      groupId: 'g-target',
      source: 'account',
    });
    expect(screen.queryByTestId('account.withdraw.hostBlocked')).toBeNull();
  });

  test('위임 대상 그룹이 0개면 일반 안내 카드로 폴백한다', async () => {
    mockWithdraw.mockRejectedValueOnce(axiosErrorWith(400, 'HOST_WITHDRAW'));
    mockGetMyGroups.mockResolvedValueOnce([
      group({ groupId: 'g-solo', role: 'OWNER', currentMembers: 1 }), // 필터에 걸러져 0개
    ]);

    await pressWithdrawAndConfirm();

    expect(await screen.findByTestId('account.withdraw.blocked')).toBeOnTheScreen();
    expect(screen.getByText('탈퇴할 수 없어요')).toBeOnTheScreen();
    expect(screen.getByText('그룹 방장은 위임 후 탈퇴할 수 있어요.')).toBeOnTheScreen();
  });

  test('그룹 목록 조회 실패도 같은 일반 안내 카드로 폴백한다', async () => {
    mockWithdraw.mockRejectedValueOnce(axiosErrorWith(400, 'HOST_WITHDRAW'));
    mockGetMyGroups.mockRejectedValueOnce(new Error('network'));

    await pressWithdrawAndConfirm();

    expect(await screen.findByTestId('account.withdraw.blocked')).toBeOnTheScreen();
    expect(screen.getByText('그룹 방장은 위임 후 탈퇴할 수 있어요.')).toBeOnTheScreen();
  });
});

describe('회원 탈퇴 — 그 외 경로', () => {
  test('무관한 400(다른 code)은 방장 문구 없이 일반 오류 Alert로 떨어진다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockWithdraw.mockRejectedValueOnce(axiosErrorWith(400, 'SOMETHING_ELSE'));

    await pressWithdrawAndConfirm();

    expect(alertSpy).toHaveBeenCalledWith(
      '오류',
      '회원 탈퇴에 실패했어요. 잠시 후 다시 시도해 주세요.',
    );
    expect(screen.queryByText('먼저 방장을 넘겨주세요')).toBeNull();
    expect(screen.queryByTestId('account.withdraw.hostBlocked')).toBeNull();
    expect(mockGetMyGroups).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test('탈퇴 성공이면 provider 초기화 후 로그아웃까지 이어진다(무회귀)', async () => {
    mockWithdraw.mockResolvedValueOnce(undefined);

    await pressWithdrawAndConfirm();

    expect(mockLogWithdrawalConfirmed).toHaveBeenCalled();
    expect(mockClearLastAuthProvider).toHaveBeenCalled();
    expect(mockTriggerLogout).toHaveBeenCalled();
    expect(screen.queryByTestId('account.withdraw.confirm')).toBeNull();
  });
});

// GROMO-1251 — 확인이 필요한 2버튼 Alert를 같은 카드 모달 인스턴스로 이관했다(정책 D8).
// 문구는 기존 Alert 그대로이고, 실동작은 카드를 닫은 **뒤** 실행된다.
describe('로그아웃·연동 해제 확인 카드', () => {
  test('로그아웃은 확인 카드를 거쳐야 실행된다(취소하면 세션이 유지된다)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<AccountScreen />);
    await act(async () => {
      fireEvent.press(await screen.findByText('로그아웃'));
    });

    expect(screen.getByTestId('account.logout.confirm')).toBeOnTheScreen();
    expect(screen.getByText('로그아웃할까요?')).toBeOnTheScreen();
    // 카드가 떴을 뿐 아직 로그아웃되지 않았다.
    expect(mockTriggerLogout).not.toHaveBeenCalled();
    // 네이티브 Alert로 새지 않는다.
    expect(alertSpy).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByTestId('account.logout.confirm.secondary'));
    });
    expect(mockTriggerLogout).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(await screen.findByText('로그아웃'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('account.logout.confirm.primary'));
    });
    expect(mockTriggerLogout).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });

  test('연동 해제는 확인 카드의 해제를 눌러야 요청이 나간다', async () => {
    await render(<AccountScreen />);
    await act(async () => {
      fireEvent.press(await screen.findByText('카카오'));
    });

    expect(screen.getByTestId('account.unlink.confirm')).toBeOnTheScreen();
    expect(screen.getByText('카카오 연동 해제')).toBeOnTheScreen();
    expect(screen.getByText('카카오 연동을 해제할까요?')).toBeOnTheScreen();
    expect(mockUnlinkSocialAccount).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByTestId('account.unlink.confirm.primary'));
    });
    expect(mockUnlinkSocialAccount).toHaveBeenCalledWith('KAKAO');
  });

  // 실패는 재시도가 걸린 안내라 Alert로 남는다(정책 D8 「실패 중 사용자 조치가 필요한 것」).
  test('마지막 로그인 수단 해제(409)는 카드가 아니라 Alert로 안내한다', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockUnlinkSocialAccount.mockRejectedValueOnce(axiosErrorWith(409, 'LAST_SOCIAL_LINK'));
    await render(<AccountScreen />);
    await act(async () => {
      fireEvent.press(await screen.findByText('카카오'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('account.unlink.confirm.primary'));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      '해제할 수 없어요',
      '마지막 로그인 수단은 해제할 수 없어요.',
    );
    // 확인 카드는 요청 전에 이미 닫혔다 — Alert가 모달 위에 겹치지 않는다.
    expect(screen.queryByTestId('account.unlink.confirm')).toBeNull();
    alertSpy.mockRestore();
  });
});
