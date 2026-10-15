import { useEffect, useRef } from 'react';
import { Image, Platform } from 'react-native';
import { useAudioPlayer } from 'expo-audio';
import { assets } from '@/constants/assets';
// Browsers reject an in-flight play() promise when a quick track change pauses it.
// Handle that expected cancellation here; native playback uses Expo Audio directly.
export function useSoundPlayer(onError: (message: string) => void) {
  const native = useAudioPlayer(assets['audio/waves.wav'] as number);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const web = useRef<{ element: HTMLAudioElement; player: any } | null>(null);
  if (Platform.OS === 'web' && !web.current) {
    const el = new Audio();
    el.preload = 'auto';
    web.current = {
      element: el,
      player: {
        replace(source: any) {
          el.pause();
          el.src =
            typeof source === 'string' ? source : (Image.resolveAssetSource(source)?.uri ?? '');
          el.load();
        },
        play() {
          el.play().catch((e: DOMException) => {
            if (e.name !== 'AbortError' && e.name !== 'NotAllowedError')
              errorRef.current('음원을 불러오지 못했어요. 다시 선택해 주세요.');
          });
        },
        pause() {
          el.pause();
        },
        seekTo(seconds: number) {
          el.currentTime = Math.max(0, seconds);
          return Promise.resolve();
        },
        get volume() {
          return el.volume;
        },
        set volume(v: number) {
          el.volume = v;
        },
        get loop() {
          return el.loop;
        },
        set loop(v: boolean) {
          el.loop = v;
        },
        // expo-audio와 같은 모양: 곡이 끝나면 didJustFinish
        addListener(event: string, cb: (status: { didJustFinish: boolean }) => void) {
          const onEnded = () => cb({ didJustFinish: true });
          if (event === 'playbackStatusUpdate') el.addEventListener('ended', onEnded);
          return { remove: () => el.removeEventListener('ended', onEnded) };
        },
      },
    };
  }
  useEffect(
    () => () => {
      if (web.current) {
        web.current.element.pause();
        web.current.element.removeAttribute('src');
        web.current.element.load();
      }
    },
    [],
  );
  return Platform.OS === 'web' ? web.current!.player : native;
}
