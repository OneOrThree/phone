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
    // 평시·급감 target 도 BASE_RATE 를 따라야 함 — startRate(t=0)만 BASE_RATE 면 baseRate 를 올렸을 때
    // 평시 1분이 그 값→10 으로 램프다운해 '평시 유지'와 어긋난다(대시보드가 baseRate 편집 노출, #208 리뷰).
    stages: [
      { target: Number(__ENV.BASE_RATE || 10), duration: '1m' },    // 평시(BASE_RATE 유지)
      { target: Number(__ENV.SPIKE_RATE || 300), duration: '10s' }, // 23:59 직후 폭증
      { target: Number(__ENV.SPIKE_RATE || 300), duration: '1m' },
      { target: Number(__ENV.BASE_RATE || 10), duration: '30s' },   // 급감(평시로 복귀)
    ],
  },
});
