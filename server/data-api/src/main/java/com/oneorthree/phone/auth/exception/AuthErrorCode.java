package com.oneorthree.phone.auth.exception;

import com.oneorthree.phone.common.exception.ErrorCode;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 계정 상태 때문에 로그인을 거절할 때 쓰는 코드 — 토큰 자체가 무효한 경우는
 * {@link InvalidTokenErrorCode} 쪽이다. 두 CONFLICT 는 <b>게스트 승격 경쟁</b>의 서로 다른 국면이고,
 * 429 는 인증 없는 게스트 생성 남용을 막는 문이다.
 *
 * <p>여기 담긴 {@code status} 를 {@code GlobalExceptionHandler} 가 그대로 응답 코드로 쓰고
 * enum 이름이 응답 본문의 {@code code} 가 되므로, <b>상수 이름을 바꾸면 앱의 분기가 깨진다</b>.
 */
@Getter
public enum AuthErrorCode implements ErrorCode {

    // 게스트가 이미 다른 계정에 연동된 소셜 계정으로 업그레이드를 시도한 경우 (GROMO-585).
    // 게스트 상태는 유지하고 클라이언트가 기존 소셜 계정으로 로그인하도록 유도한다.
    SOCIAL_ACCOUNT_ALREADY_LINKED(HttpStatus.CONFLICT, "이미 다른 계정에 연동된 소셜 계정입니다"),

    // 이미 다른 소셜 계정으로 승격이 끝난 게스트의 AT 로 새 소셜 로그인을 시도한 경우 (GROMO-1229).
    // 같은 게스트 AT 로 두 기기가 서로 다른 소셜에 동시 로그인한 경쟁의 패자 — 신규 가입 폴백이
    // 만들 빈 유령 계정(닉네임 null)을 차단한다. 클라이언트는 재로그인해 승격된 계정을 쓰면 된다.
    GUEST_ALREADY_PROMOTED(HttpStatus.CONFLICT, "이미 다른 계정으로 승격된 게스트예요"),

    // IP 당 게스트 생성 한도를 넘긴 경우 (GROMO-1510). 인증 없는 /auth/guest 로 계정을 무한히 찍어
    // 리그 랭킹·그룹 베팅을 흔드는 걸 막는다. 한도·윈도는 auth.guest.rate-limit.* 프로퍼티로 조정한다.
    GUEST_CREATION_RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "게스트 로그인 요청이 너무 많아요. 잠시 후 다시 시도해 주세요"),

    // 소셜 로그인 제공자에 클라이언트가 등록돼 있지 않다 (GROMO-1725, 종전 IllegalArgumentException 409).
    UNSUPPORTED_PROVIDER(HttpStatus.BAD_REQUEST, "지원하지 않는 소셜 로그인 제공자입니다.");

    private final HttpStatus status;
    private final String message;

    AuthErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
