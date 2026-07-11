// 프로파일별 편집 가능한 부하 파라미터 — k6 profiles/*.js 의 __ENV 대응 (GROMO-759).
// 프로파일을 고르면 그 프로파일이 실제로 읽는 파라미터만 우측에 뜨고, 기본값이 프리필된다.
//  - smoke/load(constant-arrival-rate): RATE(총 rps) · DURATION(시간)
//  - stress(ramping): START_RATE(시작 rps) — 이후 100→200→400 계단은 고정
//  - spike(ramping): BASE_RATE(시작·평시) · SPIKE_RATE(끝·피크)
// key 는 RunOverrides 필드명. 배선은 workflow 의 단일 `params` 입력(KEY=VALUE;…)으로 합쳐 보낸다
// (workflow_dispatch 10-input 제한 회피 — github.ts dispatchRun 이 조립).
export type ParamKey = 'rate' | 'duration' | 'startRate' | 'baseRate' | 'spikeRate';

export interface LoadParam {
  key: ParamKey;
  label: string;
  def: string; // 프로파일 기본값(입력 프리필)
  kind: 'rps' | 'time'; // 검증·placeholder 용
  note?: string; // 계단/램프처럼 고정 동작 설명
}

export const PROFILE_PARAMS: Record<string, LoadParam[]> = {
  smoke: [
    { key: 'rate', label: '총 rps', def: '5', kind: 'rps' },
    { key: 'duration', label: '시간', def: '1m', kind: 'time' },
  ],
  load: [
    { key: 'rate', label: '총 rps', def: '50', kind: 'rps' },
    { key: 'duration', label: '시간', def: '10m', kind: 'time' },
  ],
  stress: [
    { key: 'startRate', label: '시작 rps', def: '50', kind: 'rps', note: '이후 100→200→400 rps 계단(3분씩·고정)' },
  ],
  spike: [
    { key: 'baseRate', label: '시작 rps(평시)', def: '10', kind: 'rps' },
    { key: 'spikeRate', label: '끝 rps(피크)', def: '300', kind: 'rps', note: '평시 1분 → 피크 급증(10s) → 유지(1분) → 급감(30s)' },
  ],
};

export const paramsFor = (profile: string): LoadParam[] => PROFILE_PARAMS[profile] ?? PROFILE_PARAMS.load;

// 프로파일 선택 시 입력을 이 기본값으로 프리필(재영님 요청: 우측에 값이 들어가 있게)
export const defaultValues = (profile: string): Record<string, string> =>
  Object.fromEntries(paramsFor(profile).map((p) => [p.key, p.def]));

// rps=1이상 정수, time=숫자+s/m/h. 프리필 기본값도 이 규칙을 통과한다.
export const validateParam = (p: LoadParam, v: string): string | null => {
  const s = v.trim();
  if (!s) return `${p.label} 값이 비었습니다`;
  if (p.kind === 'rps') return /^[1-9][0-9]*$/.test(s) ? null : `${p.label} 는 1 이상 정수여야 합니다`;
  return /^[0-9]+[smh]$/.test(s) ? null : `${p.label} 형식 오류(예: 5m·90s·2h)`;
};

// 편집값 → RunOverrides 조각. 기본값과 같아도 명시 전송(재현성·모호함 제거).
export const toOverrides = (profile: string, values: Record<string, string>): Record<string, string> => {
  const o: Record<string, string> = {};
  for (const p of paramsFor(profile)) {
    const v = (values[p.key] ?? '').trim();
    if (v) o[p.key] = v;
  }
  return o;
};
