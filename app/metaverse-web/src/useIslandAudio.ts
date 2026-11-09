import { useCallback, useEffect, useRef, useState } from "react";
import { IslandAudio, type AudioSnapshot } from "./audio";

export function useIslandAudio(focusing: boolean) {
  const controller = useRef<IslandAudio | null>(null);
  const [snapshot, setSnapshot] = useState<AudioSnapshot>({
    enabled: true,
    volume: 0.35,
    state: "locked",
    mode: focusing ? "focus" : "ambient",
    error: null,
  });
  useEffect(() => {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      /* 비공개 브라우징에서도 동작한다. */
    }
    const audio = new IslandAudio({
      createContext: () => new AudioContext(),
      fetch: window.fetch.bind(window),
      storage,
    });
    controller.current = audio;
    audio.setFocusing(focusing);
    const sync = () => setSnapshot(audio.getSnapshot());
    const unsubscribe = audio.subscribe(sync);
    sync();
    return () => {
      unsubscribe();
      audio.dispose();
      controller.current = null;
    };
    // 모드 변화는 아래 effect에서 처리하고 오디오 연결은 마운트마다 한 번 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    controller.current?.setFocusing(focusing);
  }, [focusing]);
  const unlock = useCallback(() => {
    controller.current?.unlock();
  }, []);
  const toggle = useCallback(() => {
    controller.current?.toggle();
  }, []);
  const setVolume = useCallback((value: number) => {
    controller.current?.setVolume(value);
  }, []);
  return { ...snapshot, unlock, toggle, setVolume };
}
