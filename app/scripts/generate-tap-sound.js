#!/usr/bin/env node
/* eslint-env node */
// 버튼 탭 효과음 합성 — src/assets/sounds/tap.wav 를 생성한다.
//
// 사용법 (app/ 에서):
//   npm run gen:sound
//
// 왜 스크립트인가: 외부 효과음은 라이선스 추적 부담이 있고, 파형이 코드로 남아 있어야
// "더 조용하게/더 짧게" 같은 톤 조정을 재현 가능하게 할 수 있다. 의존성 0(node 내장만).
//
// 음색 설계 — 차분한 포커스 앱 톤. 시스템 키보드 소리보다 조용해야 한다는 기준:
//   - 기음 620Hz + 2배음(1240Hz, 35%). 순음보다 덜 삐죽하고 고역이 적어 조용하게 들린다.
//   - 어택 3ms 램프(시작 클릭 방지) → 지수 감쇠 τ=11ms → 마지막 10ms 선형 페이드아웃(끝 클릭 방지).
//   - 피크 진폭 0.16(-16dBFS). 재생부(utils/sound.ts)에서 volume 0.35를 한 번 더 곱한다.

const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.resolve(__dirname, '..', 'src', 'assets', 'sounds', 'tap.wav');

const SAMPLE_RATE = 44100; // 44.1kHz
const CHANNELS = 1; // mono
const BITS_PER_SAMPLE = 16;
const DURATION_MS = 48; // 50ms 내외

const FUNDAMENTAL_HZ = 620;
const HARMONIC_RATIO = 0.35; // 2배음 진폭 비율
const PEAK = 0.16; // 피크 진폭(0~1)
const ATTACK_MS = 3; // 시작 램프
const DECAY_TAU_MS = 11; // 지수 감쇠 시상수
const FADE_OUT_MS = 10; // 끝 페이드아웃

// 샘플 인덱스 → -1~1 실수 진폭
function sampleAt(i, totalSamples) {
  const t = i / SAMPLE_RATE; // 초
  const ms = t * 1000;

  const tone =
    Math.sin(2 * Math.PI * FUNDAMENTAL_HZ * t) +
    HARMONIC_RATIO * Math.sin(2 * Math.PI * FUNDAMENTAL_HZ * 2 * t);

  // 어택(0→1 선형) × 지수 감쇠
  const attack = ms < ATTACK_MS ? ms / ATTACK_MS : 1;
  const decay = Math.exp(-ms / DECAY_TAU_MS);

  // 끝 페이드아웃 — 감쇠만으로는 잔류 진폭이 남아 컷 클릭이 들린다
  const fadeStart = totalSamples - Math.round((FADE_OUT_MS / 1000) * SAMPLE_RATE);
  const fade = i >= fadeStart ? (totalSamples - i) / (totalSamples - fadeStart) : 1;

  // tone 최대치는 1 + HARMONIC_RATIO 이므로 정규화 후 PEAK 적용
  return (tone / (1 + HARMONIC_RATIO)) * attack * decay * fade * PEAK;
}

function buildWav() {
  const totalSamples = Math.round((DURATION_MS / 1000) * SAMPLE_RATE);
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const dataSize = totalSamples * CHANNELS * bytesPerSample;

  // RIFF/WAVE 헤더(44바이트) + PCM 데이터
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4); // 이후 청크 크기
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // fmt 청크 크기(PCM)
  buffer.writeUInt16LE(1, 20); // 오디오 포맷 1 = PCM
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(CHANNELS * bytesPerSample, 32); // block align
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < totalSamples; i += 1) {
    const v = sampleAt(i, totalSamples);
    // 클리핑 방어 후 16-bit 정수로
    const clamped = Math.max(-1, Math.min(1, v));
    const pcm = Math.round(clamped * 32767);
    // 프레임당 CHANNELS개 샘플을 인터리브해서 쓴다 — 오프셋에 CHANNELS를 반영해야
    // CHANNELS를 2로 바꿨을 때 뒤쪽 절반이 0으로 남은 WAV가 조용히 생기지 않는다.
    for (let c = 0; c < CHANNELS; c += 1) {
      buffer.writeInt16LE(pcm, 44 + (i * CHANNELS + c) * bytesPerSample);
    }
  }
  return buffer;
}

function main() {
  const wav = buildWav();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, wav);
  console.log(
    `생성 완료: ${path.relative(process.cwd(), OUTPUT_PATH)} ` +
      `(${SAMPLE_RATE}Hz ${CHANNELS === 1 ? 'mono' : `${CHANNELS}ch`} ${BITS_PER_SAMPLE}bit, ` +
      `${DURATION_MS}ms, ${wav.length}B)`,
  );
}

main();
