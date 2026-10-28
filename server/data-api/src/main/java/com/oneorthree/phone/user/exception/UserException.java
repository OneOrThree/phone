package com.oneorthree.phone.user.exception;

import com.oneorthree.phone.common.exception.DomainException;
import lombok.Getter;

/**
 * user 도메인 실패를 던지는 단일 예외 — 무엇이 틀렸는지는 {@link UserErrorCode} 가 들고 있다.
 * 전역 핸들러가 그 코드에서 HTTP 상태와 응답 문구를 꺼내므로 여기서 상태를 따로 지정하지 않는다.
 */
@Getter
public class UserException extends DomainException {

    /** 응답 상태·문구와 앱의 분기(특히 404 두 갈래)를 결정하는 실패 사유. */
    private final UserErrorCode errorCode;

    /**
     * 메시지는 코드가 들고 있는 사용자 노출 문구를 그대로 쓴다.
     *
     * @param errorCode 실패 사유. 요청자 본인의 계정 부재와 지목 대상 부재를 섞어 쓰면
     *                  앱이 재로그인 유도 대신 엉뚱한 화면 처리를 한다
     */
    public UserException(UserErrorCode errorCode) {
        super(errorCode);
        this.errorCode = errorCode;
    }
}
