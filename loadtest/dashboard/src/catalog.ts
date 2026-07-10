// 부하테스트 트리거 카탈로그 — 프로파일·타겟 선택지와 미리보기 메타의 단일 소스 (GROMO-749).
// RunForm 하드코딩 배열을 대체한다. 새 타겟 추가 = 여기 한 블록 (React 코드 무수정).
// TARGETS 는 후속(GROMO-750)에서 openapi.json 자동 목록으로 대체 예정.

export interface ProfileMeta {
  value: string; // workflow_dispatch 가 받는 값(영어 고정)
  label: string; // 드롭다운 표시(한글)
  rate: string; // 기본 rps (계단형은 "100→200→400")
  duration: string; // 기본 지속시간
  vu: string; // VU 범위 표시
  model: string; // executor 모델 설명
  ramping: boolean; // 계단/램핑 여부 — 단일 RATE override 안내용
  warmupMin: number; // 예상 소요 계산용 warmup 분
}

export interface TargetMeta {
  value: string; // k6 타겟 상대경로(= workflow 입력)
  label: string; // 드롭다운 표시
  category: 'scenario' | 'matrix';
  endpoint: string; // 미리보기 "엔드포인트" 표시
  star?: boolean; // Phase 1 표적
}

// value=워크플로우 입력(영어 고정), label=한글 설명. soak 은 Phase 4 까지 제외(#184 리뷰).
export const PROFILES: ProfileMeta[] = [
  { value: 'smoke', label: 'smoke — 빠른 검증 (5 rps · 1분)', rate: '5', duration: '1m', vu: '10 ~ 50', model: 'open · constant-arrival', ramping: false, warmupMin: 2 },
  { value: 'load', label: 'load — 목표 부하 (50 rps · 10분 유지)', rate: '50', duration: '10m', vu: '200 ~ 1000', model: 'open · constant-arrival', ramping: false, warmupMin: 2 },
  { value: 'stress', label: 'stress — 한계 탐색 (100→400 rps 계단)', rate: '100→200→400', duration: '9m', vu: '200 ~ 1000', model: 'open · ramping-arrival', ramping: true, warmupMin: 2 },
  { value: 'spike', label: 'spike — 급증 부하 (10→300 rps 폭증)', rate: '10→300', duration: '~2.5m', vu: '300 ~ 1500', model: 'open · ramping-arrival', ramping: true, warmupMin: 2 },
];

export const TARGETS: TargetMeta[] = [
  { value: 'scenarios/daily_mix.js', label: '현실 믹스 — 6개 유저 여정 혼합', category: 'scenario', endpoint: '혼합 6종 (stats/today · focus-session · friends · shop …)' },
  { value: 'matrix/focus-session-list.js', label: '집중세션 조회 ⭐ — 커서 API (Phase 1 표적)', category: 'matrix', endpoint: 'GET /api/v1/focus-session (cursor pagination)', star: true },
  { value: 'matrix/focus-session-create.js', label: '집중세션 생성 — 쓰기 경로', category: 'matrix', endpoint: 'POST /api/v1/focus-session (write · cascade)' },
  { value: 'matrix/stats-today.js', label: '오늘 통계 — 인덱스 대조군', category: 'matrix', endpoint: 'GET /api/v1/stats/today (indexed control)' },
];

// 모든 프로파일 공통 판정 기준(표시용). 실제 판정은 verdict.mjs.
export const VERDICT_LABEL = 'p95<200ms · p99<500ms · 오류율<1% · baseline p95 +10% 이내';
