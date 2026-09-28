import { getLocales } from 'expo-localization';
import { Platform } from 'react-native';
import type { Provider } from '@/services/api/auth';

export type LoginPlatform = 'ios' | 'android' | 'web';

/** 휴대폰의 첫 번째 로케일 지역이 한국이면 Kakao, 그 외에는 LINE을 노출한다. */
export function loginProviders(
  regionCode = getLocales()[0]?.regionCode,
  platform: LoginPlatform = Platform.OS === 'ios'
    ? 'ios'
    : Platform.OS === 'android'
      ? 'android'
      : 'web',
): Provider[] {
  if (platform === 'web') return [];
  const regional: Provider = regionCode?.toUpperCase() === 'KR' ? 'kakao' : 'line';
  if (platform === 'ios') return [regional, 'apple', 'google'];
  return [regional, 'google'];
}
