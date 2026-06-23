import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../types/storage';

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

async function refreshAccessToken(): Promise<string> {
  const refreshToken = await AsyncStorage.getItem(STORAGE_KEYS.refreshToken);
  if (!refreshToken) throw new Error('no refresh token');

  const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) throw new Error('refresh failed');

  const data = (await res.json()) as RefreshResponse;
  await AsyncStorage.setItem(STORAGE_KEYS.accessToken, data.accessToken);
  if (data.refreshToken) {
    await AsyncStorage.setItem(STORAGE_KEYS.refreshToken, data.refreshToken);
  }
  return data.accessToken;
}

// JWT 자동 주입 + 401 시 토큰 갱신 후 1회 재시도하는 fetch 래퍼.
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await AsyncStorage.getItem(STORAGE_KEYS.accessToken);

  const makeRequest = (t: string | null): Promise<Response> =>
    fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${t}`,
        ...options.headers,
      },
    });

  const res = await makeRequest(token);

  if (res.status !== 401) return res;

  if (!token) throw new Error('인증이 필요합니다.');

  try {
    const newToken = await refreshAccessToken();
    return makeRequest(newToken);
  } catch {
    onLogout?.();
    throw new Error('세션이 만료됐습니다. 다시 로그인해주세요.');
  }
}
