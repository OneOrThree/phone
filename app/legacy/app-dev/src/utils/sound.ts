import type { AudioPlayer } from 'expo-audio';

// 버튼 탭 효과음 재생기. 연출 보조 기능이라 실패해도 흐름에 영향이 없어야 한다 —
// utils/haptics.ts 와 같은 철학으로 모든 에러를 조용히 삼키고 fire-and-forget으로 쓴다.
//
// ⚠️ expo-audio는 네이티브 모듈이다 — 이 JS를 expo-audio가 없는 구 바이너리에 OTA로
// 내보내면 크래시한다. hot-updater가 appVersion 전략이라 **네이티브 버전을 올려야**
// 구/신 바이너리를 구분해 타기팅할 수 있어서, 이 기능과 함께 앱 버전을 1.0.0 → 1.0.1로
// 올렸다(app.config.js·iOS MARKETING_VERSION·Android versionName). 1.0.0 대상 OTA로는
// 이 번들을 내보내지 말 것.
// 그래도 최후 방어로 expo-audio를 최상위 import가 아닌 **지연 require**로 잡는다 —
// 모듈이 없으면 import 시점 부팅 크래시 대신 "소리만 안 나는 상태"로 격하된다.
//
// 무음 스위치 존중(요구사항): playsInSilentMode: false → iOS ambient 카테고리라
// 무음 스위치가 켜져 있으면 아예 소리가 나지 않는다.
// mixWithOthers: 사용자가 듣던 음악·팟캐스트를 끊지 않는다(집중 앱이라 특히 중요).

// 볼륨 — 에셋 자체가 -16dBFS로 합성돼 있고, 여기서 한 번 더 낮춰 시스템 키보드 소리보다 조용하게 둔다.
const TAP_VOLUME = 0.35;

// 프리로드 재시도 상한 — 일시적 실패(세션 경합·메모리 압박)는 복구하되, 매 탭 재시도 폭주는 막는다.
const MAX_PRELOAD_ATTEMPTS = 3;

type ExpoAudio = typeof import('expo-audio');

let audioModule: ExpoAudio | null = null;
let audioModuleMissing = false;

/** expo-audio 지연 로드 — 네이티브 모듈이 없으면 null(=무음)로 격하하고 다시 시도하지 않는다. */
function loadAudio(): ExpoAudio | null {
  if (audioModule) return audioModule;
  if (audioModuleMissing) return null;
  try {
    audioModule = require('expo-audio') as ExpoAudio;
  } catch {
    audioModule = null;
    audioModuleMissing = true;
  }
  return audioModule;
}

let tapPlayer: AudioPlayer | null = null;
// 오디오 모드 설정이 성공한 뒤에만 true — 실패한 채로 재생하면 기본 soloAmbient 카테고리라
// 첫 탭이 사용자의 음악·팟캐스트를 끊는다. 소리를 못 내는 편이 남의 오디오를 끊는 것보다 낫다.
let ready = false;
let preloading = false;
let preloadAttempts = 0;

/**
 * 탭 사운드 프리로드 — 앱 최초 로드 시 1회 호출한다(src/App.tsx).
 * 탭 시점에 플레이어를 만들면 첫 재생이 눈에 띄게 늦어서, 미리 만들어 두고 재사용한다.
 * 실패하면 다음 호출에서 재시도한다(MAX_PRELOAD_ATTEMPTS 회까지).
 */
export function preloadTapSound(): void {
  if (ready || preloading) return;
  if (preloadAttempts >= MAX_PRELOAD_ATTEMPTS) return;
  const audio = loadAudio();
  if (!audio) {
    // 네이티브 모듈 자체가 없으면 재시도해도 결과가 같다 — 이번 세션은 무음으로 확정.
    preloadAttempts = MAX_PRELOAD_ATTEMPTS;
    return;
  }
  preloadAttempts += 1;
  preloading = true;
  try {
    // 오디오 세션을 먼저 잡아야 첫 재생이 의도한 카테고리로 나간다(무음 스위치 존중).
    // 성공했을 때만 플레이어를 만들고 ready를 세운다 — 모드 설정 실패 시엔 무음 유지.
    audio
      .setAudioModeAsync({
        playsInSilentMode: false,
        shouldPlayInBackground: false,
        interruptionMode: 'mixWithOthers',
      })
      .then(() => {
        const player = audio.createAudioPlayer(require('@/assets/sounds/tap.wav'));
        player.volume = TAP_VOLUME;
        tapPlayer = player;
        ready = true;
      })
      .catch(() => {
        // 모드 설정·플레이어 생성 실패 — 이번 시도는 무음, 다음 호출에서 재시도한다
        tapPlayer = null;
        ready = false;
      })
      .finally(() => {
        preloading = false;
      });
  } catch {
    // setAudioModeAsync 자체가 동기 throw한 경우
    tapPlayer = null;
    preloading = false;
  }
}

/** 버튼 탭 효과음 1회 재생. 연타 시 처음으로 되감아 다시 튼다(겹쳐 울리지 않게). */
export function playTapSound(): void {
  if (!ready) {
    // 프리로드를 못 탄 경로(테스트·핫리로드 등)에서도 살아나도록 지연 초기화.
    // 준비는 비동기라 이번 탭은 무음이고, 다음 탭부터 소리가 난다.
    preloadTapSound();
    return;
  }
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
