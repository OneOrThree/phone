// 공통 설정 — 합격선(threshold)은 스크립트에 내장: 회귀 1차 판정은 사람 눈이 아니라 코드 (설계 §2-3)
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
export const API = `${BASE_URL}/api/v1`;

// phase:main 만 판정 — 워밍업은 run.sh 가 별도 k6 실행(--no-thresholds)으로 분리
export const THRESHOLDS = {
  'http_req_duration{phase:main}': ['p(95)<200', 'p(99)<500'],
  'http_req_failed{phase:main}': ['rate<0.01'],
  dropped_iterations: ['count<1'], // arrival rate 를 못 따라감 = SUT 포화 (부하기 CPU 먼저 확인)
};

export const randInt = (n) => Math.floor(Math.random() * n);
export const pick = (arr) => arr[randInt(arr.length)];
