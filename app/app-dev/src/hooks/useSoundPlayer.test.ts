import { renderHook } from '@testing-library/react-native';
import { useAudioPlayer } from 'expo-audio';
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
  const { result } = await renderHook(() => useSoundPlayer(jest.fn()));
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
  const { result } = await renderHook(() => useSoundPlayer(jest.fn()));
  result.current.play();
  expect(audio.replace).toHaveBeenCalledWith(assets['audio/waves.wav']);
});
