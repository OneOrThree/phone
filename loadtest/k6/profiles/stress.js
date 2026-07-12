// stress — 한계 탐색: 계단식 arrival rate 증가. dropped_iterations>0 = 포화 신호 (설계 §2-3).
// 주의: 무료체험 부하기(4vCPU)가 먼저 포화될 수 있음 — 부하기 CPU>80% 면 run 은 INVALID.
import { shardRate } from '../lib/config.js';

export const scenarios = (exec) => ({
  main: {
    executor: 'ramping-arrival-rate',
    startRate: shardRate(Number(__ENV.START_RATE || 50)),
    timeUnit: '1s',
    preAllocatedVUs: 200,
    maxVUs: 1000,
    exec,
    tags: { phase: 'main' },
    // GROMO-763: stage target 은 env 가 아닌 리터럴 → startRate 만 나눠선 총 rate 안 맞음. 3개 전부 shardRate.
    stages: [
      { target: shardRate(100), duration: '3m' },
      { target: shardRate(200), duration: '3m' },
      { target: shardRate(400), duration: '3m' },
    ],
  },
});
