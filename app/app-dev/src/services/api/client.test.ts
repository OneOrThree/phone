import assert from 'node:assert/strict';
import {
  API_URL,
  ApiError,
  CLIENT_NETWORK_ERROR,
  CLIENT_STALE_SESSION,
  CLIENT_TIMEOUT,
  DEV_API_URL,
  LOCAL_WEB_API_URL,
  REQUEST_TIMEOUT_MS,
  request,
  resolveApiUrl,
  uuid,
} from '@/services/api/client';
import * as SecureStore from 'expo-secure-store';
import {
  clearSession,
  getSession,
  saveSession,
  sessionGeneration,
  setSessionLostHandler,
} from '@/services/api/session';

type Call = { url: string; init: RequestInit };

const calls: Call[] = [];

/** 반드시 거절돼야 하는 요청. 성공하면 그 자체가 실패다. */
const failed = (p: Promise<unknown>): Promise<ApiError> =>
  p.then(
    () => {
      throw new Error('요청이 거절돼야 한다');
    },
    (e: unknown) => e as ApiError,
  );

function stub(status: number, body: unknown, responseHeaders: Record<string, string> = {}) {
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => responseHeaders[name] ?? null },
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    } as unknown as Response;
  });
}

const remove = SecureStore.deleteItemAsync as jest.Mock;
const realRemove = remove.getMockImplementation() as (key: string) => Promise<void>;

beforeEach(async () => {
  remove.mockImplementation(realRemove);
  calls.length = 0;
  await clearSession();
});

test('resolveApiUrl — 웹 개발은 로컬, 웹 배포는 dev, 네이티브는 주입값', () => {
  assert.equal(resolveApiUrl('web', 'https://prod.example', true), LOCAL_WEB_API_URL);
  assert.equal(resolveApiUrl('web', 'https://prod.example', false), DEV_API_URL);
  assert.equal(resolveApiUrl('ios', 'https://injected.example', true), 'https://injected.example');
  assert.equal(resolveApiUrl('ios', undefined, true), DEV_API_URL);
});

test('uuid — 하이픈 포함 36자 정규 표기 (서버가 길이·왕복을 검사한다)', () => {
  const value = uuid();
  assert.equal(value.length, 36);
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(uuid(), uuid());
});

test('성공 응답은 {data} 봉투를 벗겨 돌려준다', async () => {
  stub(200, { data: { id: 'u1', onboardingComplete: true } });
  const account = await request<{ id: string }>('/me');
  assert.equal(account.id, 'u1');
  assert.equal(calls[0].url, `${API_URL}/me`);
});

test('봉투 없는 응답은 본문 그대로 돌려준다', async () => {
  stub(200, { plain: true });
  assert.deepEqual(await request('/health'), { plain: true });
});

test('저장된 토큰이 Bearer 로 실린다 · 명시 헤더가 우선한다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub(200, { data: null });
  await request('/me');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer AT');

  await request('/me', { headers: { Authorization: 'Bearer OTHER' } });
  assert.equal((calls[1].init.headers as Record<string, string>).Authorization, 'Bearer OTHER');

  await request('/auth/sessions', { method: 'POST', auth: false, body: {} });
  assert.equal((calls[2].init.headers as Record<string, string>).Authorization, undefined);
});

test('명령 키는 Idempotency-Key 헤더로 나간다', async () => {
  stub(200, { data: null });
  await request('/me', { method: 'PATCH', body: { name: '가' }, idempotencyKey: 'key-1' });
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers['Idempotency-Key'], 'key-1');
  assert.equal(headers['Content-Type'], 'application/json');
});

test('신규 공개 봉투 {error:{...},requestId} 를 읽는다 — 최상위만 보면 코드가 뭉개진다', async () => {
  stub(409, {
    error: {
      code: 'NICKNAME_DUPLICATE',
      message: '이미 사용 중인 닉네임입니다.',
      field: 'name',
      retryable: false,
    },
    requestId: 'req-1',
  });
  const error = await failed(request('/me', { method: 'PATCH', body: {} }));
  assert.ok(error instanceof ApiError);
  assert.equal(error.code, 'NICKNAME_DUPLICATE');
  assert.equal(error.message, '이미 사용 중인 닉네임입니다.');
  assert.equal(error.status, 409);
  assert.equal(error.field, 'name');
  assert.equal(error.retryable, false);
  assert.equal(error.requestId, 'req-1');
});

test('retryable 과 Retry-After(초)를 싣는다', async () => {
  stub(
    409,
    {
      error: {
        code: 'REQUEST_IN_PROGRESS',
        message: '요청을 처리 중입니다.',
        field: null,
        retryable: true,
      },
      requestId: 'req-2',
    },
    { 'Retry-After': '1' },
  );
  const error = await failed(request('/auth/sessions', { method: 'POST', auth: false, body: {} }));
  assert.equal(error.code, 'REQUEST_IN_PROGRESS');
  assert.equal(error.retryable, true);
  assert.equal(error.retryAfterMs, 1000);
});

test('legacy 최상위 {code,message} 봉투도 읽는다 (비봉투 경로)', async () => {
  stub(401, { code: 'UNAUTHORIZED', message: '인증이 필요합니다.' });
  const error = await failed(request('/l/match', { auth: false }));
  assert.equal(error.code, 'UNAUTHORIZED');
  assert.equal(error.message, '인증이 필요합니다.');
});

test('code 없는 실패는 HTTP_<status> 로 떨어진다 — 분기가 조용히 빠지지 않게', async () => {
  stub(502, undefined);
  const error = await failed(request('/me'));
  assert.equal(error.code, 'HTTP_502');
  assert.equal(error.status, 502);
  assert.equal(error.retryable, false);
});

test('401 은 세션을 지우고 세션 상실을 알린다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  const before = sessionGeneration();
  stub(401, {
    error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다.', field: null, retryable: false },
    requestId: 'req-3',
  });

  const error = await failed(request('/me'));
  assert.equal(error.code, 'UNAUTHORIZED');
  // 갱신 경로가 없으므로 답은 재로그인뿐이다 — 세션이 비고 세대가 올라간다.
  assert.equal(sessionGeneration(), before + 1);
});

test('401 — 키체인 삭제가 실패해도 세션 상실을 알리고 원래의 401 을 던진다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub(401, {
    error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다.', field: null, retryable: false },
    requestId: 'req-7',
  });
  remove.mockImplementation(async () => {
    throw new Error('키체인 삭제 실패');
  });
  let lost = 0;
  setSessionLostHandler(() => {
    lost += 1;
  });

  const error = await failed(request('/me'));

  // 알림을 건너뛰면 화면이 보호 화면에 남고, 저장소 예외가 401 을 덮으면 checkSession 이
  // 그것을 「확인 실패」로 오인해 로컬 로그인 상태를 되살린다.
  assert.equal(lost, 1);
  assert.equal(error.code, 'UNAUTHORIZED');
  assert.equal(error.status, 401);
  assert.equal(getSession(), null);
  setSessionLostHandler(null);
});

test('로그인(무세션) 401 은 세션 정리를 유발하지 않는다', async () => {
  const before = sessionGeneration();
  stub(401, {
    error: {
      code: 'APPLE_TOKEN',
      message: '애플 로그인 자격이 유효하지 않습니다.',
      field: 'provider',
      retryable: false,
    },
    requestId: 'req-4',
  });
  await failed(request('/auth/sessions', { method: 'POST', auth: false, body: {} }));
  assert.equal(sessionGeneration(), before);
});

test('제공자 자격 거절 401 은 기존 세션을 지우지 않는다 — 실패한 전환이 로그인까지 끊지 않게', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  const before = sessionGeneration();
  stub(401, {
    error: {
      code: 'APPLE_TOKEN',
      message: '애플 로그인 자격이 유효하지 않습니다.',
      field: 'provider',
      retryable: false,
    },
    requestId: 'req-5',
  });

  // 계정 전환 로그인은 현재 AT 를 함께 보낸다(attachCurrentSession) — Bearer 는 실리지만
  // 401 의 원인은 애플 자격이지 우리 AT 가 아니다(LLD §5 의 `*_TOKEN` 코드).
  const error = await failed(request('/auth/sessions', { method: 'POST', body: {} }));

  assert.equal(error.code, 'APPLE_TOKEN');
  assert.equal(sessionGeneration(), before);
  assert.notEqual(getSession(), null);
});

test('Bearer 를 싣지 않은 요청의 401 은 세션 상실이 아니다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  const before = sessionGeneration();
  stub(401, {
    error: { code: 'REFRESH_TOKEN', message: 'RT 가 유효하지 않습니다.', field: null },
    requestId: 'req-6',
  });

  await failed(
    request('/auth/sessions/current', {
      method: 'DELETE',
      auth: false,
      headers: { 'X-Refresh-Token': 'OLD_RT' },
    }),
  );

  assert.equal(sessionGeneration(), before);
  assert.notEqual(getSession(), null);
});

test('응답 도중 세션이 교체되면 결과를 적용하지 않는다', async () => {
  (global as any).fetch = jest.fn(async () => {
    // 응답이 돌아오기 전에 재로그인이 끝난 상황.
    await saveSession({ accessToken: 'NEW', refreshToken: 'NEW', userId: 'u2' });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { id: 'u1' } }),
    } as unknown as Response;
  });
  const error = await failed(request('/me'));
  assert.equal(error.code, CLIENT_STALE_SESSION);
});

test('네트워크 실패는 CLIENT_NETWORK_ERROR 다', async () => {
  (global as any).fetch = jest.fn(async () => {
    throw new Error('Network request failed');
  });
  const error = await failed(request('/me'));
  assert.equal(error.code, CLIENT_NETWORK_ERROR);
});

test('무응답은 15초에 끊고 CLIENT_TIMEOUT 이다 — 스피너가 멈추지 않는 것을 막는다', async () => {
  (global as any).fetch = jest.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      }),
  );
  jest.useFakeTimers();
  const pending = failed(request('/me'));
  jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
  const error = await pending;
  jest.useRealTimers();
  assert.equal(error.code, CLIENT_TIMEOUT);
});

test('헤더만 오고 본문이 멈춰도 같은 타임아웃에 끊는다', async () => {
  // fetch 는 헤더 수신으로 완료될 수 있다 — 본문 읽기가 타이머 밖에 있으면 영구 대기한다.
  (global as any).fetch = jest.fn(async (_url: string, init: RequestInit) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () =>
      new Promise<string>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      }),
  }));
  jest.useFakeTimers();
  const pending = failed(request('/me'));
  await Promise.resolve();
  jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
  const error = await pending;
  jest.useRealTimers();
  assert.equal(error.code, CLIENT_TIMEOUT);
});
