import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

// 버튼 탭 효과음 재생기. 연출 보조 기능이라 실패해도 흐름에 영향이 없어야 한다 —
// utils/haptics.ts 와 같은 철학으로 모든 에러를 조용히 삼키고 fire-and-forget으로 쓴다.
//
// 무음 스위치 존중(요구사항): playsInSilentMode: false → iOS ambient 카테고리라
// 무음 스위치가 켜져 있으면 아예 소리가 나지 않는다.
// mixWithOthers: 사용자가 듣던 음악·팟캐스트를 끊지 않는다(집중 앱이라 특히 중요).

// 볼륨 — 에셋 자체가 -16dBFS로 합성돼 있고, 여기서 한 번 더 낮춰 시스템 키보드 소리보다 조용하게 둔다.
const TAP_VOLUME = 0.35;

let tapPlayer: AudioPlayer | null = null;
let preloaded = false;

/**
 * 탭 사운드 프리로드 — 앱 최초 로드 시 1회 호출한다(src/App.tsx).
 * 탭 시점에 플레이어를 만들면 첫 재생이 눈에 띄게 늦어서, 미리 만들어 두고 재사용한다.
 */
export function preloadTapSound(): void {
  if (preloaded) return;
  preloaded = true;
  try {
    // 오디오 세션을 먼저 잡아야 첫 재생이 의도한 카테고리로 나간다(무음 스위치 존중).
    setAudioModeAsync({
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    }).catch(() => {});
    tapPlayer = createAudioPlayer(require('@/assets/sounds/tap.wav'));
    tapPlayer.volume = TAP_VOLUME;
  } catch {
    // 네이티브 모듈 미탑재 등 — 소리 없이 동작하면 된다
    tapPlayer = null;
  }
}

/** 버튼 탭 효과음 1회 재생. 연타 시 처음으로 되감아 다시 튼다(겹쳐 울리지 않게). */
export function playTapSound(): void {
  // 프리로드를 못 탄 경로(테스트·핫리로드 등)에서도 첫 호출에 살아나도록 지연 초기화.
  if (!preloaded) preloadTapSound();
  const player = tapPlayer;
  if (!player) return;
  try {
    // 되감기가 끝난 뒤 재생 — 재생이 끝난 플레이어는 위치가 끝에 머물러 play()만으로는
    // 두 번째 탭에서 소리가 안 난다. 되감기/재생 순서를 native에 맡기지 않고 체이닝으로 확정한다
    // (추가 지연은 한 자릿수 ms라 체감되지 않는다).
    player
      .seekTo(0)
      .then(() => player.play())
      .catch(() => {});
  } catch {
    // 재생 실패는 무시
  }
}
