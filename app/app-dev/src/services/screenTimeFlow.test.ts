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

for (const route of ['board', 'quest'] as const) {
  test(`Android ${route} 방문자는 권한·피커 관문을 열지 않는다`, () => {
    expect(
      shouldGateScreenTimeBoard(route, {
        visiting: true,
        isIOS: false,
        isAndroid: true,
        promptSeen: false,
      }),
    ).toBe(false);
    expect(
      shouldGateScreenTimeBoard(route, {
        visiting: false,
        isIOS: false,
        isAndroid: true,
        promptSeen: false,
      }),
    ).toBe(true);
  });
}
