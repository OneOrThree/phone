// soak — 누수·누적 포화: load 의 ~70% 로 장시간 (설계 §3-3 — heap 우상향·커넥션 누수·FD).
// 실행은 Phase 4 — 표준 VM 사용(spot 선점 시 장시간 run 무효). closed model 이라 think time 존재.
import { shardRate } from '../lib/config.js';

export const scenarios = (exec) => ({
  main: {
    executor: 'constant-vus',
    vus: Math.max(1, shardRate(Number(__ENV.VUS || 50))), // constant-vus 는 vus>0 필수 — SPOTS>vus 엣지 방어
    duration: __ENV.DURATION || '2h',
    exec,
    tags: { phase: 'main' },
  },
});

// closed model 전용 think time (open model 에선 불필요 — arrival rate 가 곧 트래픽 모델)
export const THINK_SECONDS = 1;
