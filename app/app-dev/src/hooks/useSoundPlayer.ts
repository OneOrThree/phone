import { useEffect, useMemo, useRef } from 'react';
import { Image, Platform } from 'react-native';
import { useAudioPlayer, type AudioSource, type AudioStatus } from 'expo-audio';
import { assets } from '@/constants/assets';
// Browsers reject an in-flight play() promise when a quick track change pauses it.
// Handle that expected cancellation here; native playback uses Expo Audio directly.
export function useSoundPlayer(onError: (message: string) => void, playbackAllowed: boolean) {
  // 미리듣기와 늦게 끝난 seek 콜백도 호출 시점의 집중·음소거 조건을 따른다.
  const allowedRef = useRef(playbackAllowed);
  allowedRef.current = playbackAllowed;
  // 앱 시작 때 음원 파일을 열지 않도록 빈 플레이어로 만들고, 첫 play() 때 음원을 넣는다(GROMO-2376)
  const audio = useAudioPlayer(null);
  const native = useMemo(() => {
    // 첫 재생 전의 replace 는 음원만 기억한다. 아무것도 고르지 않았으면 예전 초기 음원(파도)으로 시작한다
    let pending: AudioSource = assets['audio/waves.wav'] as number;
    let started = false;
    return {
      get playbackAllowed() {
        return allowedRef.current;
      },
      replace(source: AudioSource) {
        if (started) {
          // expo-audio는 재생 중 교체하면 onReady에서 스스로 재개한다.
          // 먼저 멈춰 로딩 중 음소거·휴식으로 바뀌어도 그 콜백이 재생을 되살리지 않게 한다.
          audio.pause();
          audio.replace(source);
        } else pending = source;
      },
      play() {
        if (!allowedRef.current) return false;
        if (!started) {
          started = true;
          audio.replace(pending);
        }
        audio.play();
        return true;
      },
      pause() {
        audio.pause();
      },
      // 음원을 넣기 전에는 되감을 것이 없다(첫 재생은 처음부터 시작한다)
      seekTo(seconds: number) {
        return started ? audio.seekTo(seconds) : Promise.resolve();
      },
      get volume() {
        return audio.volume;
      },
      set volume(v: number) {
        audio.volume = v;
      },
      get loop() {
        return audio.loop;
      },
      set loop(v: boolean) {
        audio.loop = v;
      },
      addListener(event: 'playbackStatusUpdate', cb: (status: AudioStatus) => void) {
        return audio.addListener(event, cb);
      },
    };
  }, [audio]);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const web = useRef<{ element: HTMLAudioElement; player: any } | null>(null);
  if (Platform.OS === 'web' && !web.current) {
    const el = new Audio();
    el.preload = 'auto';
    web.current = {
      element: el,
      player: {
        get playbackAllowed() {
          return allowedRef.current;
        },
        replace(source: any) {
          el.pause();
          el.src =
            typeof source === 'string' ? source : (Image.resolveAssetSource(source)?.uri ?? '');
          el.load();
        },
        play() {
          if (!allowedRef.current) return false;
          el.play().catch((e: DOMException) => {
            if (e.name !== 'AbortError' && e.name !== 'NotAllowedError')
              errorRef.current('음원을 불러오지 못했어요. 다시 선택해 주세요.');
          });
          return true;
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
  useEffect(() => {
    if (!playbackAllowed) {
      if (Platform.OS === 'web') web.current!.player.pause();
      else native.pause();
    }
  }, [playbackAllowed, native]);
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
