import { shouldGateScreenTimeBoard } from './screenTimeFlow';

describe('스크린타임 게시판 진입', () => {
  for (const route of ['board', 'quest', 'home', 'permission', 'screenTimeApps'] as const)
    for (const visiting of [true, false])
      for (const isIOS of [true, false])
        for (const promptSeen of [true, false])
          it(`${route}, 방문=${visiting}, iOS=${isIOS}, 안내=${promptSeen}`, () => {
            expect(shouldGateScreenTimeBoard(route, { visiting, isIOS, promptSeen })).toBe(
              !visiting && isIOS && !promptSeen && ['board', 'quest'].includes(route),
            );
          });
});
