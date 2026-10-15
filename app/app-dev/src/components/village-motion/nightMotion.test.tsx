import React from 'react';
import { act, configure, render } from '@testing-library/react-native';
import { LibraryMotion } from './LibraryMotion';
import { ShopMotion } from './ShopMotion';
import { VillageHallMotion } from './VillageHallMotion';
import { VillageObservatoryMotion } from './VillageObservatoryMotion';

// 장식 모션은 스크린리더에서 숨기므로 숨김 요소까지 조회한다.
configure({ defaultIncludeHiddenElements: true });

const nightFrames = {
  hall: [
    require('@/assets/village-world/motion/hall/night-frame-0.png'),
    require('@/assets/village-world/motion/hall/night-frame-1.png'),
    require('@/assets/village-world/motion/hall/night-frame-2.png'),
    require('@/assets/village-world/motion/hall/night-frame-3.png'),
  ],
  library: [
    require('@/assets/village-world/motion/library/night-frame-0.png'),
    require('@/assets/village-world/motion/library/night-frame-1.png'),
    require('@/assets/village-world/motion/library/night-frame-2.png'),
    require('@/assets/village-world/motion/library/night-frame-3.png'),
  ],
  observatory: [
    require('@/assets/village-world/motion/observatory/night-frame-0.png'),
    require('@/assets/village-world/motion/observatory/night-frame-1.png'),
    require('@/assets/village-world/motion/observatory/night-frame-2.png'),
    require('@/assets/village-world/motion/observatory/night-frame-3.png'),
  ],
  shop: [
    require('@/assets/village-world/motion/shop/night-frame-0.png'),
    require('@/assets/village-world/motion/shop/night-frame-1.png'),
    require('@/assets/village-world/motion/shop/night-frame-2.png'),
    require('@/assets/village-world/motion/shop/night-frame-3.png'),
  ],
};

type View = Awaited<ReturnType<typeof render>>;
const sources = (view: View, prefix: string) =>
  [0, 1, 2, 3].map((index) => view.getByTestId(`${prefix}-${index}`).props.source);
const activeFrame = (view: View, prefix: string) =>
  [0, 1, 2, 3].find((index) =>
    [view.getByTestId(`${prefix}-${index}`).props.style]
      .flat(Infinity)
      .some((entry) => entry?.opacity === 1),
  );

describe('건물 모션 밤 프레임', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('night 이면 네 건물 모두 밤 프레임 네 장을 쓰고, 낮이면 낮 프레임을 쓴다', async () => {
    const cases = [
      [<VillageHallMotion night />, <VillageHallMotion />, 'village-hall-frame', nightFrames.hall],
      [<LibraryMotion night />, <LibraryMotion />, 'library-motion-frame', nightFrames.library],
      [
        <VillageObservatoryMotion night />,
        <VillageObservatoryMotion />,
        'village-observatory-frame',
        nightFrames.observatory,
      ],
      [<ShopMotion night />, <ShopMotion />, 'shop-motion-frame', nightFrames.shop],
    ] as const;
    for (const [nightElement, dayElement, prefix, expected] of cases) {
      const night = await render(nightElement);
      expect(sources(night, prefix)).toEqual(expected);
      await night.unmount();
      const day = await render(dayElement);
      sources(day, prefix).forEach((source, index) => expect(source).not.toBe(expected[index]));
      await day.unmount();
    }
  });

  it('밤에 회관에 진입하면 밤 프레임으로 문 열림 모션을 재생한다', async () => {
    const view = await render(<VillageHallMotion night state="arrival" />);
    expect(activeFrame(view, 'village-hall-frame')).toBe(0);
    await act(async () => jest.advanceTimersByTime(180));
    expect(activeFrame(view, 'village-hall-frame')).toBe(1);
    await act(async () => jest.advanceTimersByTime(360));
    expect(activeFrame(view, 'village-hall-frame')).toBe(3);
    expect(view.getByTestId('village-hall-frame-3').props.source).toBe(nightFrames.hall[3]);
    await view.unmount();
  });

  it('밤에 도서관에 진입하면 밤 프레임으로 이중문 모션을 재생한다', async () => {
    const view = await render(<LibraryMotion night entryActive trigger={0} />);
    await view.rerender(<LibraryMotion night entryActive trigger={1} />);
    await act(async () => jest.advanceTimersByTime(120));
    expect(activeFrame(view, 'library-motion-frame')).toBe(1);
    await act(async () => jest.advanceTimersByTime(240));
    // 진입 중에는 마지막(가장 넓게 열린) 밤 프레임에 머문다.
    expect(activeFrame(view, 'library-motion-frame')).toBe(3);
    expect(view.getByTestId('library-motion-frame-3').props.source).toBe(nightFrames.library[3]);
    await view.unmount();
  });
});
