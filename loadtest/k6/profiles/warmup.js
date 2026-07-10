// 워밍업 — run.sh 가 본측정 전에 **별도 k6 프로세스**(--no-thresholds)로 실행.
// 분리 이유: ① JIT·커넥션풀·버퍼캐시 워밍업 전 숫자는 노이즈 ② pg_stat_statements 는 태그로
// 제외가 불가하므로, 워밍업 후 리셋 → 본측정의 pg_stat 델타를 순수하게 유지 (설계 §상세4-3).
export const scenarios = (exec) => ({
  warmup: {
    executor: 'constant-arrival-rate',
    rate: Number(__ENV.WARMUP_RATE || 20),
    timeUnit: '1s',
    duration: __ENV.WARMUP_DURATION || '2m',
    preAllocatedVUs: 50,
    maxVUs: 200,
    exec,
    tags: { phase: 'warmup' },
  },
});
