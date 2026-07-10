// smoke — 스크립트·환경 검증: 5 rps · 1분. 파이프라인 관통 게이트(Phase 0 DoD)이자
// CI 에 넣을 수 있는 유일한 프로파일 (설계 §3-3).
export const scenarios = (exec) => ({
  main: {
    executor: 'constant-arrival-rate',
    rate: Number(__ENV.RATE || 5),
    timeUnit: '1s',
    duration: __ENV.DURATION || '1m',
    preAllocatedVUs: 10,
    maxVUs: 50,
    exec,
    tags: { phase: 'main' },
  },
});
