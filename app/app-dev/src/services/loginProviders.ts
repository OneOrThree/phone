import { Platform } from 'react-native';
import type { Provider } from '@/services/api/auth';

export type LoginPlatform = 'ios' | 'android' | 'web';

/**
 * MVP 로그인 제공자는 애플·구글뿐이다(GROMO-2215, 2026-10-06 결정). 지역에 따라 Kakao·LINE 을 앞세우던 분기는
 * 없앴다 — 버튼 코드(LoginScreen)는 남겨 두어 정책이 돌아오면 이 목록에 다시 넣기만 하면 된다.
 * Apple 은 iOS 에서 공개 플래그가 켜졌을 때만, Android 에는 Apple 이 없다(계정 정책 LOGIN-D01).
 */
export function loginProviders(
  platform: LoginPlatform = Platform.OS === 'ios'
    ? 'ios'
    : Platform.OS === 'android'
      ? 'android'
      : 'web',
  appleLoginEnabled = process.env.EXPO_PUBLIC_APPLE_LOGIN_ENABLED === '1',
): Provider[] {
  if (platform === 'web') return [];
  if (platform === 'ios') return appleLoginEnabled ? ['apple', 'google'] : ['google'];
  return ['google'];
}
