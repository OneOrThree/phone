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
let onRelogin: ((opts?: { fromGuest?: boolean }) => void) | null = null;

export function setReloginHandler(fn: ((opts?: { fromGuest?: boolean }) => void) | null): void {
  onRelogin = fn;
}

// 등록된 재로그인 핸들러를 외부에서 호출(게스트 → 소셜 전환 등).
export function triggerRelogin(opts?: { fromGuest?: boolean }): void {
  onRelogin?.(opts);
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
