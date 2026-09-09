package com.oneorthree.phone.focus.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * focus 도메인 실패 사유 — HTTP 상태와 사용자 노출 문구를 한 곳에 묶는다.
 *
 * <p>같은 상태여도 코드를 나눈 곳이 있다: 409 는 {@code SESSION_ALREADY_ENDED}(통계·지급이 이미 커밋됐으니
 * 재시도 금지)와 {@code SESSION_DISCARDED}(통계에 한 번도 반영되지 않았으니 POST 로 살려 올려도 된다)로
 * 갈린다 — 앱의 폴백 여부가 여기서 결정되므로 둘을 합치면 그 블록의 집중 시간과 코인이 유실된다.
 */
@Getter
public enum FocusErrorCode implements ErrorCode {

    TAG_NOT_FOUND(HttpStatus.NOT_FOUND, "존재하지 않는 태그입니다."),
    FORBIDDEN(HttpStatus.FORBIDDEN, "권한이 없습니다."),
    INVALID_DATE_RANGE(HttpStatus.BAD_REQUEST, "유효하지 않은 기간입니다."),
    INVALID_PAGE_REQUEST(HttpStatus.BAD_REQUEST, "유효하지 않은 페이지 요청입니다."),
    SESSION_NOT_FOUND(HttpStatus.NOT_FOUND, "존재하지 않는 집중 세션입니다."),
    SESSION_ALREADY_ENDED(HttpStatus.CONFLICT, "이미 종료된 집중 세션입니다."),
    // GROMO-1214 코드리뷰: 취소(CANCELED)·자동마감(AUTO_CLOSED) 마커의 종료 시도. 같은 409지만 위와 의미가 다르다 —
    // 저쪽은 '통계·지급이 이미 커밋됨'(재시도 금지)이고, 이쪽은 '이 마커는 통계에 한 번도 반영되지 않았음'이다.
    // 앱은 이 코드를 보고 그 시간을 POST /focus-session 으로 살려 올린다(폴백해도 이중 지급이 아니다).
    SESSION_DISCARDED(HttpStatus.CONFLICT, "취소·자동마감된 집중 세션입니다."),
    OCCUPATION_REQUIRED(HttpStatus.BAD_REQUEST, "직업 정보가 없습니다."),
    OCCUPATION_TAG_NOT_RENAMABLE(HttpStatus.BAD_REQUEST, "직군 프리셋 태그는 이름을 변경할 수 없습니다.");

    private final HttpStatus status;
    private final String message;

    FocusErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
