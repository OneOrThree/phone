import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Route } from '@/services/model';

// GROMO-1839 가로 그림이 없는 시작·가입 흐름만 세로로 고정한다. 나머지 화면은 이미 가로로
// 설계돼 있으므로 기기 방향을 그대로 따른다(`app.config.js` 의 orientation: 'default').
export const PORTRAIT_ROUTES: readonly Route[] = [
  'login',
  'character',
  'chooseIsland',
  'createIsland',
  'joinIsland',
  'approval',
];

const portraitOnly = new Set<Route>(PORTRAIT_ROUTES);

export const isPortraitRoute = (route: Route) => portraitOnly.has(route);

// 웹에는 화면 방향 잠금이 없고(검수 스크립트가 같은 번들을 쓴다), 시뮬레이터·기기에서도
// 잠금 호출이 실패할 수 있다. 실패가 화면 전환을 막지 않도록 조용히 넘긴다
async function apply(route: Route) {
  if (Platform.OS === 'web') return;
  try {
    await ScreenOrientation.lockAsync(
      isPortraitRoute(route)
        ? ScreenOrientation.OrientationLock.PORTRAIT_UP
        : ScreenOrientation.OrientationLock.DEFAULT,
    );
  } catch {}
}

// 화면이 바뀔 때마다 그 화면의 방향 정책을 적용한다. 잠금만 바꾸므로 회전해도 화면이
// 다시 마운트되지 않고 집중 시작 시각·입력값·고른 항목이 그대로 남는다
export function useRouteOrientation(route: Route) {
  useEffect(() => {
    apply(route);
  }, [route]);
}
