// spike — 23:59 스크린타임 동시 업로드 모델링(서비스 고유 thundering herd, 설계 §3-3).
// 실행은 Phase 4 — 프로파일 정의만 선반영. 평시 rps → 수 초 램프 → 급감.
export const scenarios = (exec) => ({
  main: {
    executor: 'ramping-arrival-rate',
    startRate: Number(__ENV.BASE_RATE || 10),
    timeUnit: '1s',
    preAllocatedVUs: 300,
    maxVUs: 1500,
    exec,
    tags: { phase: 'main' },
    stages: [
      { target: 10, duration: '1m' },                          // 평시
      { target: Number(__ENV.SPIKE_RATE || 300), duration: '10s' }, // 23:59 직후 폭증
      { target: Number(__ENV.SPIKE_RATE || 300), duration: '1m' },
      { target: 10, duration: '30s' },                         // 급감
    ],
  },
});
