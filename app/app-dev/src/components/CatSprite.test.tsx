import React, { Profiler } from 'react';
import { act, render } from '@testing-library/react-native';
import { Animated, AppState, Easing, StyleSheet } from 'react-native';
import { cat } from '@/constants/assets';
import { observeAnimatedOnJsDriver } from './animatedJsDriver.testing';
import { CAT_IDLE_ATLASES } from '@/constants/cat-idle-atlases';
import { CatSprite, catFrameBox } from './CatSprite';
import { CatOutfitLayers } from './CatOutfitLayers';
import {
  CAT_FRAME_DELAYS_MS,
  CAT_FRAME_SEQUENCES,
  IDLE_REST_DELAY_MS,
  interactiveMotionDurationMs,
} from './catMotion';

type SpriteView = Awaited<ReturnType<typeof render>>;

/** 셀 레이어는 모두 깔려 있고 opacity 로 하나만 보인다. 지금 보이는 레이어를 돌려준다. */
const shownFrame = (view: SpriteView) => {
  const shown = view
    .getAllByTestId(/^cat-frame-/)
    .filter((layer) => StyleSheet.flatten(layer.props.style).opacity > 0.5);
  expect(shown).toHaveLength(1);
  return shown[0];
};
const shownCell = (view: SpriteView) => Number(shownFrame(view).props.testID.slice(-1));
const advance = (ms: number) => act(async () => jest.advanceTimersByTime(ms));

// 장착 그림 레이어는 이 파일에서 받은 props 만 본다(GROMO-2382)
jest.mock('./CatOutfitLayers', () => ({ CatOutfitLayers: jest.fn(() => null) }));

describe('CatSprite 재생 제어', () => {
  let onAppStateChange: ((state: 'active' | 'background' | 'inactive') => void) | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    observeAnimatedOnJsDriver();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event, listener) => {
      onAppStateChange = listener as (state: 'active' | 'background' | 'inactive') => void;
      return { remove: jest.fn() };
    }) as typeof AppState.addEventListener);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('outfit 을 주면 셀마다 그 프레임·자세·고양이 상자 크기로 장착 레이어를 깔고, 보이는 셀을 따라간다', async () => {
    const outfit = { head: 'cust.head.mandarin' };
    const view = await render(
      <CatSprite color="black" motion="walk" size={100} outfit={outfit} testID="cat" />,
    );
    const extent = catFrameBox('black', 'walk', 100).extent;
    const poses = jest.mocked(CatOutfitLayers).mock.calls.map(([props]) => props.pose);
    for (const frame of CAT_FRAME_SEQUENCES.walk)
      expect(poses).toContainEqual({ color: 'black', motion: 'walk', frame, size: extent });
    const shownOutfit = () =>
      view
        .getAllByTestId(/^cat-outfit-/)
        .filter((layer) => StyleSheet.flatten(layer.props.style).opacity > 0.5)
        .map((layer) => Number(layer.props.testID.slice(-1)));
    expect(shownOutfit()).toEqual([0]);
    await advance(125);
    expect(shownCell(view)).toBe(1);
    expect(shownOutfit()).toEqual([1]);
    await view.unmount();
    jest.mocked(CatOutfitLayers).mockClear();
    await render(<CatSprite color="black" motion="walk" size={100} />);
    expect(CatOutfitLayers).not.toHaveBeenCalled();
  });

  it('걷기 프레임을 진행하고 color·motion 변경 시 첫 프레임으로 되돌린다', async () => {
    const view = await render(<CatSprite color="black" motion="walk" testID="cat" />);
    expect(shownFrame(view).props.source).toBe(cat('black', 'walking/walking-frame-0'));

    await advance(125);
    expect(shownFrame(view).props.source).toBe(cat('black', 'walking/walking-frame-1'));

    await view.rerender(<CatSprite color="ginger" motion="walk" testID="cat" />);
    await advance(0);
    expect(shownFrame(view).props.source).toBe(cat('ginger', 'walking/walking-frame-0'));

    await view.rerender(<CatSprite color="ginger" motion="yawn" testID="cat" />);
    await advance(320);
    expect(shownCell(view)).toBe(1);
    await view.rerender(<CatSprite color="ginger" motion="walk" testID="cat" />);
    expect(shownFrame(view).props.source).toBe(cat('ginger', 'walking/walking-frame-0'));
    await view.unmount();
  });

  it('프레임 전환은 네이티브 드라이버가 맡아 재생 중 React 커밋이 없다', async () => {
    // JS 드라이버 관찰을 풀고 실제 설정(네이티브 드라이버·선형)으로 돌린다.
    jest.mocked(Animated.timing).mockRestore();
    const timing = jest.spyOn(Animated, 'timing');
    const onRender = jest.fn();
    const view = await render(
      <Profiler id="cat" onRender={onRender}>
        <CatSprite color="black" motion="walk" testID="cat" />
      </Profiler>,
    );
    expect(timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        useNativeDriver: true,
        easing: Easing.linear,
        duration: 750,
        iterations: -1,
      }),
    );
    await advance(0);
    const commits = onRender.mock.calls.length;
    expect(commits).toBeGreaterThan(0);
    // 프레임마다 act 를 따로 닫아야 setState 타이머였다면 프레임마다 커밋이 잡힌다.
    for (let frame = 0; frame < 7; frame += 1) await advance(125);
    expect(onRender).toHaveBeenCalledTimes(commits);
    await view.unmount();
  });

  it('백그라운드와 reduceMotion에서는 재생을 멈추고 첫 프레임을 유지한다', async () => {
    const view = await render(<CatSprite color="black" motion="walk" testID="cat" />);
    await advance(300);
    await act(async () => onAppStateChange?.('background'));
    await advance(1_000);
    expect(shownCell(view)).toBe(0);

    await act(async () => onAppStateChange?.('active'));
    await view.rerender(<CatSprite color="black" motion="walk" reduceMotion testID="cat" />);
    await advance(1_000);
    expect(shownCell(view)).toBe(0);
    await view.unmount();
  });

  it('아틀라스는 strip을 뒤집지 않고 바깥 viewport만 반전한다', async () => {
    const view = await render(<CatSprite color="black" motion="yawn" left testID="cat" />);
    const rootStyle = view.getByTestId('cat').props.style;
    const imageStyle = StyleSheet.flatten(view.getByTestId('cat-frame-0').props.style);
    expect(rootStyle.transform[0]).toEqual({ scaleX: -1 });
    expect(imageStyle.transform).toBeUndefined();
    await view.unmount();
  });

  it('unmount 뒤에는 재생과 예약 타이머를 정리해 완료 콜백이 오지 않는다', async () => {
    const onFinish = jest.fn();
    const view = await render(
      <CatSprite color="black" motion="stretch" onFinish={onFinish} testID="cat" />,
    );
    await advance(500);
    await view.unmount();
    await advance(5_000);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('갸웃(tilt) 동작 시 프레임이 진행되고 물음표 표시가 함께 렌더링된다', async () => {
    const view = await render(<CatSprite color="ginger" motion="tilt" testID="cat" />);
    expect(shownFrame(view).props.source).toBe(cat('ginger', 'tilt/tilt-frame-0'));
    expect(view.getByTestId('cat-question')).toBeTruthy();

    await advance(260);
    expect(shownFrame(view).props.source).toBe(cat('ginger', 'tilt/tilt-frame-1'));

    await advance(260);
    expect(shownFrame(view).props.source).toBe(cat('ginger', 'tilt/tilt-frame-2'));
    await view.unmount();
  });

  it('동일한 모션이라도 generation이 갱신되면 재생이 처음부터 다시 시작된다', async () => {
    const onFinish = jest.fn();
    const view = await render(
      <CatSprite color="black" motion="stretch" onFinish={onFinish} generation={0} testID="cat" />,
    );
    await advance(360);
    expect(shownCell(view)).toBe(1);

    await view.rerender(
      <CatSprite color="black" motion="stretch" onFinish={onFinish} generation={1} testID="cat" />,
    );
    await advance(0);
    expect(shownCell(view)).toBe(0);
    await advance(359);
    expect(shownCell(view)).toBe(0);
    await advance(1);
    expect(shownCell(view)).toBe(1);
    await view.unmount();
  });

  it('상호작용 모션은 동작 프레임 완료 후 중립 프레임(0번)을 표시하고 onFinish를 호출한다', async () => {
    const onFinish = jest.fn();
    const view = await render(
      <CatSprite color="black" motion="stretch" onFinish={onFinish} testID="cat" />,
    );
    expect(shownCell(view)).toBe(0);
    await advance(360);
    expect(shownCell(view)).toBe(1);
    await advance(360);
    expect(shownCell(view)).toBe(2);
    await advance(360);
    expect(shownCell(view)).toBe(3);
    expect(onFinish).not.toHaveBeenCalled();

    // 1440ms: 중립 프레임(0번)으로 복귀하여 화면에 표시
    await advance(360);
    expect(shownCell(view)).toBe(0);
    expect(onFinish).not.toHaveBeenCalled();

    // 1800ms: 중립 프레임 1프레임 노출 완료 후 onFinish 호출
    await advance(359);
    expect(onFinish).not.toHaveBeenCalled();
    await advance(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('완료 콜백이 없는 상호작용 모션은 중립 프레임 뒤에도 같은 순서로 계속 반복한다', async () => {
    const view = await render(<CatSprite color="black" motion="tilt" testID="cat" />);
    const delay = CAT_FRAME_DELAYS_MS.tilt;
    const sequence = CAT_FRAME_SEQUENCES.tilt;
    const seen: number[] = [];
    for (let tick = 0; tick < sequence.length * 2; tick += 1) {
      await advance(tick === 0 ? delay / 2 : delay);
      seen.push(shownCell(view));
    }
    expect(seen).toEqual([...sequence, ...sequence]);
    await view.unmount();
  });

  it('cast는 네 프레임을 한 번 재생하고 중립 프레임에서 완료한다', async () => {
    const onFinish = jest.fn();
    const view = await render(
      <CatSprite color="black" motion="cast" onFinish={onFinish} testID="cat" />,
    );
    expect(shownFrame(view).props.source).toBe(cat('black', 'fishing/cast-frame-0'));

    for (let frame = 1; frame <= 3; frame += 1) {
      await advance(125);
      expect(shownFrame(view).props.source).toBe(cat('black', `fishing/cast-frame-${frame}`));
      expect(onFinish).not.toHaveBeenCalled();
    }

    await advance(125);
    expect(shownFrame(view).props.source).toBe(cat('black', 'fishing/cast-frame-0'));
    expect(onFinish).not.toHaveBeenCalled();
    await advance(125);
    expect(onFinish).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(shownCell(view)).toBe(0);
    await view.unmount();
  });

  it('keyPoses: focus 는 12초 중 3.1초·8.8초에만 표정을 바꾸고, reel 은 2초 안에 한 번 재생 후 멈춘다', async () => {
    const view = await render(<CatSprite color="gray" motion="focus" keyPoses testID="cat" />);
    const frameAt = async (ms: number) => {
      await advance(ms);
      return shownFrame(view).props.testID;
    };
    expect(await frameAt(3_099)).toBe('cat-frame-0');
    expect(await frameAt(1)).toBe('cat-frame-1');
    expect(await frameAt(160)).toBe('cat-frame-2');
    expect(await frameAt(220)).toBe('cat-frame-3');
    expect(await frameAt(160)).toBe('cat-frame-0');
    expect(await frameAt(5_159)).toBe('cat-frame-0');
    expect(await frameAt(1)).toBe('cat-frame-1');
    expect(await frameAt(6_299)).toBe('cat-frame-0');
    expect(await frameAt(1)).toBe('cat-frame-1'); // 12초 뒤 다시 3.1초
    expect(shownFrame(view).props.source).toBe(cat('gray', 'fishing/fishing-frame-1'));

    await view.rerender(<CatSprite color="gray" motion="reel" keyPoses testID="cat" />);
    await advance(0);
    expect(shownFrame(view).props.source).toBe(cat('gray', 'fishing/reel-frame-0'));
    const seen = [0];
    for (const hold of [456, 400, 267, 337]) {
      await advance(hold);
      seen.push(shownCell(view));
    }
    expect(seen).toEqual([0, 1, 2, 1, 3]);
    await advance(5_000);
    expect(shownCell(view)).toBe(3);

    await view.rerender(
      <CatSprite color="gray" motion="focus" keyPoses reduceMotion testID="cat" />,
    );
    await advance(12_000);
    expect(shownCell(view)).toBe(0);
    await view.unmount();
  });

  it('keyPoses reel 은 replayKey 가 바뀌면 같은 motion 이어도 처음 셀부터 다시 재생한다', async () => {
    const view = await render(
      <CatSprite color="gray" motion="reel" keyPoses replayKey={1} testID="cat" />,
    );
    await advance(1_500);
    expect(shownCell(view)).toBe(3);
    await view.rerender(
      <CatSprite color="gray" motion="reel" keyPoses replayKey={2} testID="cat" />,
    );
    await advance(0);
    expect(shownCell(view)).toBe(0);
    await advance(456);
    expect(shownCell(view)).toBe(1);
    await view.unmount();
  });

  it('Reduce Motion에서는 cast를 재생하지 않고 완료 콜백을 호출한다', async () => {
    const onFinish = jest.fn();
    const view = await render(
      <CatSprite color="black" motion="cast" reduceMotion onFinish={onFinish} testID="cat" />,
    );
    expect(shownFrame(view).props.source).toBe(cat('black', 'fishing/cast-frame-0'));
    await advance(0);
    expect(onFinish).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});

describe('CatSprite 프레임 시간표는 catMotion.ts 값과 같다', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    observeAnimatedOnJsDriver();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  /** 각 tick 의 경계 바로 앞(-1ms)과 경계(0ms)에서 보이는 셀을 읽는다. */
  const sampleTicks = async (view: SpriteView, delay: number, ticks: number) => {
    const before: number[] = [];
    const at: number[] = [];
    at.push(shownCell(view));
    for (let tick = 1; tick < ticks; tick += 1) {
      await advance(delay - 1);
      before.push(shownCell(view));
      await advance(1);
      at.push(shownCell(view));
    }
    return { before, at };
  };

  it.each(['walk', 'read'] as const)('%s 는 순서대로 무한 반복한다', async (motion) => {
    const sequence = CAT_FRAME_SEQUENCES[motion];
    const view = await render(<CatSprite color="cream" motion={motion} testID="cat" />);
    await advance(0);
    const { before, at } = await sampleTicks(
      view,
      CAT_FRAME_DELAYS_MS[motion],
      sequence.length * 2,
    );
    const expected = [...sequence, ...sequence];
    expect(at).toEqual(expected);
    // 경계 1ms 전에는 아직 이전 셀이다 — 프레임 간격이 정확히 CAT_FRAME_DELAYS_MS 다.
    expect(before).toEqual(expected.slice(0, -1));
    await view.unmount();
  });

  it.each(['tilt', 'yawn', 'stretch', 'groom'] as const)(
    '%s 는 사이클 수만큼 재생하고 interactiveMotionDurationMs 에 완료한다',
    async (motion) => {
      const onFinish = jest.fn();
      const sequence = CAT_FRAME_SEQUENCES[motion];
      const delay = CAT_FRAME_DELAYS_MS[motion];
      const view = await render(
        <CatSprite color="white" motion={motion} onFinish={onFinish} testID="cat" />,
      );
      await advance(0);
      const ticks = interactiveMotionDurationMs(motion) / delay; // 동작 프레임 + 중립 1프레임
      const { at } = await sampleTicks(view, delay, ticks);
      expect(at).toEqual(
        Array.from({ length: ticks }, (_, tick) => sequence[tick % sequence.length]),
      );
      expect(at[at.length - 1]).toBe(0);
      await advance(delay - 1);
      expect(onFinish).not.toHaveBeenCalled();
      await advance(1);
      expect(onFinish).toHaveBeenCalledTimes(1);
      await view.unmount();
    },
  );

  it('blink 는 휴식 3.2초 뒤 90ms 간격 깜박임을 반복한다', async () => {
    const view = await render(<CatSprite color="black" motion="blink" testID="cat" />);
    for (let round = 0; round < 2; round += 1) {
      await advance(IDLE_REST_DELAY_MS - 1);
      expect(shownCell(view)).toBe(0);
      await advance(1);
      const { at } = await sampleTicks(
        view,
        CAT_FRAME_DELAYS_MS.blink,
        CAT_FRAME_SEQUENCES.blink.length,
      );
      expect(at).toEqual(CAT_FRAME_SEQUENCES.blink);
      await advance(CAT_FRAME_DELAYS_MS.blink);
      expect(shownCell(view)).toBe(0);
    }
    await view.unmount();
  });

  it('idle 은 첫 동작을 깜박임으로 하고, 다음 동작은 그 동작의 간격으로 재생한 뒤 쉰다', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99); // nextIdleBehavior → groom
    const view = await render(<CatSprite color="black" motion="idle" testID="cat" />);
    await advance(IDLE_REST_DELAY_MS);
    const blink = await sampleTicks(
      view,
      CAT_FRAME_DELAYS_MS.blink,
      CAT_FRAME_SEQUENCES.blink.length,
    );
    expect(blink.at).toEqual(CAT_FRAME_SEQUENCES.blink);
    await advance(CAT_FRAME_DELAYS_MS.blink);

    await advance(IDLE_REST_DELAY_MS - 1);
    expect(shownFrame(view).props.source).toBe(cat('black', 'blink/blink-frame-0'));
    await advance(1);
    expect(shownFrame(view).props.source).toBe(CAT_IDLE_ATLASES.black);
    const groom = await sampleTicks(
      view,
      CAT_FRAME_DELAYS_MS.groom,
      CAT_FRAME_SEQUENCES.groom.length,
    );
    expect(groom.at).toEqual(CAT_FRAME_SEQUENCES.groom);

    // 동작이 끝나면 깜박임 0번으로 돌아와 다시 쉰다.
    await advance(CAT_FRAME_DELAYS_MS.groom);
    expect(shownFrame(view).props.source).toBe(cat('black', 'blink/blink-frame-0'));
    await view.unmount();
  });
});
