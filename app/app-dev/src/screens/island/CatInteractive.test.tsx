import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initialState } from '@/services/model';
import { FinalIsland } from './WorldMap';

jest.mock('@/components/CatSprite', () => {
  const React = require('react');
  const { View } = require('react-native');
  const catMotion = jest.requireActual('@/components/catMotion');
  return {
    ...catMotion,
    CatSprite: ({
      testID,
      motion,
      left,
      onFinish,
      generation,
    }: {
      testID?: string;
      motion: string;
      left?: boolean;
      onFinish?: () => void;
      generation?: number;
    }) => {
      React.useEffect(() => {
        if (!onFinish || !motion || motion === 'idle' || motion === 'walking') return;
        const duration = catMotion.interactiveMotionDurationMs(motion);
        const timer = setTimeout(onFinish, duration);
        return () => clearTimeout(timer);
      }, [motion, generation, onFinish]);
      return React.createElement(View, {
        testID: testID ?? 'mock-cat-sprite',
        testPropMotion: motion,
        testPropLeft: left,
        testPropGeneration: generation,
        onFinish,
      });
    },
    catFrameBox: () => ({ extent: 140, x: 70, y: 70 }),
  };
});

describe('고양이 터치 인터랙션, 좌우 방향 및 다중 모션 검증', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const renderWithContext = (ui: React.ReactElement) =>
    render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        {ui}
      </SafeAreaProvider>,
    );

  it('FinalIsland에서 왼쪽 터치 시 왼쪽을 보며 갸웃(tilt), 오른쪽 터치 시 오른쪽을 보며 기지개(stretch)를 켠다', async () => {
    const state = initialState(true);
    const screen = await renderWithContext(
      React.createElement(FinalIsland, {
        state,
        go: jest.fn(),
        build: jest.fn(),
      }),
    );

    const catActor = screen.getByTestId('home-cat-actor');
    const getCat = () => screen.getByTestId('home-cat-sprite').props;

    expect(getCat().testPropMotion).toBe('idle');

    // 1. 왼쪽 터치 (locationX: 10 < 35)
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 10 } });
    });
    expect(getCat().testPropLeft).toBe(true);
    expect(getCat().testPropMotion).toBe('tilt');

    // 타이머 만료 후 idle 복귀 및 탭 카운트 리셋
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(getCat().testPropMotion).toBe('idle');

    // 2. 오른쪽 터치 (locationX: 50 >= 35)
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 50 } });
    });
    expect(getCat().testPropLeft).toBe(false);
    expect(getCat().testPropMotion).toBe('stretch');

    await screen.unmount();
  });

  it('다른 주민 고양이를 누르면 정보창이 뜨고(GROMO-2474), 내 고양이는 정보창 없이 기존 모션 반응이다', async () => {
    const state = initialState(true);
    const screen = await renderWithContext(
      React.createElement(FinalIsland, { state, go: jest.fn(), build: jest.fn() }),
    );
    // 목업 섬 주민(민지·두부)은 신원이 있어 누를 수 있다
    await act(async () => {
      fireEvent.press(screen.getByLabelText('민지 정보 보기'));
    });
    expect(screen.getByTestId('cat-info-name')).toHaveTextContent('민지');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('닫기'));
    });
    expect(screen.queryByTestId('cat-info-name')).toBeNull();
    await act(async () => {
      fireEvent(screen.getByTestId('home-cat-actor'), 'press', { nativeEvent: { locationX: 10 } });
    });
    expect(screen.queryByTestId('cat-info-name')).toBeNull();
    expect(screen.getByTestId('home-cat-sprite').props.testPropMotion).toBe('tilt');
    await screen.unmount();
  });

  it('연속 터치 시 다양한 모션(그루밍, 기지개, 하품 등)이 순환 발동된다', async () => {
    const state = initialState(true);
    const screen = await renderWithContext(
      React.createElement(FinalIsland, {
        state,
        go: jest.fn(),
        build: jest.fn(),
      }),
    );

    const catActor = screen.getByTestId('home-cat-actor');
    const getMotion = () => screen.getByTestId('home-cat-sprite').props.testPropMotion;

    // 1회 탭: tilt
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 10 } });
    });
    expect(getMotion()).toBe('tilt');

    // 2회 연속 탭: groom
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 10 } });
    });
    expect(getMotion()).toBe('groom');

    // 3회 연속 탭: stretch
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 10 } });
    });
    expect(getMotion()).toBe('stretch');

    // 4회 연속 탭: yawn
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 10 } });
    });
    expect(getMotion()).toBe('yawn');

    await screen.unmount();
  });

  it('모션이 동작 프레임과 중립 복귀 프레임 노출을 모두 마친 뒤 종료된다', async () => {
    const state = initialState(true);
    const screen = await renderWithContext(
      React.createElement(FinalIsland, {
        state,
        go: jest.fn(),
        build: jest.fn(),
      }),
    );

    const catActor = screen.getByTestId('home-cat-actor');
    const getCat = () => screen.getByTestId('home-cat-sprite').props;

    // 오른쪽 터치: stretch (4프레임 동작 + 1프레임 중립 = 5프레임 * 360ms = 1800ms)
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 50 } });
    });
    expect(getCat().testPropMotion).toBe('stretch');

    // 1780ms 시점에는 중립 복귀 프레임 유지 중
    await act(async () => {
      jest.advanceTimersByTime(1780);
    });
    expect(getCat().testPropMotion).toBe('stretch');

    // 1800ms 경과 후 정확히 idle 복귀
    await act(async () => {
      jest.advanceTimersByTime(25);
    });
    expect(getCat().testPropMotion).toBe('idle');

    await screen.unmount();
  });

  it('동일한 모션을 연속 선택해도 generation이 갱신되어 재생이 처음부터 다시 시작된다', async () => {
    const state = initialState(true);
    const screen = await renderWithContext(
      React.createElement(FinalIsland, {
        state,
        go: jest.fn(),
        build: jest.fn(),
      }),
    );

    const catActor = screen.getByTestId('home-cat-actor');
    const getCat = () => screen.getByTestId('home-cat-sprite').props;

    // 1회: 왼쪽 터치 -> tilt (generation: 1)
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 10 } });
    });
    expect(getCat().testPropMotion).toBe('tilt');
    expect(getCat().testPropGeneration).toBe(1);

    // 1000ms 경과 (tilt 총 1820ms 중 중간 진행)
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(getCat().testPropMotion).toBe('tilt');

    // 2회: 오른쪽 터치 -> count 1에 의해 오른쪽 사이클에서도 동일하게 tilt 선택 (generation: 2)
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 50 } });
    });
    expect(getCat().testPropMotion).toBe('tilt');
    expect(getCat().testPropGeneration).toBe(2);

    // 첫 번째 시작 시각 기준 1820ms(앞으로 820ms 뒤)에 조기 종료되지 않고 여전히 tilt 유지
    await act(async () => {
      jest.advanceTimersByTime(820);
    });
    expect(getCat().testPropMotion).toBe('tilt');

    // 두 번째 탭 시점으로부터 온전히 1820ms가 경과한 시점(추가 1010ms 뒤)에 idle 복귀
    await act(async () => {
      jest.advanceTimersByTime(1010);
    });
    expect(getCat().testPropMotion).toBe('idle');

    await screen.unmount();
  });

  it('FinalIsland에서 부모 뷰와 액터 모두 실제 레이아웃으로 최소 44pt 터치 영역을 보장한다', async () => {
    const state = initialState(true);
    const screen = await renderWithContext(
      React.createElement(FinalIsland, {
        state,
        go: jest.fn(),
        build: jest.fn(),
      }),
    );

    const homeContainer = screen.getByTestId('home-cat-container');
    const homeCat = screen.getByTestId('home-cat-actor');
    expect(homeContainer.props.style.width).toBeGreaterThanOrEqual(44);
    expect(homeContainer.props.style.height).toBeGreaterThanOrEqual(44);
    expect(homeCat.props.style.width).toBeGreaterThanOrEqual(44);
    expect(homeCat.props.style.height).toBeGreaterThanOrEqual(44);
    await screen.unmount();
  });

  it('낚시섬 구경하기는 갸웃 모션을 기다리지 않고 바로 화면을 전환한다', async () => {
    const state = initialState(true);
    const goMock = jest.fn();
    const screen = await renderWithContext(
      React.createElement(FinalIsland, {
        state,
        go: goMock,
        build: jest.fn(),
      }),
    );

    const fishingDoor = screen.getByLabelText('낚시섬 구경하기');
    await act(async () => {
      fireEvent(fishingDoor, 'press');
    });

    expect(goMock).toHaveBeenCalledWith('focusVisit');
    expect(goMock).toHaveBeenCalledTimes(1);

    // 이전 갸웃 모션 길이가 지나도 뒤늦게 한 번 더 이동하지 않는다
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(goMock).toHaveBeenCalledTimes(1);

    await screen.unmount();
  });

  it('reduceMotion 활성화 시 건물 진입 모션 지연 없이 즉시 화면이 전환된다', async () => {
    const state = initialState(true);
    state.settings.reduceMotion = true;
    const goMock = jest.fn();
    const screen = await renderWithContext(
      React.createElement(FinalIsland, {
        state,
        go: goMock,
        build: jest.fn(),
      }),
    );

    const fishingDoor = screen.getByLabelText('낚시섬 구경하기');
    await act(async () => {
      fireEvent(fishingDoor, 'press');
    });

    expect(goMock).toHaveBeenCalledWith('focusVisit');
    await screen.unmount();
  });
});
