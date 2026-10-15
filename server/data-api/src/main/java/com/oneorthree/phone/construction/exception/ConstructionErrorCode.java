package com.oneorthree.phone.construction.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 건설 도메인의 실패 코드 — LLD §3 오류표를 따른다. 앱이 {@code code} 문자열로 분기하므로
 * 상수 이름은 계약이다. Business 가 공개 봉투로 옮길 때 같은 이름을 쓴다.
 */
@Getter
public enum ConstructionErrorCode implements ErrorCode {

    /** 비주민이거나, 섬 설정(C13)상 지출 권한이 없는 주민의 PUT/POST. */
    CONSTRUCTION_FORBIDDEN(HttpStatus.FORBIDDEN, "이 작업을 수행할 권한이 없습니다."),

    /** 목표 선택의 선행 시설 미해금 — 선형이라 「바로 앞 건물 미완공」이다. */
    FACILITY_LOCKED(HttpStatus.FORBIDDEN, "먼저 지어야 하는 시설이 있습니다."),

    /** 없는 buildingId·버전 범위 위반 — field 는 요청 변수명이다. */
    OUT_OF_RANGE(HttpStatus.UNPROCESSABLE_ENTITY, "지원하지 않는 값입니다."),

    /** expectedVersion(섬) 또는 expectedCostPolicyVersion(가격) 불일치 — 차감 없음. */
    VERSION_CONFLICT(HttpStatus.CONFLICT, "다른 변경이 먼저 반영됐습니다."),

    /** 이미 완료·공사 중·선행 조건 불충족 — 차감 없음. */
    STATE_CONFLICT(HttpStatus.CONFLICT, "지금 상태에서는 처리할 수 없습니다."),

    /** 공동 잔액 부족 — 차감 없음. */
    INSUFFICIENT_FUNDS(HttpStatus.CONFLICT, "섬 물고기가 부족합니다.");

    private final HttpStatus status;
    private final String message;

    ConstructionErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
