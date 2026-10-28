package com.oneorthree.phone.focus.exception;

import com.oneorthree.phone.common.exception.DomainException;
import lombok.Getter;

/**
 * focus 도메인 실패를 던지는 단일 예외 — 무엇이 틀렸는지는 {@link FocusErrorCode} 가 들고 있다.
 * 전역 핸들러가 그 코드에서 HTTP 상태와 응답 문구를 꺼내므로, 여기서 상태를 따로 지정할 일은 없다.
 */
@Getter
public class FocusException extends DomainException {

    /** 응답 상태·문구·앱 분기(특히 409 두 갈래)를 결정하는 실패 사유. */
    private final FocusErrorCode errorCode;

    /**
     * 메시지는 코드가 들고 있는 사용자 노출 문구를 그대로 쓴다.
     *
     * @param errorCode 실패 사유. 앱이 이 값으로 재시도·폴백을 가르므로 아무 코드나 재사용하면 안 된다
     */
    public FocusException(FocusErrorCode errorCode) {
        super(errorCode);
        this.errorCode = errorCode;
    }
}
