import { AxiosError, AxiosHeaders } from 'axios';
import { getAuthSessionGeneration, triggerLogout } from '@/services/api';
import { getGroupDetail, getMyGroups } from '@/services/groupApi';
import { getMyProfile } from '@/services/userApi';
import { resolveGroupRoomNotFound } from './groupRoomNotFound';
import type { GroupDetailResponse, GroupSummaryResponse } from '@/types/dto/group';
import type { UserProfileResponse } from '@/types/dto/user';

jest.mock('@/services/api', () => ({
  getAuthSessionGeneration: jest.fn(),
  triggerLogout: jest.fn(),
}));
jest.mock('@/services/groupApi', () => {
  const axios = jest.requireActual('axios').default as typeof import('axios').default;
  return {
    getGroupDetail: jest.fn(),
    getMyGroups: jest.fn(),
    groupErrorCode: (error: unknown) => {
      if (!axios.isAxiosError(error)) return null;
      return (error.response?.data as { code?: string } | undefined)?.code ?? null;
    },
  };
});
jest.mock('@/services/userApi', () => ({ getMyProfile: jest.fn() }));

const mockTriggerLogout = triggerLogout as jest.MockedFunction<typeof triggerLogout>;
const mockGetAuthSessionGeneration = getAuthSessionGeneration as jest.MockedFunction<
  typeof getAuthSessionGeneration
>;
const mockGetGroupDetail = getGroupDetail as jest.MockedFunction<typeof getGroupDetail>;
const mockGetMyGroups = getMyGroups as jest.MockedFunction<typeof getMyGroups>;
const mockGetMyProfile = getMyProfile as jest.MockedFunction<typeof getMyProfile>;

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const USER_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d99';
const DATE = '2026-08-10';

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

const profile = { id: USER_ID } as UserProfileResponse;
const detail = { id: GROUP_ID, name: '그룹' } as GroupDetailResponse;
const summary = { groupId: GROUP_ID, name: '그룹' } as GroupSummaryResponse;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAuthSessionGeneration.mockReturnValue(7);
  mockGetMyProfile.mockResolvedValue(profile);
});

test('활성 인증 뒤 최신 detail이 성공하면 방을 유지한다', async () => {
  mockGetGroupDetail.mockResolvedValue(detail);
  mockGetMyGroups.mockResolvedValue([summary]);

  await expect(
    resolveGroupRoomNotFound({ groupId: GROUP_ID, date: DATE, userId: USER_ID }),
  ).resolves.toEqual({ kind: 'detail', detail });
  expect(mockGetGroupDetail).toHaveBeenCalledWith(GROUP_ID, DATE);
});

// 신구 코드를 **병기**한다(GROMO-1247) — 서버가 유저 부재를 USER_NOT_FOUND로 나누면 /users/me도
// 그 코드로 답한다. NOT_FOUND만 보면 분리 직후부터 이 재확인이 세션 이상을 영영 못 알아채고
// 'retry'로만 수렴해(무한 재시도) 그룹방이 조용히 멈춘다. 반대로 브리지 기간엔 NOT_FOUND가 온다.
test.each([['NOT_FOUND'], ['USER_NOT_FOUND']])(
  '프로필 %s는 그룹 이탈이 아니라 공통 세션 복구로 넘긴다',
  async (code) => {
    mockGetMyProfile.mockRejectedValue(axiosErrorWith(404, code));

    await expect(
      resolveGroupRoomNotFound({ groupId: GROUP_ID, date: DATE, userId: USER_ID }),
    ).resolves.toEqual({ kind: 'session_recovery' });
    expect(mockTriggerLogout).toHaveBeenCalledWith(7);
    expect(mockGetGroupDetail).not.toHaveBeenCalled();
    expect(mockGetMyGroups).not.toHaveBeenCalled();
  },
);

test('프로필 재확인 실패·계정 불일치는 성공으로 추정하지 않는다', async () => {
  mockGetMyProfile.mockRejectedValueOnce(new Error('network'));
  await expect(
    resolveGroupRoomNotFound({ groupId: GROUP_ID, date: DATE, userId: USER_ID }),
  ).resolves.toEqual({ kind: 'retry' });

  mockGetMyProfile.mockResolvedValueOnce({ ...profile, id: 'different-user' });
  await expect(
    resolveGroupRoomNotFound({ groupId: GROUP_ID, date: DATE, userId: USER_ID }),
  ).resolves.toEqual({ kind: 'retry' });
  expect(mockTriggerLogout).not.toHaveBeenCalled();
});

test('최신 detail의 MEMBER_ONLY는 미소속 scope로 확정한다', async () => {
  mockGetGroupDetail.mockRejectedValue(axiosErrorWith(403, 'MEMBER_ONLY'));
  mockGetMyGroups.mockResolvedValue([summary]);

  await expect(
    resolveGroupRoomNotFound({ groupId: GROUP_ID, date: DATE, userId: USER_ID }),
  ).resolves.toEqual({ kind: 'membership_absent' });
});

test('성공한 전체 목록에서 target이 사라졌을 때만 부재로 수렴한다', async () => {
  mockGetGroupDetail.mockRejectedValue(axiosErrorWith(404, 'NOT_FOUND'));
  mockGetMyGroups.mockResolvedValue([]);

  await expect(
    resolveGroupRoomNotFound({ groupId: GROUP_ID, date: DATE, userId: USER_ID }),
  ).resolves.toEqual({ kind: 'membership_absent' });
});

test('목록에 target이 남거나 목록 재확인이 실패하면 안전 retry다', async () => {
  mockGetGroupDetail.mockRejectedValue(axiosErrorWith(404, 'NOT_FOUND'));
  mockGetMyGroups.mockResolvedValueOnce([summary]);

  await expect(
    resolveGroupRoomNotFound({ groupId: GROUP_ID, date: DATE, userId: USER_ID }),
  ).resolves.toEqual({ kind: 'retry' });

  mockGetMyGroups.mockRejectedValueOnce(new Error('network'));
  await expect(
    resolveGroupRoomNotFound({ groupId: GROUP_ID, date: DATE, userId: USER_ID }),
  ).resolves.toEqual({ kind: 'retry' });
});
