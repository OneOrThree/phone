package com.oneorthree.phone.invitelink.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 초대 링크 도메인 에러 코드.
 *
 * <p>이름은 응답 본문의 {@code code} 로 그대로 나가 앱이 분기에 쓴다(스펙 §4-2 계약) — 변경 금지.
 */
@Getter
public enum InviteLinkErrorCode {

    GROUP_NOT_FOUND(HttpStatus.NOT_FOUND, "그룹을 찾을 수 없습니다."),
    NOT_MEMBER(HttpStatus.FORBIDDEN, "그룹원만 초대 링크를 만들 수 있습니다."),
    SLUG_NOT_FOUND(HttpStatus.NOT_FOUND, "초대 링크를 찾을 수 없습니다."),
    INVALID_MATCH_REQUEST(HttpStatus.BAD_REQUEST, "매치 요청 형식이 올바르지 않습니다."),
    SLUG_GENERATION_FAILED(HttpStatus.INTERNAL_SERVER_ERROR, "초대 링크 생성에 실패했습니다.");

    private final HttpStatus status;
    private final String message;

    InviteLinkErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
