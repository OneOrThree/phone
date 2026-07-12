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

// ── GROMO-763: N-VM 수평 분배 헬퍼 ──
// 각 loadgen VM 프로세스는 자기 SHARD(0..SPOTS-1)만 알고, 총 rate 를 SPOTS 로 나눈 몫을 담당한다.
// run.sh 는 총 rate 를 그대로 브로드캐스트하고 VM별 SHARD 만 다르게 주입 → 나눗셈은 k6 안에서.
export const SPOTS = Math.max(1, Math.floor(Number(__ENV.SPOTS || 1)));
export const SHARD = Math.min(SPOTS - 1, Math.max(0, Math.floor(Number(__ENV.SHARD || 0))));
// 정수 나눗셈 나머지 분배: 앞쪽 (total % SPOTS) 개 샤드가 +1 → Σ shardRate = total (정확 복원).
// 예 total=50, SPOTS=6 → 앞 2대 9, 나머지 4대 8 → 18+32=50.
// 주의1: 폴백은 호출부 책임 — 반드시 shardRate(Number(__ENV.X || 기본값)) 형태로 호출(빈 문자열 → Number('')=0 유실 방지).
// 주의2: constant-arrival-rate(smoke/load)·constant-vus(soak) 는 rate/vus>0 필수(k6 검증) → SPOTS>rate 엣지에서
//        shardRate 가 0 이면 그 VM k6 가 config 에러로 죽는다. 그 호출부는 Math.max(1, shardRate(...)) 로 감쌀 것.
//        ramping-arrival-rate(stress/spike) 는 target:0 을 허용하므로 그대로 shardRate(...).
//        단 SPOTS>rate 엣지에선 0→1 승격으로 Σ가 total 을 초과(과다분배 — 예 smoke 5×6대=6, +20%).
//        크래시 방지 우선의 의도적 트레이드오프(작은 프로파일·큰 SPOTS 조합에서만, 판정 영향 미미). (#211 리뷰)
export const shardRate = (total) => {
  const t = Math.max(0, Math.floor(Number(total)));
  return Math.floor(t / SPOTS) + (SHARD < t % SPOTS ? 1 : 0);
};
