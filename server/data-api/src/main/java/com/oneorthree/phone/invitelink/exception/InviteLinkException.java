package com.oneorthree.phone.invitelink.exception;

import com.oneorthree.phone.common.exception.DomainException;
import lombok.Getter;

/**
 * 초대 링크 도메인 예외. {@code GlobalExceptionHandler} 가 에러코드에 실린 상태로 바꿔 내보낸다.
 *
 * <p>던지는 자리가 한쪽으로 치우쳐 있다 — <b>발급·claim(인증 경로)</b> 이다.
 * 랜딩은 어떤 실패도 200 "만료" 페이지로 접는 계약이라 이 예외를 밖으로 흘리지 않는다.
 */
@Getter
public class InviteLinkException extends DomainException {

    /** 응답 상태와 본문 {@code code} 를 함께 정하는 값. */
    private final InviteLinkErrorCode errorCode;

    /**
     * @param errorCode 거절 사유. 메시지는 여기서 꺼내므로 호출부가 문구를 따로 만들지 않는다
     */
    public InviteLinkException(InviteLinkErrorCode errorCode) {
        super(errorCode);
        this.errorCode = errorCode;
    }
}
