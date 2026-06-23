import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';

export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? 'https://oneorthree.mooo.com';

// JWT access token의 sub(사용자 id)를 디코드. 실패 시 null.
export function getUserIdFromToken(token: string): number | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(payload)) as { sub?: string | number };
    return Number(decoded.sub);
  } catch {
    return null;
  }
}

let onLogout: (() => void) | null = null;

export function setLogoutHandler(fn: (() => void) | null): void {
  onLogout = fn;
}

// /api/v1/auth/refresh 응답 형태
interface RefreshResponse {
  accessToken: string;
  refreshToken?: string;
}

// 토큰 갱신. 인터셉터 루프를 피하기 위해 인스턴스(api)가 아닌 bare axios 사용.
async function refreshAccessToken(): Promise<string> {
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
  headers: { 'Content-Type': 'application/json' },
});

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
