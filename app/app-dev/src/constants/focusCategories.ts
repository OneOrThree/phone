// 집중 목표(시험/카테고리) 마스터 — 온보딩 16(목표 선택)과 리그 시험 칩의 단일 소스.
// 서버 계약 미정(신규 필드)이라 프론트 상수로 관리 — TODO: 백엔드 협의 후 서버 값으로 이관.
//
// ⚠️ 카테고리명('노무사'·'수능·N수' 등)은 **번역하지 않는다**. 화면에 보이긴 하지만 동시에
//    AsyncStorage(focusCategory)에 저장되는 값이고, CATEGORY_TO_OCCUPATION·CATEGORY_SUBJECTS의
//    조회 키이며, 서버 GET /occupations의 displayName과 문자열로 대조된다(FocusCategoryStep).
//    번역하면 이 셋이 동시에 깨진다. 번역 대상은 **그룹 헤더와 추천 과목명**뿐이다.
import { t } from '@/i18n';
import type { Occupation } from '@/types/dto/user';

export interface FocusCategoryGroup {
  /** 그룹 헤더의 번역 키 — 렌더 시점에 t(labelKey)로 푼다 */
  labelKey: string;
  items: string[];
}

export const FOCUS_CATEGORY_GROUPS: FocusCategoryGroup[] = [
  {
    labelKey: 'shared.focusCategories.groupProfessional',
    items: ['노무사', '변리사', '세무사', '회계사', '감정평가사'],
  },
  {
    labelKey: 'shared.focusCategories.groupCivilService',
    items: ['공무원', '경찰·소방', '행정고시', '자격증'],
  },
  {
    labelKey: 'shared.focusCategories.groupStudent',
    items: ['중학생', '고등학생', '수능·N수', '대학생'],
  },
  {
    labelKey: 'shared.focusCategories.groupCareerLanguage',
    items: ['취업 준비', '토익·토플', '코딩'],
  },
  {
    labelKey: 'shared.focusCategories.groupOther',
    items: ['자기계발', '집중력 키우기', '기타'],
  },
];

// 온보딩 목표 선택 화면(FocusCategoryStep)의 그룹(섹션) 헤더 — 표시명·목록은 GET /occupations(서버)가
// 소스지만, 응답엔 그룹 정보가 없어(code·표시명·순서만) occupation code를 프론트에서 정적으로 묶는다.
// occupation 목록은 고정이라 안전(전 19종 1:1 커버). 표시명은 서버 displayName을 그대로 쓴다.
export const OCCUPATION_GROUPS: { labelKey: string; codes: Occupation[] }[] = [
  {
    labelKey: 'shared.focusCategories.groupProfessional',
    codes: ['LABOR_ATTORNEY', 'PATENT_ATTORNEY', 'TAX_ACCOUNTANT', 'CPA', 'APPRAISER'],
  },
  {
    labelKey: 'shared.focusCategories.groupCivilService',
    codes: ['CIVIL_SERVANT', 'POLICE_FIRE', 'ADMIN_EXAM', 'CERTIFICATION'],
  },
  {
    labelKey: 'shared.focusCategories.groupStudent',
    codes: ['MIDDLE_SCHOOL', 'HIGH_SCHOOL', 'CSAT', 'UNIVERSITY'],
  },
  {
    labelKey: 'shared.focusCategories.groupCareerLanguage',
    codes: ['JOB_PREP', 'ENGLISH_TEST', 'CODING'],
  },
  {
    labelKey: 'shared.focusCategories.groupOther',
    codes: ['SELF_DEVELOPMENT', 'FOCUS_BUILDING', 'ETC'],
  },
];

// 카테고리별 기본 추천 과목 — 온보딩 W5(과목 확인·편집)에서 미리 채워 보여주고 사용자가 편집한다.
// 매핑이 없거나 빈 배열이면 W5를 건너뛴다(추천할 과목이 없는 추상 목표).
// TODO: 백엔드/기획 확정값으로 이관 — 현재는 대표 과목 시드값.
//
// 값은 과목명이 아니라 **번역 키의 뒷자리**다(shared.focusCategories.subject.*).
// 모듈 최상위라 t()를 못 부르므로 getDefaultSubjects가 렌더 시점에 푼다.
// 키(카테고리명)는 저장·조회에 쓰이는 식별자라 한글 그대로 둔다 — 파일 상단 ⚠️ 참고.
export const CATEGORY_SUBJECTS: Record<string, string[]> = {
  노무사: ['laborLaw', 'civilLaw', 'socialInsuranceLaw', 'businessAdministration'],
  변리사: ['patentLaw', 'trademarkLaw', 'civilLaw', 'naturalScience'],
  세무사: ['taxLaw', 'accounting', 'publicFinance', 'commercialLaw'],
  회계사: ['accounting', 'taxLaw', 'businessAdministration', 'economics'],
  감정평가사: ['appraisalTheory', 'realEstateStudies', 'civilLaw', 'accounting'],
  공무원: ['korean', 'english', 'koreanHistory', 'administrativeLaw', 'publicAdministration'],
  '경찰·소방': ['koreanHistory', 'english', 'criminalLaw', 'constitutionalLaw'],
  행정고시: ['constitutionalLaw', 'administrativeLaw', 'publicAdministration', 'economics'],
  중학생: ['korean', 'english', 'math', 'science', 'socialStudies'],
  고등학생: ['korean', 'english', 'math', 'electiveSubjects'],
  '수능·N수': ['korean', 'math', 'english', 'electiveSubjects', 'koreanHistory'],
  대학생: ['major', 'generalEducation'],
  '취업 준비': ['coverLetter', 'aptitudeTest', 'interview'],
  '토익·토플': ['listening', 'reading', 'speaking'],
  코딩: ['algorithms', 'csFundamentals', 'project'],
};

// 선택 카테고리의 기본 추천 과목명(없으면 빈 배열). 키를 렌더 시점에 번역해 돌려준다.
export function getDefaultSubjects(category: string | null): string[] {
  if (!category) return [];
  return (CATEGORY_SUBJECTS[category] ?? []).map((key) =>
    t(`shared.focusCategories.subject.${key}`),
  );
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
