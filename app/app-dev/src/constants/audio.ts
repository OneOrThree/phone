import { assets } from '@/constants/assets';

// 모든 섬에 구매 없이 제공하는 기본곡. 빗방울 소리는 별도 판매 정책을 유지한다.
export const DEFAULT_FREE_AUDIO_TRACK_IDS: readonly string[] = ['waves', 'campfire', 'forest-wind'];

export const BUNDLED_AUDIO_TRACK_IDS = ['waves', 'forest-wind', 'campfire', 'rain'] as const;

export function hasBundledAudio(trackId: string | null): trackId is string {
  return (
    trackId !== null &&
    BUNDLED_AUDIO_TRACK_IDS.includes(trackId as (typeof BUNDLED_AUDIO_TRACK_IDS)[number]) &&
    assets[`audio/${trackId}.wav`] !== undefined
  );
}

export function bundledAudioSource(trackId: string | null): number | null {
  return hasBundledAudio(trackId) ? (assets[`audio/${trackId}.wav`] as number) : null;
}
