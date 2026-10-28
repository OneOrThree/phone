package com.oneorthree.phone.common.exception;

/**
 * 사용자 입력에 금칙어가 들어 있다 (GROMO-1986).
 *
 * <p><b>왜 도메인 예외가 아니라 여기인가.</b> 막는 입력 6종이 {@code group}(공지·댓글·섬 이름·소개) ·
 * {@code letter}(편지) · {@code user}(닉네임) · {@code internal}(2.0 표면) 네 도메인에 걸쳐 있다.
 * 오류 계약 규약({@code docs/conventions/error-contract.md} §3)이 <b>도메인 간 code 이름 재사용</b>도
 * <b>다른 도메인 ErrorCode 빌려 쓰기</b>도 금지하므로, 네 도메인이 같은 코드 하나를 내보내려면
 * 그 코드는 공통이 소유해야 한다 — {@code RATE_LIMITED}(GROMO-1934) 와 같은 결이다.
 *
 * <p>사유가 하나뿐이라 생성자에 {@link ErrorCode} 를 받지 않는다. 코드를 고를 여지를 열면 같은 판정이
 * 호출부마다 다른 이름으로 나간다.
 */
public class BannedWordException extends DomainException {

    /** 금칙어 판정은 사유가 하나다 — {@link CommonErrorCode#BANNED_WORD}(400). */
    public BannedWordException() {
        super(CommonErrorCode.BANNED_WORD);
    }

    @Override
    public ErrorCode getErrorCode() {
        return CommonErrorCode.BANNED_WORD;
    }
}
