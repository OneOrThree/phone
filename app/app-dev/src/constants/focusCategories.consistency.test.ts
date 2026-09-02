// occupation 19종 정합성(GROMO-1624) — 화면에 원시 코드가 새어나가는 회귀를 잡는다.
//
// 서버 계약(Occupation 타입 = DB CHECK 제약 19종)과 화면 그룹(OCCUPATION_GROUPS),
// 추천 과목 폴백(CATEGORY_SUBJECTS)이 같은 code 집합을 가리키는지 본다.
// 어긋나면 칩이 통째로 사라지는데 타입 검사로는 안 잡히고 그 화면을 눈으로 보기 전엔 모른다.
//
// 표시명(i18n shared.focusCategories.name.<CODE>)의 정합성은 GROMO-1704 몫이다 —
// 그 키가 붙기 전까지 표시명은 서버 displayName으로 떨어진다(occupationCatalog 참고).
import { CATEGORY_SUBJECTS, OCCUPATION_GROUPS } from '@/constants/focusCategories';
import type { Occupation } from '@/types/dto/user';

// 서버 CHECK 제약(V1__baseline.sql)과 같은 19종 — 타입에서 자동 추출이 안 되므로 여기 고정한다.
const OCCUPATIONS: Occupation[] = [
  'LABOR_ATTORNEY',
  'PATENT_ATTORNEY',
  'TAX_ACCOUNTANT',
  'CPA',
  'APPRAISER',
  'CIVIL_SERVANT',
  'POLICE_FIRE',
  'ADMIN_EXAM',
  'CERTIFICATION',
  'MIDDLE_SCHOOL',
  'HIGH_SCHOOL',
  'CSAT',
  'UNIVERSITY',
  'JOB_PREP',
  'ENGLISH_TEST',
  'CODING',
  'SELF_DEVELOPMENT',
  'FOCUS_BUILDING',
  'ETC',
];

test('OCCUPATION_GROUPS가 19종을 중복 없이 전수 커버한다', () => {
  const grouped = OCCUPATION_GROUPS.flatMap((g) => g.codes);

  expect(new Set(grouped).size).toBe(grouped.length); // 중복 없음
  expect([...grouped].sort()).toEqual([...OCCUPATIONS].sort());
});

test('CATEGORY_SUBJECTS 키는 전부 유효한 occupation code다', () => {
  // 추천 과목이 없는 추상 목표(자기계발·기타 등)는 빠져 있어도 된다 — 부분집합이면 통과.
  const keys = Object.keys(CATEGORY_SUBJECTS);

  expect(keys.filter((k) => !OCCUPATIONS.includes(k as Occupation))).toEqual([]);
});
