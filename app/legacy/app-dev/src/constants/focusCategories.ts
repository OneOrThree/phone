// 집중 목표(준비 시험) 관련 프론트 상수.
// 정본은 서버 occupation code — 목록·정체성은 GET /occupations, 표시명은 앱 i18n이 소스다
// (services/occupationCatalog). 여기 남는 건 서버가 주지 않는 두 가지뿐:
// 화면 그룹(섹션) 묶음과 추천 과목 정적 폴백.
//
// (구) 이 파일에는 "카테고리명을 번역하지 말 것"이라는 경고가 있었다 — 한글이 저장값이자
// 조회 키이자 서버 displayName 대조 대상이라 번역하면 셋이 동시에 깨졌기 때문이다.
// GROMO-1624에서 그 셋이 전부 사라져(저장은 서버, 키는 code, 대조 없음) 제약도 함께 풀렸다.
import { t } from '@/i18n';
import type { Occupation } from '@/types/dto/user';

// 목표 선택 화면(온보딩 W4·설정 준비 시험 변경)의 그룹(섹션) 헤더 — GET /occupations 응답엔
// 그룹 정보가 없어(code·표시명·순서만) occupation code를 프론트에서 정적으로 묶는다.
// occupation 목록은 서버 CHECK 제약(V1__baseline.sql)으로 19종 고정이라 안전(1:1 전수 커버).
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

// occupation별 기본 추천 과목 — 서버 추천(GET /tag/defaults) 조회 실패 시의 정적 폴백.
// 매핑이 없거나 빈 배열이면 온보딩 W5(과목 확인)를 건너뛴다(추천할 과목이 없는 추상 목표).
//
// 값은 과목명이 아니라 **번역 키의 뒷자리**다(shared.focusCategories.subject.*).
// 모듈 최상위라 t()를 못 부르므로 getDefaultSubjects가 렌더 시점에 푼다.
export const CATEGORY_SUBJECTS: Partial<Record<Occupation, string[]>> = {
  LABOR_ATTORNEY: ['laborLaw', 'civilLaw', 'socialInsuranceLaw', 'businessAdministration'],
  PATENT_ATTORNEY: ['patentLaw', 'trademarkLaw', 'civilLaw', 'naturalScience'],
  TAX_ACCOUNTANT: ['taxLaw', 'accounting', 'publicFinance', 'commercialLaw'],
  CPA: ['accounting', 'taxLaw', 'businessAdministration', 'economics'],
  APPRAISER: ['appraisalTheory', 'realEstateStudies', 'civilLaw', 'accounting'],
  CIVIL_SERVANT: [
    'korean',
    'english',
    'koreanHistory',
    'administrativeLaw',
    'publicAdministration',
  ],
  POLICE_FIRE: ['koreanHistory', 'english', 'criminalLaw', 'constitutionalLaw'],
  ADMIN_EXAM: ['constitutionalLaw', 'administrativeLaw', 'publicAdministration', 'economics'],
  MIDDLE_SCHOOL: ['korean', 'english', 'math', 'science', 'socialStudies'],
  HIGH_SCHOOL: ['korean', 'english', 'math', 'electiveSubjects'],
  CSAT: ['korean', 'math', 'english', 'electiveSubjects', 'koreanHistory'],
  UNIVERSITY: ['major', 'generalEducation'],
  JOB_PREP: ['coverLetter', 'aptitudeTest', 'interview'],
  ENGLISH_TEST: ['listening', 'reading', 'speaking'],
  CODING: ['algorithms', 'csFundamentals', 'project'],
};

// 선택 occupation의 기본 추천 과목명(없으면 빈 배열). 키를 렌더 시점에 번역해 돌려준다.
export function getDefaultSubjects(occupation: Occupation | null): string[] {
  if (!occupation) return [];
  return (CATEGORY_SUBJECTS[occupation] ?? []).map((key) =>
    t(`shared.focusCategories.subject.${key}`),
  );
}
