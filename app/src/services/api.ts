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

let onLogout: (() => void) | null = null;

export function setLogoutHandler(fn: (() => void) | null): void {
  onLogout = fn;
}

// 등록된 로그아웃 핸들러를 외부에서 호출(전체 화면의 로그아웃 버튼 등).
export function triggerLogout(): void {
  onLogout?.();
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

function refreshAccessToken(): Promise<string> {
  refreshPromise ??= doRefreshAccessToken().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

// 토큰 갱신. 인터셉터 루프를 피하기 위해 인스턴스(api)가 아닌 bare axios 사용.
async function doRefreshAccessToken(): Promise<string> {
  const refreshToken = await AsyncStorage.getItem(STORAGE_KEYS.refreshToken);
  if (!refreshToken) throw new Error('no refresh token');

  const { data } = await axios.post<RefreshResponse>(`${API_URL}/api/v1/auth/refresh`, {
    refreshToken,
  });

  await AsyncStorage.setItem(STORAGE_KEYS.accessToken, data.accessToken);
  if (data.refreshToken) {
    await AsyncStorage.setItem(STORAGE_KEYS.refreshToken, data.refreshToken);
  }
  return data.accessToken;
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
export async function getFreshAccessToken(): Promise<string | null> {
  const token = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
  if (!token) return null;
  const expMs = getTokenExpMs(token);
  if (expMs !== null && expMs - Date.now() > TOKEN_EXP_MARGIN_MS) {
    return token;
  }
  return refreshAccessToken();
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
  const token = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;

    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      try {
        const newToken = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        onLogout?.();
        throw new Error('세션이 만료됐습니다. 다시 로그인해주세요.');
      }
    }

    return Promise.reject(error);
  },
);
