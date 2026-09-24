import { assets } from '@/constants/assets';

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
