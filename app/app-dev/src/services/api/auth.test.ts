import assert from 'node:assert/strict';
import * as SecureStore from 'expo-secure-store';
import { checkSession, login, logout, me } from '@/services/api/auth';
import { ApiError, CLIENT_STALE_SESSION } from '@/services/api/client';
import {
  clearSession,
  getSession,
  restoreSession,
  saveSession,
  sessionGeneration,
} from '@/services/api/session';

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];

function stub(responses: { status: number; body?: unknown }[]) {
  let index = 0;
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status, body } = responses[Math.min(index++, responses.length - 1)];
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    } as unknown as Response;
  });
}

const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];

const remove = SecureStore.deleteItemAsync as jest.Mock;
const realRemove = remove.getMockImplementation() as (key: string) => Promise<void>;
const read = SecureStore.getItemAsync as jest.Mock;
const realRead = read.getMockImplementation() as (key: string) => Promise<string | null>;

beforeEach(async () => {
  remove.mockImplementation(realRemove);
  read.mockImplementation(realRead);
  calls.length = 0;
  await clearSession();
});

test('login — 시도 id 를 헤더로 보내고 토큰을 보안 저장소에 넣는다', async () => {
  stub([
    {
      status: 201,
      body: {
        data: { accessToken: 'AT', refreshToken: 'RT', userId: 'u1', onboardingComplete: false },
      },
    },
  ]);
  const before = sessionGeneration();

  const result = await login('apple', 'apple-jwt', '2026-09', { attemptId: 'attempt' });

  assert.equal(result.onboardingComplete, false);
  assert.equal(calls[0].url.endsWith('/auth/sessions'), true);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(header(calls[0], 'X-Login-Attempt-Id'), 'attempt');
  // 최초 로그인엔 우리 AT 가 없다. 폐기된 AT 를 실으면 서버가 401 로 끊는다.
  assert.equal(header(calls[0], 'Authorization'), undefined);
  // 자격 종류는 제공자가 정한다 — 어긋나면 서버가 422 다(SocialCredential.supportedKind).
  assert.deepEqual(JSON.parse(calls[0].init.body as string), {
    provider: 'apple',
    credential: { type: 'id_token', value: 'apple-jwt' },
    termsVersion: '2026-09',
  });

  assert.deepEqual(getSession(), { accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  // 인증 세션이 «교체»됐으므로 세대가 오른다.
  assert.equal(sessionGeneration(), before + 1);
  assert.deepEqual(await restoreSession(), { accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('login 실패는 저장소를 건드리지 않는다', async () => {
  stub([
    {
      status: 401,
      body: {
        error: {
          code: 'APPLE_TOKEN',
          message: '애플 로그인 자격이 유효하지 않습니다.',
          field: 'provider',
          retryable: false,
        },
        requestId: 'req-1',
      },
    },
  ]);
  const error = await login('apple', 'x', '2026-09').catch((e) => e);
  assert.equal(error.code, 'APPLE_TOKEN');
  assert.equal(getSession(), null);
});

test('kakao 는 access_token, 게스트 승격·계정 전환은 AT 를 함께 보낸다', async () => {
  await saveSession({ accessToken: 'GUEST_AT', refreshToken: 'GUEST_RT', userId: 'g1' });
  stub([
    {
      status: 201,
      body: {
        data: { accessToken: 'AT', refreshToken: 'RT', userId: 'g1', onboardingComplete: true },
      },
    },
  ]);

  await login('kakao', 'kakao-token', '2026-09', { attachCurrentSession: true });

  assert.equal(header(calls[0], 'Authorization'), 'Bearer GUEST_AT');
  assert.deepEqual(JSON.parse(calls[0].init.body as string).credential, {
    type: 'access_token',
    value: 'kakao-token',
  });
});

const session = (prefix: string, userId: string) => ({
  status: 201,
  body: {
    data: {
      accessToken: `${prefix}_AT`,
      refreshToken: `${prefix}_RT`,
      userId,
      onboardingComplete: true,
    },
  },
});

test('계정 전환 — 새 세션을 커밋한 «뒤에» 이전 세션 RT 를 폐기한다', async () => {
  await saveSession({ accessToken: 'A_AT', refreshToken: 'A_RT', userId: 'u1' });
  stub([session('B', 'u2'), { status: 200, body: { data: { revoked: true } } }]);

  await login('google', 'google-jwt', '2026-09', { attachCurrentSession: true });

  // 새 세션이 먼저 확정된다 — 폐기 결과가 이 저장을 되돌리지 않는다.
  assert.deepEqual(getSession(), { accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'u2' });
  assert.equal(calls[1].init.method, 'DELETE');
  assert.equal(calls[1].url.endsWith('/auth/sessions/current'), true);
  // 폐기 대상은 **이전** 세션이다. 새 RT 를 보내면 방금 채택한 세션이 끊긴다.
  assert.equal(header(calls[1], 'X-Refresh-Token'), 'A_RT');
  assert.equal(header(calls[1], 'Authorization'), undefined);
});

test('같은 사용자 s1→s2 재로그인도 전환이다 — 사용자 UUID 로 판정하지 않는다', async () => {
  await saveSession({ accessToken: 'S1_AT', refreshToken: 'S1_RT', userId: 'u1' });
  stub([session('S2', 'u1'), { status: 200, body: { data: { revoked: true } } }]);

  await login('apple', 'apple-jwt', '2026-09');

  assert.equal(header(calls[1], 'X-Refresh-Token'), 'S1_RT');
});

test('같은 attemptId 재생으로 돌아온 «같은» 세션은 폐기하지 않는다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub([
    {
      status: 201,
      body: {
        data: { accessToken: 'AT', refreshToken: 'RT', userId: 'u1', onboardingComplete: true },
      },
    },
  ]);

  await login('apple', 'apple-jwt', '2026-09', { attemptId: 'same', attachCurrentSession: true });

  // 방금 채택한 세션의 RT 를 폐기하면 스스로를 끊는다.
  assert.equal(calls.length, 1);
});

test('이전 세션 폐기가 실패해도 새 세션은 그대로다 (전역 로그아웃 금지)', async () => {
  await saveSession({ accessToken: 'A_AT', refreshToken: 'A_RT', userId: 'u1' });
  stub([session('B', 'u2'), { status: 500, body: envelope('INTERNAL_ERROR', '실패했습니다.') }]);

  await login('kakao', 'kakao-token', '2026-09', { attachCurrentSession: true });

  assert.deepEqual(getSession(), { accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'u2' });
});

test('응답 «뒤» 저장 전에 로그아웃이 끝나면 늦은 저장이 세션을 되살리지 않는다', async () => {
  await saveSession({ accessToken: 'OLD_AT', refreshToken: 'OLD_RT', userId: 'u1' });
  stub([session('NEW', 'u1'), { status: 200, body: { data: { revoked: true } } }]);

  // 「로그아웃 → 늦은 로그인 저장」 순서를 재현한다. 복구는 세대를 올리지 않으므로 줄만 막는다.
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  read.mockImplementation(async (key: string) => {
    await gate;
    return realRead(key);
  });
  const restoring = restoreSession();

  const loggingOut = logout(); // clearSession 이 줄에 선다(세대는 아직 그대로).
  const loggingIn = login('apple', 'apple-jwt', '2026-09'); // 응답은 그 세대를 통과한다.
  // 마이크로태스크가 모두 빠진 뒤 — 즉 로그인 응답이 돌아와 저장이 줄 맨 뒤에 선 뒤 — 줄을 연다.
  setTimeout(open, 0);

  const error = await loggingIn.then(
    () => null,
    (e: ApiError) => e,
  );
  await restoring;
  // 이 테스트의 관심사는 로그인 저장이다 — 로그아웃의 서버 폐기 결과는 보지 않는다.
  await loggingOut.catch(() => {});

  // 늦은 저장은 버려진다. 서버 세션이 남지 않게 방금 받은 RT 는 폐기한다.
  assert.equal(error?.code, CLIENT_STALE_SESSION);
  assert.equal(getSession(), null);
  assert.equal(
    calls.some((c) => header(c, 'X-Refresh-Token') === 'NEW_RT'),
    true,
  );
  assert.equal(await restoreSession(), null);
});

test('로그아웃은 «정리 시점»의 세션을 폐기한다 — 줄 앞의 로그인이 공개한 세션을 남기지 않는다', async () => {
  await saveSession({ accessToken: 'OLD_AT', refreshToken: 'OLD_RT', userId: 'u1' });
  stub([session('NEW', 'u1'), { status: 200, body: { data: { revoked: true } } }]);

  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  read.mockImplementation(async (key: string) => {
    await gate;
    return realRead(key);
  });
  const restoring = restoreSession();

  // 이번엔 로그인 저장이 줄 «앞», 로그아웃 정리가 그 뒤다.
  const loggingIn = login('apple', 'apple-jwt', '2026-09');
  let loggingOut!: Promise<void>;
  setTimeout(() => {
    loggingOut = logout();
    open();
  }, 0);

  await loggingIn;
  await restoring;
  await loggingOut.catch(() => {});

  assert.equal(getSession(), null);
  // 로그아웃 «시작» 시점에 읽은 OLD_RT 만 보내면 방금 공개된 NEW 세션이 서버에 그대로 남는다.
  assert.equal(
    calls.some((c) => header(c, 'X-Refresh-Token') === 'NEW_RT'),
    true,
  );
});

test('logout — RT 만 싣는다. 만료 AT 를 동봉하면 401 이라 서버 세션이 남는다', async () => {
  await saveSession({ accessToken: 'EXPIRED_AT', refreshToken: 'RT', userId: 'u1' });
  stub([{ status: 200, body: { data: { revoked: true } } }]);

  await logout();

  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].url.endsWith('/auth/sessions/current'), true);
  assert.equal(header(calls[0], 'X-Refresh-Token'), 'RT');
  assert.equal(header(calls[0], 'Authorization'), undefined);
});

test('logout — 서버를 부르기 «전에» 로컬 세션을 지운다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  let sessionAtRequestTime: unknown = 'not-called';
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    // 느린 네트워크에서 여기서 앱이 종료돼도 토큰이 남아 있으면 안 된다.
    sessionAtRequestTime = getSession();
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ data: { revoked: true } }),
    } as unknown as Response;
  });

  await logout();

  assert.equal(sessionAtRequestTime, null);
  assert.equal(await restoreSession(), null);
});

test('logout — 서버 호출이 실패해도 로컬 세션은 이미 비어 있다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub([
    {
      status: 500,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: '요청을 처리할 수 없습니다.',
          field: null,
          retryable: false,
        },
        requestId: 'req-2',
      },
    },
  ]);

  await logout().catch(() => {});

  assert.equal(getSession(), null);
  assert.equal(await restoreSession(), null);
});

test('logout — 로컬 삭제가 실패해도 서버 폐기는 보낸다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  remove.mockImplementation(async (key: string) => {
    if (key === 'gromo.sessionBundle') throw new Error('키체인 삭제 실패');
    return realRemove(key);
  });
  stub([{ status: 200, body: { data: { revoked: true } } }]);

  await logout().catch(() => {});

  remove.mockImplementation(realRemove);
  // 삭제 실패로 서버 호출을 건너뛰면 서버 세션이 그대로 남는다.
  assert.equal(calls.length, 1);
  assert.equal(header(calls[0], 'X-Refresh-Token'), 'RT');
  // 마커 삭제는 실패했지만 값이 지워져 되살아나지 않는다.
  assert.equal(await restoreSession(), null);
});

const envelope = (code: string, message: string) => ({
  error: { code, message, field: null, retryable: false },
  requestId: 'req-x',
});

test('checkSession — 정상이면 계정을 준다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub([
    {
      status: 200,
      body: {
        data: {
          id: 'u1',
          name: '수빈',
          catColor: 'black',
          linkedProviders: ['apple'],
          onboardingComplete: true,
        },
      },
    },
  ]);
  const check = await checkSession();
  assert.equal(check.status, 'active');
  assert.equal(check.status === 'active' && check.account.name, '수빈');
});

test('checkSession — 404 USER_NOT_FOUND 는 거절이다 (다른 기기에서 탈퇴)', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub([{ status: 404, body: envelope('USER_NOT_FOUND', '사용자를 찾을 수 없습니다.') }]);

  const check = await checkSession();

  // 401 이 아니라 client 가 세션을 지우지 않는다 — 여기서 지워야 탈퇴 계정으로 홈에 안 들어간다.
  assert.equal(check.status, 'rejected');
  assert.equal(getSession(), null);
  assert.equal(await restoreSession(), null);
});

test('checkSession — 키체인 삭제가 실패해도 판정은 「거절」이다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub([{ status: 404, body: envelope('USER_NOT_FOUND', '사용자를 찾을 수 없습니다.') }]);
  remove.mockImplementation(async () => {
    throw new Error('키체인 삭제 실패');
  });

  // 던지면 App 복구가 판정을 잃고 저장본대로 탈퇴한 계정의 홈에 들어간다.
  assert.equal((await checkSession()).status, 'rejected');
  assert.equal(getSession(), null);
});

test('checkSession — 401 도 거절이다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub([{ status: 401, body: envelope('UNAUTHORIZED', '인증이 필요합니다.') }]);
  assert.equal((await checkSession()).status, 'rejected');
});

test('checkSession — 네트워크 실패·502 는 「확인 실패」이고 세션을 지우지 않는다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  (global as any).fetch = jest.fn(async () => {
    throw new Error('Network request failed');
  });
  assert.equal((await checkSession()).status, 'unreachable');
  assert.notEqual(getSession(), null);

  // 502 UPSTREAM_AUTH_FAILED 는 LLD §5 가 「사용자 로그아웃 유도 금지」로 못 박았다.
  stub([{ status: 502, body: envelope('UPSTREAM_AUTH_FAILED', '요청을 처리할 수 없습니다.') }]);
  assert.equal((await checkSession()).status, 'unreachable');
  assert.notEqual(getSession(), null);
});

test('me — {data} 봉투를 벗긴 계정을 돌려준다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub([
    {
      status: 200,
      body: {
        data: {
          id: 'u1',
          name: null,
          catColor: null,
          linkedProviders: [],
          onboardingComplete: false,
        },
      },
    },
  ]);
  const account = await me();
  assert.equal(account.id, 'u1');
  assert.equal(account.onboardingComplete, false);
  assert.deepEqual(account.linkedProviders, []);
});
