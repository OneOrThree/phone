import assert from 'node:assert/strict';
import { Linking } from 'react-native';
import { applyLocalePref } from '@/i18n';
import { API_URL } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import {
  blockUser,
  getBlockedUsers,
  feedbackEmailUrl,
  openFeedbackMail,
  reportEmailUrl,
  openReportCenter,
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

test('단일 신고 메일은 수신 주소와 작성 안내만 포함하고 사용자 콘텐츠를 수집하지 않는다', async () => {
  applyLocalePref('ko');
  const url = reportEmailUrl();
  const decoded = decodeURIComponent(url);
  assert.ok(url.startsWith(`mailto:${REPORT_EMAIL_RECIPIENT}?`));
  assert.ok(decoded.includes('subject=[catus 신고] 신고센터'));
  assert.ok(decoded.includes('신고 내용:'));
  assert.ok(decoded.includes('상대 닉네임·섬 이름:'));
  assert.ok(!decoded.includes('[신고 대상 원문]'));
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await openReportCenter();
  assert.equal(open.mock.calls[0][0], url);
  assert.equal(calls.length, 0);
  open.mockRestore();
  applyLocalePref('system');
});

test('문의 메일은 신고와 같은 주소에 문의 말머리·앱 버전·기기 OS를 채운다', async () => {
  applyLocalePref('ko');
  const url = feedbackEmailUrl('2.0.1');
  const decoded = decodeURIComponent(url);
  assert.ok(url.startsWith(`mailto:${REPORT_EMAIL_RECIPIENT}?`));
  assert.ok(decoded.includes('subject=[catus 문의] 오류 제보·기능 제안'));
  assert.ok(decoded.includes('앱 버전: 2.0.1'));
  assert.match(decoded, /기기: (ios|android) \S+/);
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await openFeedbackMail('2.0.1');
  assert.equal(open.mock.calls[0][0], url);
  assert.equal(calls.length, 0);
  open.mockRestore();
  applyLocalePref('system');
});
