// load — 목표 부하 상시 검증, baseline 의 기본 프로파일: 목표 rps 10분 유지 (설계 §3-3).
// open model: 서버가 느려져도 유입 유지 → coordinated omission 회피.
export const scenarios = (exec) => ({
  main: {
    executor: 'constant-arrival-rate',
    rate: Number(__ENV.RATE || 50),
    timeUnit: '1s',
    duration: __ENV.DURATION || '10m',
    preAllocatedVUs: 200,
    maxVUs: 1000,
    exec,
    tags: { phase: 'main' },
  },
});
