import { renderHook } from '@testing-library/react-native';
import { useAudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';
import { assets } from '@/constants/assets';
import { useSoundPlayer } from '@/hooks/useSoundPlayer';

const audio = {
  replace: jest.fn(),
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(() => Promise.resolve()),
  addListener: jest.fn(),
  volume: 1,
  loop: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  (useAudioPlayer as jest.Mock).mockReturnValue(audio);
});

it('시작 때는 음원 없이 만들고, 고른 음원은 첫 재생 때 넣는다', async () => {
  const { result } = await renderHook(() => useSoundPlayer(jest.fn(), true));
  const player = result.current;
  expect(useAudioPlayer).toHaveBeenCalledWith(null);

  player.replace(assets['audio/rain.wav']);
  player.loop = true;
  await player.seekTo(0);
  expect(audio.replace).not.toHaveBeenCalled();
  expect(audio.seekTo).not.toHaveBeenCalled();
  expect(audio.loop).toBe(true);

  player.play();
  expect(audio.replace).toHaveBeenCalledWith(assets['audio/rain.wav']);
  expect(audio.play).toHaveBeenCalledTimes(1);

  // 첫 재생 뒤에는 그대로 전달한다
  player.replace(assets['audio/campfire.wav']);
  await player.seekTo(0);
  expect(audio.replace).toHaveBeenLastCalledWith(assets['audio/campfire.wav']);
  expect(audio.seekTo).toHaveBeenCalledWith(0);
});

it('고른 음원 없이 재생하면 예전 초기 음원(파도)으로 시작한다', async () => {
  const { result } = await renderHook(() => useSoundPlayer(jest.fn(), true));
  result.current.play();
  expect(audio.replace).toHaveBeenCalledWith(assets['audio/waves.wav']);
});

it('네이티브 곡 교체 전에 멈춰 SDK의 로딩 완료 자동 재개를 막는다', async () => {
  const { result, rerender } = await renderHook(
    ({ allowed }: { allowed: boolean }) => useSoundPlayer(jest.fn(), allowed),
    { initialProps: { allowed: true } },
  );
  let nativePlaying = true;
  let resumeWhenReady: (() => void) | undefined;
  result.current.play();
  audio.pause.mockImplementationOnce(() => {
    nativePlaying = false;
  });
  audio.replace.mockImplementationOnce(() => {
    // SDK는 replace 시점에 재생 중이었으면 나중에 JS의 play를 거치지 않고 재개한다.
    if (nativePlaying)
      resumeWhenReady = () => {
        nativePlaying = true;
      };
  });
  result.current.replace(assets['audio/rain.wav']);
  await rerender({ allowed: false });
  resumeWhenReady?.();
  expect(nativePlaying).toBe(false);
  expect(resumeWhenReady).toBeUndefined();
});

describe.each(['ios', 'web'] as const)('%s 재생 제한', (os) => {
  const originalOS = Platform.OS;
  const originalAudio = globalThis.Audio;
  const webAudio = {
    play: jest.fn(() => Promise.resolve()),
    pause: jest.fn(),
    load: jest.fn(),
    removeAttribute: jest.fn(),
    volume: 1,
  };

  beforeEach(() => {
    Platform.OS = os;
    globalThis.Audio = jest.fn(() => webAudio) as unknown as typeof Audio;
  });
  afterEach(() => {
    Platform.OS = originalOS;
    globalThis.Audio = originalAudio;
  });

  it('재생이 금지되면 음원을 열지 않고 직접 미리듣기도 막는다', async () => {
    const { result } = await renderHook(() => useSoundPlayer(jest.fn(), false));
    expect(result.current.play()).toBe(false);
    expect(audio.replace).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
    expect(webAudio.play).not.toHaveBeenCalled();
  });

  it('재생 중 허용이 취소되면 멈추고 이전 플레이어 참조의 재생도 막는다', async () => {
    const { result, rerender } = await renderHook(
      ({ allowed }: { allowed: boolean }) => useSoundPlayer(jest.fn(), allowed),
      { initialProps: { allowed: true } },
    );
    const player = result.current;
    const target = os === 'web' ? webAudio : audio;
    expect(player.play()).toBe(true);
    target.play.mockClear();
    target.pause.mockClear();

    await rerender({ allowed: false });
    expect(target.pause).toHaveBeenCalled();
    expect(player.play()).toBe(false);
    expect(target.play).not.toHaveBeenCalled();

    await rerender({ allowed: true });
    expect(player.play()).toBe(true);
    expect(target.play).toHaveBeenCalledTimes(1);
  });
});
