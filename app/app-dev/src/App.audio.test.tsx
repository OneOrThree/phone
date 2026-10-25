import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer } from 'expo-audio';
import App from '@/App';
import { assets } from '@/constants/assets';
import { clearSession } from '@/services/api/session';
import { currentIsland, initialState, type State } from '@/services/model';

let captured: any;
let playing = false;
const audio = {
  replace: jest.fn(),
  play: jest.fn(() => {
    playing = true;
  }),
  pause: jest.fn(() => {
    playing = false;
  }),
  seekTo: jest.fn(() => Promise.resolve()),
  addListener: jest.fn(() => ({ remove() {} })),
  volume: 1,
  loop: false,
};

jest.mock('@/screens/island/CurrentScreens', () => ({
  CurrentScreens: ({ e }: any) => {
    captured = e;
    return null;
  },
}));
jest.mock('@/services/api/auth', () => ({
  checkSession: async () => ({ status: 'offline' }),
  logout: async () => {},
}));
jest.mock('@/services/islandBoot', () => ({ decideBootRoute: async () => 'login' }));
jest.mock('@/services/api/session', () => ({
  ...jest.requireActual('@/services/api/session'),
  restoreSession: async () => null,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

beforeEach(async () => {
  captured = undefined;
  playing = false;
  jest.clearAllMocks();
  audio.seekTo.mockReset().mockResolvedValue(undefined);
  (useAudioPlayer as jest.Mock).mockReturnValue(audio);
  await clearSession();
  await AsyncStorage.clear();
});

function fixture(status: 'active' | 'paused' | null = null): State {
  const state = initialState(true);
  state.settings.reduceMotion = true;
  const island = currentIsland(state);
  island.track = 'waves';
  island.playing = true;
  if (status)
    state.session = {
      id: 'audio-session',
      islandId: island.id,
      subject: '집중',
      startedAt: Date.now(),
      seconds: 0,
      status,
      ...(status === 'paused' ? { restStartedAt: Date.now() } : {}),
    };
  return state;
}

async function mount(state = fixture()) {
  const app = await render(<App />);
  await waitFor(() => expect(captured).toBeDefined());
  await act(async () => {
    captured.dispatch({ type: 'LOAD', state });
    captured.reset('sound');
  });
  return app;
}

test.each([null, 'paused'] as const)(
  '세션 상태 %s에서는 축음기와 미리듣기가 재생하지 않는다',
  async (status) => {
    await mount(fixture(status));
    expect(captured.route).toBe('sound');
    expect(playing).toBe(false);
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.replace).not.toHaveBeenCalled();
    expect(captured.player.play()).toBe(false);
  },
);

test.each(['sound', 'volume'] as const)(
  '집중 중 %s를 끄면 정지하고 다시 켜면 같은 위치에서 재개한다',
  async (key) => {
    await mount(fixture('active'));
    expect(playing).toBe(true);
    audio.play.mockClear();
    audio.replace.mockClear();
    audio.seekTo.mockClear();
    await act(async () =>
      captured.dispatch({ type: 'SETTING', key, value: key === 'sound' ? false : 0 }),
    );
    expect(playing).toBe(false);
    expect(audio.play).not.toHaveBeenCalled();
    expect(currentIsland(captured.state).playing).toBe(true);
    await act(async () =>
      captured.dispatch({ type: 'SETTING', key, value: key === 'sound' ? true : 0.55 }),
    );
    expect(playing).toBe(true);
    expect(audio.replace).not.toHaveBeenCalled();
    expect(audio.seekTo).not.toHaveBeenCalled();
  },
);

test('휴식·집중 종료 뒤에는 축음기와 홈을 오가도 소리가 다시 나지 않는다', async () => {
  await mount(fixture('active'));
  expect(playing).toBe(true);
  await act(async () => captured.dispatch({ type: 'PAUSE' }));
  expect(playing).toBe(false);
  audio.play.mockClear();
  await act(async () => {
    captured.dispatch({ type: 'SESSION_SYNC', session: null });
    captured.reset('home');
  });
  await act(async () => captured.reset('sound'));
  expect(audio.play).not.toHaveBeenCalled();
  expect(currentIsland(captured.state).playing).toBe(true);
});

test.each(['pause', 'finish', 'mute'] as const)(
  '곡 교체 중 %s 뒤 늦게 끝난 seek가 재생을 되살리지 않는다',
  async (change) => {
    await mount(fixture('active'));
    let complete!: () => void;
    audio.seekTo.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    await act(async () => captured.dispatch({ type: 'TRACK', value: 'campfire' }));
    expect(audio.replace).toHaveBeenLastCalledWith(assets['audio/campfire.wav']);
    await act(async () =>
      captured.dispatch(
        change === 'pause'
          ? { type: 'PAUSE' }
          : change === 'finish'
            ? { type: 'SESSION_SYNC', session: null }
            : { type: 'SETTING', key: 'sound', value: false },
      ),
    );
    audio.play.mockClear();
    await act(async () => complete());
    expect(playing).toBe(false);
    expect(audio.play).not.toHaveBeenCalled();
  },
);

test.each(['muted', 'zero-volume', 'shared-stop'] as const)(
  '집중을 복구해도 %s이면 처음부터 재생하지 않는다',
  async (condition) => {
    const state = fixture('active');
    if (condition === 'muted') state.settings.sound = false;
    if (condition === 'zero-volume') state.settings.volume = 0;
    if (condition === 'shared-stop') currentIsland(state).playing = false;
    await mount(state);
    expect(playing).toBe(false);
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.replace).not.toHaveBeenCalled();
  },
);

test.each([null, 'unknown-track'])(
  '유효한 공용 곡이 없으면 %s 기본 파도를 대신 재생하지 않는다',
  async (track) => {
    const state = fixture('active');
    currentIsland(state).track = track;
    await mount(state);
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.replace).not.toHaveBeenCalled();
  },
);

test('집중 밖에서 공용 곡 변경을 받아도 재생하지 않고 집중을 시작하면 최신 곡을 듣는다', async () => {
  await mount();
  await act(async () => captured.dispatch({ type: 'TRACK', value: 'campfire' }));
  expect(audio.play).not.toHaveBeenCalled();
  await act(async () => captured.dispatch({ type: 'START', subject: '집중' }));
  expect(playing).toBe(true);
  expect(audio.replace).toHaveBeenLastCalledWith(assets['audio/campfire.wav']);
});
