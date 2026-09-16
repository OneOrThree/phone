import type { InternalAxiosRequestConfig } from 'axios';
import type { FocusTagResponse, OccupationDefaultTagsResponse } from '@/types/dto/focus';
import type { Occupation } from '@/types/dto/user';

const TAGS: readonly FocusTagResponse[] = [
  { tagId: '20000000-0000-0000-0000-000000000001', name: '노동법' },
  { tagId: '20000000-0000-0000-0000-000000000002', name: '행정쟁송법' },
  { tagId: '20000000-0000-0000-0000-000000000003', name: '사회보험법' },
  { tagId: '20000000-0000-0000-0000-000000000004', name: '민법' },
  { tagId: '20000000-0000-0000-0000-000000000005', name: '영어' },
];

const DEFAULT_TAGS: Record<Occupation, string[]> = {
  LABOR_ATTORNEY: ['노동법', '민법', '사회보험법', '행정쟁송법'],
  PATENT_ATTORNEY: ['특허법', '민법', '자연과학'],
  TAX_ACCOUNTANT: ['세법', '회계학', '재정학'],
  CPA: ['회계학', '세법', '경영학'],
  APPRAISER: ['민법', '경제학', '감정평가이론'],
  CIVIL_SERVANT: ['국어', '영어', '한국사'],
  POLICE_FIRE: ['형법', '형사소송법', '소방학'],
  ADMIN_EXAM: ['헌법', '행정법', '경제학'],
  CERTIFICATION: ['이론', '기출문제', '오답노트'],
  MIDDLE_SCHOOL: ['국어', '영어', '수학'],
  HIGH_SCHOOL: ['국어', '영어', '수학'],
  CSAT: ['국어', '수학', '영어', '탐구'],
  UNIVERSITY: ['전공', '교양', '과제'],
  JOB_PREP: ['자기소개서', '코딩테스트', '면접 준비'],
  ENGLISH_TEST: ['단어', '독해', '듣기'],
  CODING: ['알고리즘', '프로젝트', 'CS 공부'],
  SELF_DEVELOPMENT: ['독서', '글쓰기', '운동'],
  FOCUS_BUILDING: ['집중 연습', '독서', '정리'],
  ETC: ['공부', '독서', '개인 프로젝트'],
};

export function mockFocusTags(): FocusTagResponse[] {
  return TAGS.map((tag) => ({ ...tag }));
}

export function mockDefaultFocusTags(
  config: InternalAxiosRequestConfig,
): OccupationDefaultTagsResponse {
  const requested = config.params?.occupation;
  const occupation: Occupation =
    typeof requested === 'string' && requested in DEFAULT_TAGS
      ? (requested as Occupation)
      : 'LABOR_ATTORNEY';
  return {
    occupation,
    tags: DEFAULT_TAGS[occupation].map((name, sortOrder) => ({ name, sortOrder })),
  };
}
