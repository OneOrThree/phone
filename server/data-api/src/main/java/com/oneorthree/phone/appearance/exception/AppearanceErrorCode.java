package com.oneorthree.phone.appearance.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 외양 도메인의 실패 코드 — island-appearance LLD §5 오류표를 따른다. 앱이 {@code code} 문자열로
 * 분기하므로 상수 이름은 계약이다. Business 가 공개 봉투로 옮길 때 같은 이름을 쓴다.
 *
 * <p>비주민·비방장 거절은 외양 코드를 새로 만들지 않고 {@code GroupErrorCode#MEMBER_ONLY}/{@code NOT_OWNER}
 * 를 그대로 쓴다 — 공개 계약상 어차피 같은 403 FORBIDDEN 이며, 이미 Business 가 매핑하는 이름이다.
 */
@Getter
public enum AppearanceErrorCode implements ErrorCode {

    /** fields/values 캐리어 형식 위반 — 알 수 없는 필드·키 불일치·빈 PATCH·타입 오류·expectedVersion 누락. */
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "요청 형식이 올바르지 않습니다."),

    /** ownerType=user 인 상품을 보유하지 않은 개인 슬롯 적용, 또는 공동 상품 미보유 적용. */
    FORBIDDEN(HttpStatus.FORBIDDEN, "이 작업을 수행할 권한이 없습니다."),

    /** 없는 productId — null 을 허용하지 않는 슬롯의 null 은 OUT_OF_RANGE 다. */
    PRODUCT_NOT_FOUND(HttpStatus.NOT_FOUND, "상품을 찾을 수 없습니다."),

    /** 등록됐지만 종류·소유자·적용 대상이 맞지 않거나, null 불가 필드에 null, 미등록 건물 키. */
    OUT_OF_RANGE(HttpStatus.UNPROCESSABLE_ENTITY, "지원하지 않는 값입니다."),

    /** expectedVersion 이 현재 공동 외양 버전과 다르다. */
    VERSION_CONFLICT(HttpStatus.CONFLICT, "다른 변경이 먼저 반영됐습니다.");

    private final HttpStatus status;
    private final String message;

    AppearanceErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
