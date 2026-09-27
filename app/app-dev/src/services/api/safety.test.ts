import assert from 'node:assert/strict';
import { API_URL } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import { blockUser, getBlockedUsers, submitReport, unblockUser } from '@/services/api/safety';

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
const USER = '11111111-2222-4333-8444-555555555555';
const REQUEST = '66666666-7777-4888-8999-000000000000';

function stub(status: number, body?: unknown) {
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    } as unknown as Response;
  });
}

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

test('차단 목록·등록·해제 공개 계약을 그대로 호출한다', async () => {
  stub(200, { data: [{ id: USER, name: '상대' }] });
  assert.deepEqual(await getBlockedUsers(), [{ id: USER, name: '상대' }]);
  assert.equal(calls[0].url, `${API_URL}/blocks`);

  stub(200, { data: null });
  await blockUser(USER);
  assert.deepEqual(JSON.parse(calls[1].init.body as string), { blockedUserId: USER });

  await unblockUser(USER);
  assert.equal(calls[2].url, `${API_URL}/blocks/${USER}`);
  assert.equal(calls[2].init.method, 'DELETE');
});

test('신고는 선택적 동시 차단과 재시도 requestId를 Idempotency-Key로 보낸다', async () => {
  stub(201, { data: { caseId: 'GR-CASE', blocked: true } });
  const input = {
    targetType: 'LETTER' as const,
    targetId: USER,
    reason: 'HARASSMENT' as const,
    description: '설명',
    replyEmail: null,
    blockUser: true,
  };

  assert.deepEqual(await submitReport(input, REQUEST), { caseId: 'GR-CASE', blocked: true });
  assert.equal(calls[0].url, `${API_URL}/reports`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal((calls[0].init.headers as Record<string, string>)['Idempotency-Key'], REQUEST);
  assert.deepEqual(JSON.parse(calls[0].init.body as string), input);
});
