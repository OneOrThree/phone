// 집중 목표(시험/카테고리) 마스터 — 온보딩 16(목표 선택)과 리그 시험 칩의 단일 소스.
// 서버 계약 미정(신규 필드)이라 프론트 상수로 관리 — TODO: 백엔드 협의 후 서버 값으로 이관.
export interface FocusCategoryGroup {
  label: string;
  items: string[];
}

export const FOCUS_CATEGORY_GROUPS: FocusCategoryGroup[] = [
  { label: '전문 자격증', items: ['노무사', '변리사', '세무사', '회계사', '감정평가사'] },
  { label: '공무원·고시', items: ['공무원', '경찰·소방', '행정고시', '자격증'] },
  { label: '학생', items: ['중학생', '고등학생', '수능·N수', '대학생'] },
  { label: '취업·어학', items: ['취업 준비', '토익·토플', '코딩'] },
  { label: '그 외', items: ['자기계발', '집중력 키우기', '기타'] },
];
