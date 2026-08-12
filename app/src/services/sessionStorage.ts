import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { STORAGE_KEYS } from '@/types/storage';

const SESSION_TOKENS_KEY = 'gromo.sessionTokens';
const WEB_SESSION_TOKENS_KEY = 'gromo:sessionTokens';
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export interface SessionTokens {
  accessToken: string | null;
  refreshToken: string | null;
}

let webSessionTokens: SessionTokens = { accessToken: null, refreshToken: null };

interface WebSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getWebSessionStorage(): WebSessionStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function readWebSessionTokens(): string | null {
  try {
    return getWebSessionStorage()?.getItem(WEB_SESSION_TOKENS_KEY) ?? null;
  } catch {
    return null;
  }
}

function persistWebSessionTokens(tokens: SessionTokens): void {
  try {
    getWebSessionStorage()?.setItem(WEB_SESSION_TOKENS_KEY, JSON.stringify(tokens));
  } catch {}
  webSessionTokens = { ...tokens };
}

function parseSessionTokens(raw: string | null): SessionTokens {
  if (!raw) return { accessToken: null, refreshToken: null };
  try {
    const parsed = JSON.parse(raw) as Partial<SessionTokens>;
    return {
      accessToken: typeof parsed.accessToken === 'string' ? parsed.accessToken : null,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
    };
  } catch {
    return { accessToken: null, refreshToken: null };
  }
}

async function writeSessionTokens(tokens: SessionTokens): Promise<void> {
  if (Platform.OS === 'web') {
    persistWebSessionTokens(tokens);
    return;
  }
  await SecureStore.setItemAsync(SESSION_TOKENS_KEY, JSON.stringify(tokens), SECURE_STORE_OPTIONS);
}

export async function replaceSessionTokens(tokens: SessionTokens): Promise<void> {
  if (!tokens.accessToken && !tokens.refreshToken) {
    await clearSessionTokens();
    return;
  }
  await writeSessionTokens(tokens);
}

export async function readSessionTokens(): Promise<SessionTokens> {
  if (Platform.OS === 'web') {
    const persisted = readWebSessionTokens();
    return persisted ? parseSessionTokens(persisted) : { ...webSessionTokens };
  }
  return parseSessionTokens(await SecureStore.getItemAsync(SESSION_TOKENS_KEY));
}

export async function readAccessToken(): Promise<string | null> {
  return (await readSessionTokens()).accessToken;
}

export async function readRefreshToken(): Promise<string | null> {
  return (await readSessionTokens()).refreshToken;
}

export async function saveSessionTokens(
  accessToken: string,
  refreshToken?: string | null,
): Promise<void> {
  const current = refreshToken == null ? await readSessionTokens() : null;
  await writeSessionTokens({
    accessToken,
    refreshToken: refreshToken ?? current?.refreshToken ?? null,
  });
}

export async function clearSessionTokens(): Promise<void> {
  if (Platform.OS === 'web') {
    webSessionTokens = { accessToken: null, refreshToken: null };
    try {
      getWebSessionStorage()?.removeItem(WEB_SESSION_TOKENS_KEY);
    } catch {}
    return;
  }
  await SecureStore.deleteItemAsync(SESSION_TOKENS_KEY);
}

interface LegacyUserSnapshot {
  accessToken?: unknown;
  refreshToken?: unknown;
  [key: string]: unknown;
}

/**
 * 배포된 구 버전의 평문 토큰을 보안 저장소로 1회 인계한다.
 *
 * 보안 저장소 쓰기가 모두 끝난 뒤에만 AsyncStorage 사본을 지운다. 중간 실패 시 다음 앱 실행에서
 * 다시 시도할 수 있고, 기존 사용자의 세션도 잃지 않는다.
 */
export async function migrateLegacySessionStorage(): Promise<void> {
  const [secure, legacyPairs] = await Promise.all([
    readSessionTokens(),
    AsyncStorage.multiGet([STORAGE_KEYS.accessToken, STORAGE_KEYS.refreshToken, STORAGE_KEYS.user]),
  ]);
  const legacy = Object.fromEntries(legacyPairs) as Record<string, string | null>;
  const rawUser = legacy[STORAGE_KEYS.user];
  const user = rawUser ? (JSON.parse(rawUser) as LegacyUserSnapshot) : null;
  const userAccessToken = typeof user?.accessToken === 'string' ? user.accessToken : null;
  const userRefreshToken = typeof user?.refreshToken === 'string' ? user.refreshToken : null;
  const accessToken = secure.accessToken ?? legacy[STORAGE_KEYS.accessToken] ?? userAccessToken;
  const refreshToken = secure.refreshToken ?? legacy[STORAGE_KEYS.refreshToken] ?? userRefreshToken;

  if (accessToken || refreshToken) {
    await writeSessionTokens({ accessToken, refreshToken });
  }

  if (user && ('accessToken' in user || 'refreshToken' in user)) {
    delete user.accessToken;
    delete user.refreshToken;
    await AsyncStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
  }
  await AsyncStorage.multiRemove([STORAGE_KEYS.accessToken, STORAGE_KEYS.refreshToken]);
}
