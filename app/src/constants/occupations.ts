import type { Occupation } from '@/types/dto/user';

// 서버 Occupation enum(5종) ↔ 앱 표시명 매핑 — 리그 직군(카테고리) 랭킹 필터의 단일 소스.
// 표시명 매핑은 앱 담당(서버 enum은 순수 값만 보유). focusCategory(온보딩 16종)와는 별개 축이라
// 온보딩 카테고리 → occupation 자동 변환은 하지 않는다(백엔드 협의 전, v2/App.tsx:49 주석 참조).
export const OCCUPATION_LABEL: Record<Occupation, string> = {
  MIDDLE_SCHOOL: '중학생',
  UNIVERSITY: '대학생',
  LABOR_ATTORNEY: '노무사',
  PATENT_ATTORNEY: '변리사',
  LAWYER: '변호사',
};

export const OCCUPATIONS = Object.keys(OCCUPATION_LABEL) as Occupation[];

// 표시명 → enum 역매핑 — 드롭다운 라벨로 서버 category 파라미터 값을 찾을 때 사용.
export function occupationByLabel(label: string): Occupation | null {
  return OCCUPATIONS.find((o) => OCCUPATION_LABEL[o] === label) ?? null;
}
