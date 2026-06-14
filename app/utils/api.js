import AsyncStorage from '@react-native-async-storage/async-storage';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://oneorthree.mooo.com';

export function getUserIdFromToken(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(payload));
    return Number(decoded.sub);
  } catch {
    return null;
  }
}

let onLogout = null;

export function setLogoutHandler(fn) {
  onLogout = fn;
}

async function refreshAccessToken() {
  const refreshToken = await AsyncStorage.getItem('gromo:refreshToken');
  if (!refreshToken) throw new Error('no refresh token');

  const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) throw new Error('refresh failed');

  const data = await res.json();
  await AsyncStorage.setItem('gromo:accessToken', data.accessToken);
  if (data.refreshToken) {
    await AsyncStorage.setItem('gromo:refreshToken', data.refreshToken);
  }
  return data.accessToken;
}

export async function apiFetch(path, options = {}) {
  const token = await AsyncStorage.getItem('gromo:accessToken');

  const makeRequest = (t) =>
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

  try {
    const newToken = await refreshAccessToken();
    return makeRequest(newToken);
  } catch {
    onLogout?.();
    throw new Error('세션이 만료됐습니다. 다시 로그인해주세요.');
  }
}
