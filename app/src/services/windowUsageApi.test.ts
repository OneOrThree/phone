// windowUsageApi 계약 테스트 — method/path/바디를 잠근다(groupApi.test.ts와 같은 취지).
// 오타 하나가 런타임 404로만 드러나고 타입 검사에는 걸리지 않는다.
import { putWindowUsage } from './windowUsageApi';
import { api } from '@/services/api';

jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const mockApi = api as unknown as { put: jest.Mock };

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55';
const CHALLENGE_ID = 'c1';

test('PUT /{groupId}/challenges/{challengeId}/window-usage — 바디를 그대로 보낸다', async () => {
  mockApi.put.mockResolvedValue({ data: undefined });
  // 필드명은 LLD §2.1 계약 — usageDate·progressMinutes·measuredAt(N34 역전 판정 축).
  const body = {
    usageDate: '2026-08-02',
    progressMinutes: 45,
    measuredAt: '2026-08-02T04:00:00.000Z',
  };
  await putWindowUsage(GROUP_ID, CHALLENGE_ID, body);
  // 토큰을 넘기지 않으면 config 없이(=인터셉터가 저장 토큰을 붙이는 종전 동작) 나간다.
  expect(mockApi.put).toHaveBeenCalledWith(
    `/api/v1/groups/${GROUP_ID}/challenges/${CHALLENGE_ID}/window-usage`,
    body,
    undefined,
  );
});

// 계정 박제(codex 리뷰 P1) — 검증한 토큰을 직접 싣고 401 재발급 재시도를 끈다.
// 재발급 토큰은 **전환된 계정** 것일 수 있어, 재시도가 곧 남의 회차에 쓰는 일이 된다.
test('accessToken을 넘기면 그 토큰을 싣고 401 재발급 재시도를 끈다', async () => {
  mockApi.put.mockResolvedValue({ data: undefined });
  const body = {
    usageDate: '2026-08-02',
    progressMinutes: 45,
    measuredAt: '2026-08-02T04:00:00.000Z',
  };
  await putWindowUsage(GROUP_ID, CHALLENGE_ID, body, 'token-u1');
  expect(mockApi.put).toHaveBeenCalledWith(
    `/api/v1/groups/${GROUP_ID}/challenges/${CHALLENGE_ID}/window-usage`,
    body,
    { headers: { Authorization: 'Bearer token-u1' }, _noAuthRetry: true },
  );
});
