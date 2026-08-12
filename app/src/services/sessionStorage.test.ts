import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  migrateLegacySessionStorage,
  readSessionTokens,
  saveSessionTokens,
} from './sessionStorage';
import { STORAGE_KEYS } from '@/types/storage';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const secureValues = new Map<string, string>();
const getItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;
const setItemAsync = SecureStore.setItemAsync as jest.MockedFunction<
  typeof SecureStore.setItemAsync
>;
const deleteItemAsync = SecureStore.deleteItemAsync as jest.MockedFunction<
  typeof SecureStore.deleteItemAsync
>;
const originalPlatformOS = Platform.OS;
const originalWebSessionStorage = globalThis.sessionStorage;

beforeEach(async () => {
  await AsyncStorage.clear();
  secureValues.clear();
  jest.clearAllMocks();
  getItemAsync.mockImplementation(async (key) => secureValues.get(key) ?? null);
  setItemAsync.mockImplementation(async (key, value) => {
    secureValues.set(key, value);
  });
  deleteItemAsync.mockImplementation(async (key) => {
    secureValues.delete(key);
  });
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatformOS });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: originalWebSessionStorage,
  });
});

test('기존 AsyncStorage 세션을 보안 저장소로 옮긴 뒤 모든 평문 토큰 사본을 제거한다', async () => {
  await AsyncStorage.multiSet([
    [STORAGE_KEYS.accessToken, 'legacy-access'],
    [STORAGE_KEYS.refreshToken, 'legacy-refresh'],
    [
      STORAGE_KEYS.user,
      JSON.stringify({
        nickname: '그로미',
        accessToken: 'user-access-copy',
        refreshToken: 'user-refresh-copy',
      }),
    ],
  ]);

  await migrateLegacySessionStorage();

  await expect(readSessionTokens()).resolves.toEqual({
    accessToken: 'legacy-access',
    refreshToken: 'legacy-refresh',
  });
  await expect(AsyncStorage.getItem(STORAGE_KEYS.accessToken)).resolves.toBeNull();
  await expect(AsyncStorage.getItem(STORAGE_KEYS.refreshToken)).resolves.toBeNull();
  await expect(AsyncStorage.getItem(STORAGE_KEYS.user)).resolves.toBe(
    JSON.stringify({ nickname: '그로미' }),
  );
});

test('refresh token만 남은 레거시 세션도 보안 저장소로 옮긴 뒤 평문 사본을 제거한다', async () => {
  await AsyncStorage.setItem(STORAGE_KEYS.refreshToken, 'legacy-refresh');

  await migrateLegacySessionStorage();

  await expect(readSessionTokens()).resolves.toEqual({
    accessToken: null,
    refreshToken: 'legacy-refresh',
  });
  await expect(AsyncStorage.getItem(STORAGE_KEYS.refreshToken)).resolves.toBeNull();
});

test('새 토큰 쌍 저장이 실패하면 기존 세션 쌍을 그대로 보존한다', async () => {
  await saveSessionTokens('old-access', 'old-refresh');
  setItemAsync.mockImplementation(async (key, value) => {
    if (value.includes('new-refresh')) throw new Error('secure write failed');
    secureValues.set(key, value);
  });

  await expect(saveSessionTokens('new-access', 'new-refresh')).rejects.toThrow(
    'secure write failed',
  );
  await expect(readSessionTokens()).resolves.toEqual({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  });
});

test('web에서는 네이티브 SecureStore 대신 새로고침을 견디는 브라우저 세션 저장소를 사용한다', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  const browserValues = new Map<string, string>();
  const browserSessionStorage = {
    getItem: jest.fn((key: string) => browserValues.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => browserValues.set(key, value)),
    removeItem: jest.fn((key: string) => browserValues.delete(key)),
  };
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: browserSessionStorage,
  });
  getItemAsync.mockRejectedValue(new Error('native module unavailable'));
  setItemAsync.mockRejectedValue(new Error('native module unavailable'));

  await saveSessionTokens('web-access', 'web-refresh');

  await expect(readSessionTokens()).resolves.toEqual({
    accessToken: 'web-access',
    refreshToken: 'web-refresh',
  });
  expect(browserSessionStorage.setItem).toHaveBeenCalledTimes(1);
  expect(browserSessionStorage.getItem).toHaveBeenCalled();
  expect(getItemAsync).not.toHaveBeenCalled();
  expect(setItemAsync).not.toHaveBeenCalled();
});
