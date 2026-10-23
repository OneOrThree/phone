import { Linking } from 'react-native';

export type AppDeepLinkRoute = 'home' | 'focusSetup' | 'friends';

export type AppDeepLinkTarget =
  | { kind: 'route'; route: AppDeepLinkRoute }
  | { kind: 'island'; islandId: string }
  | { kind: 'magazine'; issueId: string }
  | { kind: 'unsupported'; legacyPath: 'join' | 'group' | 'league' }
  | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 쿼리에서 `key`의 UUID 값을 꺼낸다. 없거나 깨졌거나 UUID가 아니면 null — 다른 파라미터(challenge 등)는 무시한다. */
function queryUuid(query: string, key: 'g' | 'issue'): string | null {
  const raw = new RegExp(`(?:^|&)${key}=([^&]*)`).exec(query)?.[1];
  if (raw === undefined) return null;
  try {
    const value = decodeURIComponent(raw);
    return UUID.test(value) ? value : null;
  } catch {
    return null; // 잘못된 퍼센트 인코딩
  }
}

/**
 * 서버가 보내는 링크(home·friends·group?g=·magazine?issue=)와 기기에 남은 1.x 링크(focus·league·join·챌린지 group)를
 * 분류한다. 2.0에 없는 화면은 안전한 fallback 대상(unsupported)으로 둔다.
 */
export function parseAppDeepLink(rawUrl: string): AppDeepLinkTarget {
  const match = /^gromo:\/\/+([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(rawUrl.trim());
  if (!match) return null;

  const path = match[1].split('/').filter(Boolean)[0]?.toLowerCase();
  const query = match[2] ?? '';
  switch (path) {
    case 'home':
      return { kind: 'route', route: 'home' };
    case 'focus':
      return { kind: 'route', route: 'focusSetup' };
    case 'friends':
      return { kind: 'route', route: 'friends' };
    case 'group': {
      const islandId = queryUuid(query, 'g');
      return islandId ? { kind: 'island', islandId } : { kind: 'unsupported', legacyPath: 'group' };
    }
    case 'magazine': {
      const issueId = queryUuid(query, 'issue');
      return issueId ? { kind: 'magazine', issueId } : { kind: 'route', route: 'home' };
    }
    case 'join':
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
  // 초기 URL 조회가 끝나기 전에 새 URL 이벤트가 오면 그쪽이 더 최신이다 — 늦은 초기 URL로 덮지 않는다.
  let receivedEvent = false;
  void source
    .getInitialURL()
    .then((url) => {
      if (active && url && !receivedEvent) onUrl(url);
    })
    .catch(() => {
      // initial URL 조회 실패는 일반 앱 진입을 막지 않는다.
    });
  const subscription = source.addEventListener('url', ({ url }) => {
    receivedEvent = true;
    if (active) onUrl(url);
  });
  return () => {
    active = false;
    subscription.remove();
  };
}
