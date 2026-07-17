// 집중 목표(시험/카테고리) 마스터 — 온보딩 16(목표 선택)과 리그 시험 칩의 단일 소스.
// 서버 계약 미정(신규 필드)이라 프론트 상수로 관리 — TODO: 백엔드 협의 후 서버 값으로 이관.
import type { Occupation } from '@/types/dto/user';

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

// 온보딩 목표 선택 화면(FocusCategoryStep)의 그룹(섹션) 헤더 — 표시명·목록은 GET /occupations(서버)가
// 소스지만, 응답엔 그룹 정보가 없어(code·표시명·순서만) occupation code를 프론트에서 정적으로 묶는다.
// occupation 목록은 고정이라 안전(전 19종 1:1 커버). 표시명은 서버 displayName을 그대로 쓴다.
export const OCCUPATION_GROUPS: { label: string; codes: Occupation[] }[] = [
  {
    label: '전문 자격증',
    codes: ['LABOR_ATTORNEY', 'PATENT_ATTORNEY', 'TAX_ACCOUNTANT', 'CPA', 'APPRAISER'],
  },
  { label: '공무원·고시', codes: ['CIVIL_SERVANT', 'POLICE_FIRE', 'ADMIN_EXAM', 'CERTIFICATION'] },
  { label: '학생', codes: ['MIDDLE_SCHOOL', 'HIGH_SCHOOL', 'CSAT', 'UNIVERSITY'] },
  { label: '취업·어학', codes: ['JOB_PREP', 'ENGLISH_TEST', 'CODING'] },
  { label: '그 외', codes: ['SELF_DEVELOPMENT', 'FOCUS_BUILDING', 'ETC'] },
];

// 카테고리별 기본 추천 과목 — 온보딩 W5(과목 확인·편집)에서 미리 채워 보여주고 사용자가 편집한다.
// 매핑이 없거나 빈 배열이면 W5를 건너뛴다(추천할 과목이 없는 추상 목표).
// TODO: 백엔드/기획 확정값으로 이관 — 현재는 대표 과목 시드값.
export const CATEGORY_SUBJECTS: Record<string, string[]> = {
  노무사: ['노동법', '민법', '사회보험법', '경영학'],
  변리사: ['특허법', '상표법', '민법', '자연과학개론'],
  세무사: ['세법', '회계학', '재정학', '상법'],
  회계사: ['회계학', '세법', '경영학', '경제학'],
  감정평가사: ['감정평가이론', '부동산학원론', '민법', '회계학'],
  공무원: ['국어', '영어', '한국사', '행정법', '행정학'],
  '경찰·소방': ['한국사', '영어', '형사법', '헌법'],
  행정고시: ['헌법', '행정법', '행정학', '경제학'],
  중학생: ['국어', '영어', '수학', '과학', '사회'],
  고등학생: ['국어', '영어', '수학', '탐구'],
  '수능·N수': ['국어', '수학', '영어', '탐구', '한국사'],
  대학생: ['전공', '교양'],
  '취업 준비': ['자소서', '인적성', '면접'],
  '토익·토플': ['LC', 'RC', '스피킹'],
  코딩: ['알고리즘', 'CS 지식', '프로젝트'],
};

// 선택 카테고리의 기본 추천 과목(없으면 빈 배열).
export function getDefaultSubjects(category: string | null): string[] {
  if (!category) return [];
  return CATEGORY_SUBJECTS[category] ?? [];
}

// 로컬 focusCategory ↔ 서버 Occupation enum — GROMO-631에서 19종으로 확장돼 전 카테고리 1:1 매핑.
// 서버 동기화(updateOccupation)·같은 카테고리 리그 랭킹(?category=)·비교 통계에 사용.
// 표시명은 GET /occupations 가 제공하므로 이 목록 자체를 서버 값으로 이관 검토(TODO).
export const CATEGORY_TO_OCCUPATION: Record<string, Occupation> = {
  노무사: 'LABOR_ATTORNEY',
  변리사: 'PATENT_ATTORNEY',
  세무사: 'TAX_ACCOUNTANT',
  회계사: 'CPA',
  감정평가사: 'APPRAISER',
  공무원: 'CIVIL_SERVANT',
  '경찰·소방': 'POLICE_FIRE',
  행정고시: 'ADMIN_EXAM',
  자격증: 'CERTIFICATION',
  중학생: 'MIDDLE_SCHOOL',
  고등학생: 'HIGH_SCHOOL',
  '수능·N수': 'CSAT',
  대학생: 'UNIVERSITY',
  '취업 준비': 'JOB_PREP',
  '토익·토플': 'ENGLISH_TEST',
  코딩: 'CODING',
  자기계발: 'SELF_DEVELOPMENT',
  '집중력 키우기': 'FOCUS_BUILDING',
  기타: 'ETC',
};

// 카테고리의 서버 Occupation(매핑 없으면 null). undefined(useFocusCategory 로딩 중)도 null로.
export function occupationForCategory(category: string | null | undefined): Occupation | null {
  if (!category) return null;
  return CATEGORY_TO_OCCUPATION[category] ?? null;
}

// 서버 Occupation → 카테고리 표시명 (CATEGORY_TO_OCCUPATION 역방향, 19종 1:1이라 손실 없음).
// 타 유저 프로필의 준비 시험 표시(GROMO-680) 등 단건 표시용 — GET /occupations 조회 없이 즉시 매핑.
export function categoryForOccupation(occupation: string | null): string | null {
  if (!occupation) return null;
  const found = Object.entries(CATEGORY_TO_OCCUPATION).find(([, code]) => code === occupation);
  return found ? found[0] : null;
}
