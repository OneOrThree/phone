import assert from 'node:assert/strict';
import { API_URL } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import {
  blockUser,
  getBlockedUsers,
  reportEmailUrl,
  REPORT_EMAIL_RECIPIENT,
  unblockUser,
} from '@/services/api/safety';

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
const USER = '11111111-2222-4333-8444-555555555555';

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

test('신고 입력을 운영 Gmail 수신 주소와 편집 가능한 mailto 본문으로 만든다', () => {
  const input = {
    targetType: 'LETTER' as const,
    targetId: USER,
    reason: 'HARASSMENT' as const,
    description: '설명',
    replyEmail: 'reply@example.com',
    blockStatus: 'COMPLETED' as const,
    evidenceText: '반가워, 잘 지내?',
  };

  const url = reportEmailUrl(input, '민지');
  assert.ok(url.startsWith(`mailto:${REPORT_EMAIL_RECIPIENT}?`));
  const decoded = decodeURIComponent(url);
  assert.ok(decoded.includes('subject=[Gromo 신고] 편지 민지'));
  assert.ok(decoded.includes('신고 사유: 욕설·괴롭힘'));
  assert.ok(decoded.includes('상세 설명: 설명'));
  assert.ok(decoded.includes('회신 받을 이메일: reply@example.com'));
  assert.ok(decoded.includes('앱에서 함께 차단: 완료'));
  assert.ok(decoded.includes('[신고 대상 원문]\n반가워, 잘 지내?\n[/신고 대상 원문]'));
  assert.equal(calls.length, 0);
});
