package com.oneorthree.phone.auth.exception;

import com.oneorthree.phone.common.exception.DomainException;
import lombok.Getter;

/**
 * 토큰 검증 실패. {@code GlobalExceptionHandler} 가 401 로 바꿔 내보낸다.
 *
 * <p>소셜 클라이언트 구현체들은 검증 단계마다 원인이 달라도 이 예외 하나로 접어 던진다 —
 * 어느 단계에서 걸렸는지가 응답으로 새 나가지 않게 하려는 의도다.
 */
@Getter
public class InvalidTokenException extends DomainException {

    /** 응답 본문 {@code code} 가 될 값. 상태는 어느 코드든 401 이라 사실상 "어느 제공자냐"만 담는다. */
    private final InvalidTokenErrorCode errorCode;

    /**
     * @param errorCode 어느 토큰 검증에서 막혔는지. 세부 원인(서명·만료·aud)은 일부러 담지 않는다
     */
    public InvalidTokenException(InvalidTokenErrorCode errorCode) {
        super(errorCode);
        this.errorCode = errorCode;
    }
}
