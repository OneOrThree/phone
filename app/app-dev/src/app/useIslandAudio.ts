import { bundledAudioSource } from '@/constants/audio';
import type { SoundPlayer } from '@/hooks/useSoundPlayer';
import type { Island, Route, State } from '@/services/model';
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
interface Input {
  island: Island;
  state: Pick<State, 'settings'>;
  route: Route;
  previewAudio: boolean;
  setPreviewAudio: Dispatch<SetStateAction<boolean>>;
  player: SoundPlayer;
  islandAudioOn: boolean;
}
export function useIslandAudio({
  island,
  state,
  route,
  previewAudio,
  setPreviewAudio,
  player,
  islandAudioOn,
}: Input) {
  const islandAudioOnRef = useRef(islandAudioOn);

  islandAudioOnRef.current = islandAudioOn;

  // 곡 로드는 곡·섬이 바뀔 때만 한다. 재생/정지는 아래 volume effect가 islandAudioOn으로 따로 다루므로
  // 일시정지 뒤 재개하거나 다른 멤버가 재생 상태만 바꿔도 곡을 처음으로 되감지 않는다
  useEffect(() => {
    if (previewAudio) return;
    let cancelled = false;
    try {
      const source = bundledAudioSource(island.track);
      if (source === null) {
        player.pause();
        return;
      }
      player.replace(source);
      player.loop = true;
      // 같은 섬은 같은 곡만 공유한다. 재생 지점은 기기마다 처음부터 돌고 서버 위치에 맞추지 않는다
      Promise.resolve(player.seekTo(0))
        .then(() => {
          if (cancelled) return;
          if (islandAudioOnRef.current) player.play();
          else player.pause();
        })
        .catch(() => {});
    } catch {}
    return () => {
      cancelled = true;
    };
  }, [island.track, island.id, previewAudio]);

  useEffect(() => {
    if (!island.playbackReset) return;
    try {
      player.pause();
      player.seekTo(0).catch(() => {});
    } catch {}
  }, [island.id, island.playbackReset]);

  useEffect(() => {
    if (route !== 'product' || !islandAudioOn) setPreviewAudio(false);
  }, [route, islandAudioOn]);

  useEffect(() => {
    try {
      player.volume = state.settings.sound ? (state.settings.volume ?? 0.55) : 0;
      islandAudioOn ? player.play() : player.pause();
    } catch {}
  }, [islandAudioOn, state.settings.sound, state.settings.volume]);
}
