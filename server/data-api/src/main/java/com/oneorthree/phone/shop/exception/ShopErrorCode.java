package com.oneorthree.phone.shop.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 섬 상점의 실패 코드 — island-shop LLD §2 오류표를 따른다. 상수 이름은 계약이고, Business 가 같은 이름의 공개
 * 코드로 옮긴다({@code ShopUseCase}). 비주민은 그룹 공통 {@code MEMBER_ONLY} 를 그대로 쓴다.
 */
@Getter
public enum ShopErrorCode implements ErrorCode {

    /** 섬 물고기 지출 권한(SHARED_PURCHASE, 정책 S02·D2)이 없는 주민의 구매. */
    SHOP_FORBIDDEN(HttpStatus.FORBIDDEN, "이 작업을 수행할 권한이 없습니다."),

    /** 판매 revision 의 {@code requiredBuilding} 시설이 아직 완공되지 않았다. */
    FACILITY_LOCKED(HttpStatus.FORBIDDEN, "먼저 지어야 하는 시설이 있습니다."),

    /** 활성 카탈로그에 없는 상품 — 활성 발행본이 없을 때도 같다(정책 §「상품 부재」). */
    PRODUCT_NOT_FOUND(HttpStatus.NOT_FOUND, "상품을 찾을 수 없습니다."),

    /** 카테고리·scope·페이지 크기 등 값 범위 위반. */
    OUT_OF_RANGE(HttpStatus.UNPROCESSABLE_ENTITY, "지원하지 않는 값입니다."),

    /** expectedProductVersion 또는 expectedWalletVersion 불일치 — 차감 없음. */
    VERSION_CONFLICT(HttpStatus.CONFLICT, "다른 변경이 먼저 반영됐습니다."),

    /** 이미 소유·가격 미승인(정책 S03 — 0원으로 보지 않는다)·선행 상품 미보유 — 차감 없음. */
    STATE_CONFLICT(HttpStatus.CONFLICT, "지금 상태에서는 처리할 수 없습니다."),

    /** 섬 통장 잔액 부족 — 차감 없음. */
    INSUFFICIENT_FUNDS(HttpStatus.CONFLICT, "섬 물고기가 부족합니다."),

    /** 목록 커서가 가리키는 발행본이 없거나 폐기됐다 — 처음부터 다시 읽는다. */
    CURSOR_EXPIRED(HttpStatus.CONFLICT, "목록이 바뀌었습니다. 처음부터 다시 조회해 주세요.");

    private final HttpStatus status;
    private final String message;

    ShopErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
