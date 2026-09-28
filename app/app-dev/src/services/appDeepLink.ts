import { Linking } from 'react-native';

export type AppDeepLinkRoute = 'home' | 'focusSetup' | 'friends';

export type AppDeepLinkTarget =
  | { kind: 'route'; route: AppDeepLinkRoute }
  | { kind: 'unsupported'; legacyPath: 'join' | 'group' | 'league' }
  | null;

/** 1.x scheme 경로 중 2.0에서 실제 제공하는 화면만 열고, 나머지는 안전한 fallback 대상으로 분류한다. */
export function parseAppDeepLink(rawUrl: string): AppDeepLinkTarget {
  const match = /^gromo:\/\/+([^?#]*)(?:[?#].*)?$/i.exec(rawUrl.trim());
  if (!match) return null;

  const path = match[1].split('/').filter(Boolean)[0]?.toLowerCase();
  switch (path) {
    case 'home':
      return { kind: 'route', route: 'home' };
    case 'focus':
      return { kind: 'route', route: 'focusSetup' };
    case 'friends':
      return { kind: 'route', route: 'friends' };
    case 'join':
    case 'group':
    case 'league':
      return { kind: 'unsupported', legacyPath: path };
    default:
      return null;
  }
}

export type AppLinkSource = Pick<typeof Linking, 'getInitialURL' | 'addEventListener'>;

/** 콜드 스타트 URL과 singleTask 웜 URL을 같은 소비자에게 전달한다. */
export function subscribeToAppLinks(
  onUrl: (url: string) => void,
  source: AppLinkSource = Linking,
): () => void {
  let active = true;
  void source
    .getInitialURL()
    .then((url) => {
      if (active && url) onUrl(url);
    })
    .catch(() => {
      // initial URL 조회 실패는 일반 앱 진입을 막지 않는다.
    });
  const subscription = source.addEventListener('url', ({ url }) => {
    if (active) onUrl(url);
  });
  return () => {
    active = false;
    subscription.remove();
  };
}
