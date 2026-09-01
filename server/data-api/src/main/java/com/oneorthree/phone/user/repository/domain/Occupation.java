package com.oneorthree.phone.user.repository.domain;

/**
 * 유저가 온보딩에서 고르는 직군(공부·시험 분야). 이 값이 추천 집중 태그 프리셋과 통계 코호트를 가른다.
 *
 * <p>여기 있는 건 <b>내부 식별자</b>일 뿐이고 화면에 보이는 한글 표시명은 occupations 마스터가 들고 있다 —
 * 표시명만 바꾸는 건 이 enum 을 건드리지 않는다. 반대로 상수를 지우면 그 값을 저장한 기존 유저 행이
 * 깨지므로, 폐기는 마스터의 소프트 딜리트로 한다.
 */
public enum Occupation {
    // 코드는 영문(내부 식별자), 표시명(한글)은 occupations.display_name 으로 관리 (GROMO-631)
    LABOR_ATTORNEY, PATENT_ATTORNEY, TAX_ACCOUNTANT, CPA, APPRAISER,
    CIVIL_SERVANT, POLICE_FIRE, ADMIN_EXAM, CERTIFICATION,
    MIDDLE_SCHOOL, HIGH_SCHOOL, CSAT, UNIVERSITY, JOB_PREP,
    ENGLISH_TEST, CODING, SELF_DEVELOPMENT, FOCUS_BUILDING, ETC
}
