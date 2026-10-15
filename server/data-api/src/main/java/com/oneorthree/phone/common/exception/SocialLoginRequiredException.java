package com.oneorthree.phone.common.exception;

/**
 * 게스트가 회원 전용 작업을 시도했다 (GROMO-1992).
 *
 * <p><b>왜 도메인 예외가 아니라 여기인가.</b> 막는 작업이 {@code friend}(친구 요청) ·
 * {@code shop}(상점 구매) 두 도메인에 걸쳐 있다. 오류 계약 규약({@code docs/conventions/error-contract.md}
 * §3)이 <b>도메인 간 code 이름 재사용</b>도 <b>다른 도메인 ErrorCode 빌려 쓰기</b>도 금지하므로,
 * 두 도메인이 같은 코드 하나를 내보내려면 그 코드는 공통이 소유해야 한다 —
 * {@link BannedWordException}(GROMO-1986) 과 같은 결이다.
 *
 * <p>사유가 하나뿐이라 생성자에 {@link ErrorCode} 를 받지 않는다.
 */
public class SocialLoginRequiredException extends DomainException {

    /** 게스트 차단은 사유가 하나다 — {@link CommonErrorCode#SOCIAL_LOGIN_REQUIRED}(403). */
    public SocialLoginRequiredException() {
        super(CommonErrorCode.SOCIAL_LOGIN_REQUIRED);
    }

    @Override
    public ErrorCode getErrorCode() {
        return CommonErrorCode.SOCIAL_LOGIN_REQUIRED;
    }
}
