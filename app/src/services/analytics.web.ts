// 웹에서는 네이티브 Firebase Analytics 앱을 초기화하지 않는다.
// 초대 어트리뷰션이 요구하는 설치 ID 계약만 브라우저 저장소로 유지한다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';

let deviceId: string | null = null;

function randomUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : 8 + (r % 4);
    return v.toString(16);
  });
}

export async function getDeviceId(): Promise<string> {
  if (deviceId) return deviceId;
  try {
    deviceId = (await AsyncStorage.getItem(STORAGE_KEYS.deviceId)) ?? randomUuid();
    await AsyncStorage.setItem(STORAGE_KEYS.deviceId, deviceId);
  } catch {
    deviceId = deviceId ?? randomUuid();
  }
  return deviceId;
}

export async function initAnalytics(): Promise<void> {
  await getDeviceId();
}

export async function getAppInstanceId(): Promise<string | null> {
  return null;
}

export function track(name: string, params?: Record<string, unknown>): void {
  if (__DEV__) console.log('[analytics:web]', name, params ?? {});
}

export function setUserId(_id: string | null): void {}

export function setUserProperty(_name: string, _value: string | boolean | null): void {}
