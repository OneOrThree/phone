/**
 * 모든 백엔드 호출이 지나는 한 곳. 도메인 모듈(`auth.ts` 등)은 여기 `request()` 만 쓴다.
 *
 * 공개 표면은 business-api 의 **무접두** 경로다(`/auth/sessions`·`/me`·`/islands/...`).
 * `/api/v1/*` 는 레거시 1.x 표면이므로 2.0 앱은 쓰지 않는다.
 *
 * 계약 두 가지를 여기서 벗긴다:
 *  - 성공: `{ "data": ... }` 봉투 → `data` 만 돌려준다(`ApiResponseAdvice`).
 *  - 실패: **`{ "error": { code, message, field, retryable }, "requestId": "..." }`**
 *    (계정 LLD §1 「오류」·§5 · `ApiErrorResponse`). **`code` 문자열이 계약이다** — 화면은 code 로
 *    분기하고 message 는 그대로 띄울 수 있다.
 *    ⚠️ `docs/conventions/error-contract.md` 의 최상위 `{code,message}` 는 **data-api·legacy 형태**다.
 *    무접두 공개 경로는 위의 중첩 형태이고, 비봉투 경로(`/l/match` 등)만 옛 형태로 나온다 —
 *    두 형태를 모두 읽되 신규 형태를 먼저 본다. 잘못 읽으면 `APPLE_TOKEN`·`REFRESH_TOKEN` 같은
 *    코드가 `HTTP_401` 로 뭉개져 화면 분기가 통째로 빠진다.
 */
import { Platform } from 'react-native';
import {
  clearRejectedSession,
  getAccessToken,
  getSession,
  notifySessionLost,
  sessionGeneration,
} from './session';

export const DEV_API_URL = 'https://oneorthree.dev.mooo.com';
export const LOCAL_WEB_API_URL = 'http://localhost:8080';

/**
 * 레거시 `apiBaseUrl.ts` 이식. 웹 개발 서버는 로컬 백엔드를, 웹 배포 빌드는 팀 dev 백엔드를 쓴다 —
 * 두 경로 모두 `EXPO_PUBLIC_API_URL` 에 운영 주소가 주입돼도 운영 데이터에 닿지 않는다.
 */
export function resolveApiUrl(
  platform: string,
  configuredUrl: string | undefined,
  development: boolean,
): string {
  if (platform === 'web') return development ? LOCAL_WEB_API_URL : DEV_API_URL;
  return configuredUrl ?? DEV_API_URL;
}

export const API_URL: string = resolveApiUrl(Platform.OS, process.env.EXPO_PUBLIC_API_URL, __DEV__);

/**
 * 백엔드 무응답 시 무한 로딩 방지(레거시 주석: "로그인 스피너가 멈추지 않는 문제").
 * 서버 쪽 합성 deadline 보다 넉넉해야 서버가 준 오류를 앱이 먼저 잘라먹지 않는다.
 */
export const REQUEST_TIMEOUT_MS = 15000;

/** 서버가 준 code 가 아니라 앱이 만든 code. 화면 분기에서 서버 코드와 섞이지 않게 접두어를 둔다. */
export const CLIENT_TIMEOUT = 'CLIENT_TIMEOUT';
export const CLIENT_NETWORK_ERROR = 'CLIENT_NETWORK_ERROR';
/** 응답이 도착했을 때 인증 세션이 이미 교체됐다 — 결과를 적용하면 안 된다. */
export const CLIENT_STALE_SESSION = 'CLIENT_STALE_SESSION';

export interface ApiErrorDetail {
  /** 서버가 지목한 요청 필드(`name`·`catColor`·`provider`·헤더 이름). 없으면 null. */
  field?: string | null;
  /** 서버가 「같은 요청을 다시 보내도 된다」고 표시한 실패(LLD §5). */
  retryable?: boolean;
  /** 서버 요청 추적 ID — 문의·로그 대조용. */
  requestId?: string;
  /** `Retry-After` 헤더(초)를 ms 로 환산한 값. legacy 봉투의 `retryAfterMs` 도 여기로 들어온다. */
  retryAfterMs?: number;
}

export class ApiError extends Error {
  readonly field: string | null;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly retryAfterMs?: number;

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    detail: ApiErrorDetail = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.field = detail.field ?? null;
    this.retryable = detail.retryable ?? false;
    this.requestId = detail.requestId;
    this.retryAfterMs = detail.retryAfterMs;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** 추가 헤더. `Authorization` 을 직접 넣으면 저장된 토큰 대신 그 값을 쓴다. */
  headers?: Record<string, string>;
  /** 명령성 요청(POST·PATCH·DELETE)의 `Idempotency-Key`. 재시도는 **같은 값**으로 보내야 한다. */
  idempotencyKey?: string;
  /** false 면 저장된 access token 을 싣지 않는다(최초 로그인). */
  auth?: boolean;
  /** 호출부가 잡아 둔 세션 세대. 생략하면 요청 시작 시점의 값. */
  generation?: number;
}

/**
 * 표준 UUID v4 문자열. `X-Login-Attempt-Id`·`Idempotency-Key` 는 하이픈 포함 36자만 받는다
 * (`model.ts` 의 `uuid()` 는 이 형식이 아니라 여기 쓸 수 없다).
 *
 * ponytail: Math.random 기반이다 — 멱등 키는 비밀이 아니라 충돌 회피용이고, 서버가 키와 자격
 * digest 를 함께 보므로 추측해도 얻는 것이 없다. 암호학적 난수가 필요해지면 expo-crypto 로 바꾼다.
 */
export function uuid(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const block = (length: number) => Array.from({ length }, hex).join('');
  const variant = '89ab'[Math.floor(Math.random() * 4)];
  return `${block(8)}-${block(4)}-4${block(3)}-${variant}${block(3)}-${block(12)}`;
}

/** `Retry-After`(초) → ms. 날짜 형식은 쓰지 않으므로 정수만 본다. */
function retryAfterMsOf(response: Response, legacy: unknown): number | undefined {
  const header = response.headers?.get?.('Retry-After');
  const seconds = header === null || header === undefined ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return typeof legacy === 'number' ? legacy : undefined;
}

function errorFrom(response: Response, payload: unknown): ApiError {
  const body = (payload ?? {}) as {
    error?: { code?: unknown; message?: unknown; field?: unknown; retryable?: unknown };
    requestId?: unknown;
    code?: unknown;
    message?: unknown;
    retryAfterMs?: unknown;
  };
  // 신규 공개 봉투가 먼저다. 없으면 legacy 최상위 {code,message}.
  const nested = body.error && typeof body.error === 'object' ? body.error : undefined;
  const rawCode = nested?.code ?? body.code;
  const rawMessage = nested?.message ?? body.message;
  return new ApiError(
    typeof rawCode === 'string' ? rawCode : `HTTP_${response.status}`,
    typeof rawMessage === 'string'
      ? rawMessage
      : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
    response.status,
    {
      field: typeof nested?.field === 'string' ? nested.field : null,
      retryable: nested?.retryable === true,
      requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
      retryAfterMs: retryAfterMsOf(response, body.retryAfterMs),
    },
  );
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, idempotencyKey, auth = true } = options;
  // 요청이 «시작된» 세대를 잡아 둔다. 응답 시점에 전역을 새로 읽으면 그 사이 바뀐 세션을 못 본다.
  const generation = options.generation ?? sessionGeneration();

  const sent: Record<string, string> = { Accept: 'application/json', ...headers };
  if (body !== undefined) sent['Content-Type'] = 'application/json';
  if (idempotencyKey) sent['Idempotency-Key'] = idempotencyKey;
  // 「저장된 세션의 AT 로 보냈는가」 — 401 을 세션 상실로 읽어도 되는지의 전제다.
  // 호출부가 직접 넣은 Authorization 이나 `auth: false` 요청은 이 세션을 쓴 것이 아니다.
  let sentSessionToken = false;
  if (auth && !sent.Authorization) {
    const token = getAccessToken();
    if (token) {
      sent.Authorization = `Bearer ${token}`;
      sentSessionToken = true;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: sent,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    // ⚠️ 본문 읽기도 **같은 타임아웃 안**이다. fetch 는 헤더 수신만으로 끝날 수 있어서, 여기서
    // 타이머를 먼저 끄면 헤더만 보내고 본문을 멈춘 서버에 제한 없이 매달린다.
    text = await response.text();
  } catch {
    const aborted = controller.signal.aborted;
    throw new ApiError(
      aborted ? CLIENT_TIMEOUT : CLIENT_NETWORK_ERROR,
      aborted
        ? '서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.'
        : '네트워크에 연결할 수 없어요. 연결을 확인해 주세요.',
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  // 204·빈 본문도 정상이다. JSON 이 아니면 null 로 두고 상태로만 판단한다.
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = errorFrom(response, payload);
    if (
      response.status === 401 &&
      // 이 요청이 실제로 저장된 세션의 Bearer 를 썼을 때만 「그 세션이 무효화됐다」로 읽는다.
      sentSessionToken &&
      // 제공자·RT 전용 코드(`*_TOKEN` — LLD §5 :928~933)는 **우리 AT 검증 실패가 아니다**.
      // `POST /auth/sessions` 가 애플 자격을 거절한 401 로 멀쩡한 기존 세션을 지우면
      // 실패한 계정 전환이 정상 로그인까지 끊는다. AT 무효는 `UNAUTHORIZED` 로 온다.
      !error.code.endsWith('_TOKEN') &&
      getSession() &&
      generation === sessionGeneration()
    ) {
      // 갱신 경로가 없다(2.0 공개 표면에 refresh 엔드포인트 미존재) — 401 의 답은 재로그인뿐이다.
      // 세대가 이미 바뀐 응답으로는 정리하지 않는다: 옛 계정의 늦은 401 이 새 세션을 죽인다.
      //
      // ⚠️ 위의 세대 비교는 **큐 바깥**이다 — 계정 전환 중 B 의 saveSession 이 «저장하는 동안»
      // 도착한 A 의 401 은 아직 공개 전인 옛 세대로 이 검사를 통과하고, 이어서 큐에 선 정리가
      // B 의 commit 뒤에 실행돼 방금 채택한 B 를 지운다. 그래서 잡아 둔 세대를 넘겨 큐 **안에서**
      // 다시 보게 한다(saveSession 과 같은 fence). 정리를 건너뛰었으면 세션 상실도 알리지 않는다 —
      // 살아 있는 것은 B 이고 화면을 로그인으로 되돌릴 이유가 없다.
      // 키체인 삭제 실패는 삼키되 알림은 실행한다: 건너뛰면 화면이 보호 화면에 남고, 원래의 401
      // 판정까지 저장소 예외로 바뀌어 checkSession 이 그것을 「확인 실패」로 오인한다.
      if (await clearRejectedSession(generation)) notifySessionLost();
    }
    throw error;
  }

  if (generation !== sessionGeneration()) {
    throw new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요. 다시 시도해 주세요.', 0);
  }

  // 무접두 공개 경로는 `{data}` 봉투다. 봉투가 없는 응답은 본문 그대로 돌려준다.
  const envelope = payload as { data?: unknown } | null;
  return (
    envelope && typeof envelope === 'object' && 'data' in envelope ? envelope.data : payload
  ) as T;
}
