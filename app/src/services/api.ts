import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { enableApiMocks } from '@/mocks';

export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? 'https://oneorthree.dev.mooo.com';

// 백엔드 무응답 시 무한 로딩 방지(예: 로그인 스피너가 멈추지 않는 문제).
// 로그인 등 인터셉터 없는 bare axios 호출에도 적용되도록 전역 기본값으로 둔다.
const REQUEST_TIMEOUT_MS = 15000;
axios.defaults.timeout = REQUEST_TIMEOUT_MS;

// JWT access token의 sub(사용자 id = UUID)를 디코드. 실패 시 null.
export function getUserIdFromToken(token: string): string | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(payload)) as { sub?: string };
    return decoded.sub ?? null;
  } catch {
    return null;
  }
}

let onLogout: ((expectedGeneration?: number) => void) | null = null;

// 소셜 로그인/게스트 승격처럼 인증 세션 자체가 교체될 때만 증가한다. access token 자동 갱신은
// 같은 세션의 연장이므로 올리지 않는다. userId가 같은 승격에서도 이전 요청의 후속 부작용을
// 취소할 수 있도록 화면은 요청 시작/완료 시 이 동기 세대를 비교한다.
let authSessionGeneration = 0;
let authTransitionTail: Promise<void> = Promise.resolve();
let activeAuthTransitionToken: symbol | null = null;

export interface AuthSessionTransitionLease {
  readonly token: symbol;
}

export function getAuthSessionGeneration(): number {
  return authSessionGeneration;
}

export function markAuthSessionReplacement(): void {
  authSessionGeneration += 1;
}

/** 로그인 세션 저장과 로그아웃 삭제가 서로의 중간 단계에 끼어들지 않게 하는 프로세스 mutex. */
export async function acquireAuthSessionTransition(): Promise<() => void> {
  const previous = authTransitionTail;
  let unlock!: () => void;
  authTransitionTail = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await previous;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    unlock();
  };
}

/** provider 인증 시작부터 로컬 세션 커밋까지 한 번의 전환으로 직렬화한다. */
export async function runAuthSessionTransition<T>(
  operation: (lease: AuthSessionTransitionLease) => Promise<T>,
): Promise<T> {
  const release = await acquireAuthSessionTransition();
  const lease = { token: Symbol('auth-session-transition') };
  activeAuthTransitionToken = lease.token;
  try {
    return await operation(lease);
  } finally {
    if (activeAuthTransitionToken === lease.token) activeAuthTransitionToken = null;
    release();
  }
}

function ownsAuthSessionTransition(lease?: AuthSessionTransitionLease): boolean {
  return lease !== undefined && lease.token === activeAuthTransitionToken;
}

export function setLogoutHandler(fn: ((expectedGeneration?: number) => void) | null): void {
  onLogout = fn;
}

// 등록된 로그아웃 핸들러를 외부에서 호출(전체 화면의 로그아웃 버튼 등).
// 비동기 요청이 세션 이상을 발견한 경우에는 요청 시작 세대를 넘겨, 그 사이 완료된 새 인증을
// 오래된 응답이 로그아웃시키지 않게 한다. 사용자 직접 로그아웃은 현재 세대를 App에서 캡처한다.
export function triggerLogout(expectedGeneration?: number): void {
  onLogout?.(expectedGeneration);
}

// 재로그인 핸들러 — 게스트가 설정에서 소셜 로그인해 새 토큰/유저가 저장된 뒤,
// 로그아웃 없이 앱 인메모리 세션만 새 계정으로 교체할 때 App이 등록해 쓴다.
// fromGuest는 호출부(게스트 판별 주체)가 넘긴다 — isGuest 태깅 없는 구 세션도 연동 목록으로
// 게스트 판별되므로 프로필 플래그만으론 전환을 놓친다(GROMO-936 코덱스 리뷰).
let onRelogin: ((opts?: { fromGuest?: boolean }) => void | Promise<void>) | null = null;

export function setReloginHandler(
  fn: ((opts?: { fromGuest?: boolean }) => void | Promise<void>) | null,
): void {
  onRelogin = fn;
}

// 등록된 재로그인 핸들러를 외부에서 호출(게스트 → 소셜 전환 등). 세션 교체·인계가 끝날
// 때까지 기다릴 수 있게 Promise를 돌려준다 — 호출부가 그동안 재로그인 UI를 잠가 전환
// 도중 다른 소셜로 이중 전환이 경합하지 않게 한다(코덱스 리뷰).
export function triggerRelogin(opts?: { fromGuest?: boolean }): Promise<void> {
  return Promise.resolve(onRelogin?.(opts));
}

// /api/v1/auth/refresh 응답 형태
interface RefreshResponse {
  accessToken: string;
  refreshToken?: string;
}

// 진행 중인 토큰 갱신 Promise. 동시 다발 401이 와도 갱신은 한 번만 실행되도록
// 공유한다(single-flight). 리프레시 토큰이 rotate되므로 중복 호출 시 두 번째부터
// 이미 사용된 토큰으로 갱신을 시도해 실패 → 일부 요청만 로그아웃되는 경합이 생긴다.
let refreshPromise: Promise<string> | null = null;

function refreshAccessToken(
  lease?: AuthSessionTransitionLease,
  expectedGeneration?: number,
): Promise<string> {
  // 전환 작업 자신이 이미 mutex를 소유하면 전역 single-flight가 잠금 뒤에서 기다리고 있을 수
  // 있으므로 그 Promise에 합류하지 않는다. 현재 전환 안에서 직접 갱신하고, 바깥 refresh는 잠금
  // 해제 뒤 회전된 최신 refresh token으로 이어 간다.
  if (ownsAuthSessionTransition(lease)) {
    return doRefreshAccessToken(lease, expectedGeneration);
  }
  refreshPromise ??= doRefreshAccessToken(undefined, expectedGeneration).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

// 토큰 갱신. 인터셉터 루프를 피하기 위해 인스턴스(api)가 아닌 bare axios 사용.
class StaleAuthRefreshError extends Error {}

async function doRefreshAccessToken(
  lease?: AuthSessionTransitionLease,
  expectedGeneration?: number,
): Promise<string> {
  // 외부 refresh는 요청 시작 전부터 저장 완료까지 전환 mutex를 소유한다. 인증 전환 안에서 호출된
  // refresh는 전달받은 lease로 같은 잠금을 재사용해 중첩 획득 교착을 피한다.
  const release = ownsAuthSessionTransition(lease) ? null : await acquireAuthSessionTransition();
  try {
    if (expectedGeneration !== undefined && getAuthSessionGeneration() !== expectedGeneration) {
      throw new StaleAuthRefreshError('stale auth refresh');
    }
    const sessionGeneration = getAuthSessionGeneration();
    const refreshToken = await AsyncStorage.getItem(STORAGE_KEYS.refreshToken);
    if (!refreshToken) throw new Error('no refresh token');

    const { data } = await axios.post<RefreshResponse>(`${API_URL}/api/v1/auth/refresh`, {
      refreshToken,
    });

    const currentRefreshToken = await AsyncStorage.getItem(STORAGE_KEYS.refreshToken);
    if (getAuthSessionGeneration() !== sessionGeneration || currentRefreshToken !== refreshToken) {
      throw new StaleAuthRefreshError('stale auth refresh');
    }
    await AsyncStorage.setItem(STORAGE_KEYS.accessToken, data.accessToken);
    if (data.refreshToken) {
      await AsyncStorage.setItem(STORAGE_KEYS.refreshToken, data.refreshToken);
    }
    return data.accessToken;
  } finally {
    release?.();
  }
}

// JWT payload의 만료시각(exp, 초 단위)을 ms로 디코드. 실패 시 null.
function getTokenExpMs(token: string): number | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(payload)) as { exp?: number };
    return typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

// 만료 판정 여유 — 전송·서버 검증 사이 시차로 아슬아슬한 토큰이 서버에서 만료 처리되는 것 방지.
const TOKEN_EXP_MARGIN_MS = 30_000;

// 저장된 access 토큰을 유효한 상태로 보장해 반환 — 만료·임박이면 갱신 후 새 토큰을 준다.
// 게스트→소셜 승격(GROMO-962)처럼 인터셉터 없는 bare 요청에 토큰을 실을 때 사용한다:
// 만료 토큰을 그대로 보내면 백엔드가 "토큰 없음"과 동일 취급해 조용히 새 계정을 만든다(코덱스 리뷰).
// 갱신은 401 인터셉터와 같은 single-flight를 공유하므로 동시 갱신(리프레시 토큰 rotate) 경합이 없다.
// exp 디코드 실패도 갱신 경로로 보낸다 — 무효일 수 있는 토큰을 그대로 싣는 것보다 안전.
// null은 저장된 토큰이 없을 때만. 갱신 실패는 삼키지 않고 그대로 던진다 — 일시적 오류(네트워크·
// 서버 5xx)까지 "토큰 없음"으로 계속하면 돌이킬 수 없는 오동작(게스트 승격 대신 새 계정 생성)이
// 되므로, 중단·재시도는 호출부가 결정한다(코드리뷰 반영).
export async function getFreshAccessToken(
  lease?: AuthSessionTransitionLease,
): Promise<string | null> {
  const token = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
  if (!token) return null;
  const expMs = getTokenExpMs(token);
  if (expMs !== null && expMs - Date.now() > TOKEN_EXP_MARGIN_MS) {
    return token;
  }
  return refreshAccessToken(lease);
}

// 모든 백엔드 호출은 이 인스턴스를 통한다 (fetch 직접 사용 금지).
// - 요청 인터셉터: JWT 자동 주입
// - 응답 인터셉터: 401 시 토큰 갱신 후 1회 재시도, 실패하면 로그아웃
export const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

// 개발용 API 목킹(src/mocks) — dev 빌드 + EXPO_PUBLIC_USE_MOCK=true 일 때만 활성.
// 등록된 경로만 목으로 응답하고 나머지는 실서버로 나간다. .env 변경 후엔 Metro 재시작 필요.
if (__DEV__ && process.env.EXPO_PUBLIC_USE_MOCK === 'true') {
  enableApiMocks(api);
}

api.interceptors.request.use(async (config) => {
  const sessionConfig = config as RetriableConfig;
  // 요청이 시작된 세대를 401 재시도까지 보존한다. 응답 시점의 전역 상태를 새로 읽으면 이전
  // 계정 요청을 새 계정 토큰으로 다시 보낼 수 있다.
  sessionConfig._authSessionGeneration ??= getAuthSessionGeneration();
  // 호출부가 토큰을 명시했으면 그대로 둔다(GROMO-1049) — 세션 저장처럼 **어느 계정 것인지 검증한 뒤**
  // 보내는 요청이 있는데, 여기서 매번 저장소를 다시 읽으면 검증 시점과 전송 시점 사이에 계정이
  // 바뀌었을 때 옛 계정의 기록이 새 계정으로 커밋된다(코덱스 리뷰 P1).
  if (config.headers.Authorization) {
    return config;
  }
  const token = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _authSessionGeneration?: number;
  // 401 재발급 재시도를 건너뛴다 — 특정 계정으로 보내야 하는 요청은 재발급 토큰이 **전환된 계정**
  // 것일 수 있어, 재시도가 곧 계정 오귀속이 된다(GROMO-1049). 그냥 실패시켜 대기열로 보낸다.
  _noAuthRetry?: boolean;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;

    if (error.response?.status === 401 && original && !original._retry && !original._noAuthRetry) {
      original._retry = true;
      try {
        const requestGeneration = original._authSessionGeneration ?? getAuthSessionGeneration();
        if (requestGeneration !== getAuthSessionGeneration()) {
          throw new StaleAuthRefreshError('stale auth refresh');
        }
        // 공유 api 요청은 인증 전환의 소유 작업인지 판별할 async-local 문맥이 없다. 전환 중인
        // 모든 요청에 전역 lease를 부여하면 무관한 화면 요청도 single-flight를 우회한다. 따라서
        // 전환이 활성인 동안 401이 된 공유 요청은 폐기하고, 명시적 lease는 getFreshAccessToken
        // 호출처럼 인증 작업이 직접 소유권을 전달한 경로에서만 사용한다.
        if (activeAuthTransitionToken !== null) {
          throw new StaleAuthRefreshError('stale auth refresh');
        }
        const newToken = await refreshAccessToken(undefined, requestGeneration);
        if (requestGeneration !== getAuthSessionGeneration()) {
          throw new StaleAuthRefreshError('stale auth refresh');
        }
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (refreshError) {
        // 이전 세션 refresh 응답을 의도적으로 폐기한 경우 현재 세션까지 로그아웃시키지 않는다.
        if (refreshError instanceof StaleAuthRefreshError) throw refreshError;
        onLogout?.();
        throw new Error('세션이 만료됐습니다. 다시 로그인해주세요.');
      }
    }

    return Promise.reject(error);
  },
);
