/** 시작 전 확인은 실시간, 집중 중에는 20초마다 독립적인 3장 묶음을 판정한다. */
export const LIVE_SAMPLE_MS = 300;
export const LIVE_STALE_MS = 2_000;
export const MEASUREMENT_INTERVAL_MS = 20_000;
export const MEASUREMENT_BATCH_SIZE = 3;
/** 다음 검사에서 카메라가 준비되고 3장을 처리할 여유. 이때까지 결과가 없으면 인증을 멈춘다. */
export const MEASUREMENT_STALE_MS = MEASUREMENT_INTERVAL_MS + LIVE_STALE_MS;
export const MEASUREMENT_CAPTURE_TIMEOUT_MS = 5_000;
export type VerificationCadence = 'live' | 'periodic';
