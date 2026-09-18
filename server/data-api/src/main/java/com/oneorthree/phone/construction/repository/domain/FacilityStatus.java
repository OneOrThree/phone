package com.oneorthree.phone.construction.repository.domain;

/**
 * 시설 상태 — BUILDING 에서 COMPLETED 로만 전이하는 단방향이다.
 * 공사 중(BUILDING)에는 같은 시설의 새 건설 명령과 새 목표 선택이 거절된다.
 */
public enum FacilityStatus {
    /** 공사 중 — completes_at 이 지나면 스케줄러가 COMPLETED 로 전이한다. */
    BUILDING,
    /** 완공 — (섬, buildingId) 유일성이 재건설을 막는다(정책 C06). */
    COMPLETED
}
