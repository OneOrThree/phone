// 타겟×프로파일 실행값 프리셋 — 선택 시 dispatch 에 실려 프로파일 기본값을 덮어씀 (GROMO-749).
// precedence: 프로파일 기본 < preset < 고급설정 수동 override.
// 예: 쓰기 경로(create)는 load 시 기본 rps 를 낮춰 접수(락 경합 회피).
export interface PresetOverride {
  rate?: string;
  duration?: string;
  scale?: string;
}

export const PRESETS: Record<string, Record<string, PresetOverride>> = {
  'matrix/focus-session-create.js': { load: { rate: '30' } },
};

export const presetFor = (target: string, profile: string): PresetOverride =>
  PRESETS[target]?.[profile] ?? {};
