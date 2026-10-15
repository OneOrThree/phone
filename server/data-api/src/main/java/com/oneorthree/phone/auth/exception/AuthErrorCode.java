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
    UNSUPPORTED_PROVIDER(HttpStatus.BAD_REQUEST, "지원하지 않는 소셜 로그인 제공자입니다."),

    /** 내부 사용자 세션 거절. 서비스 자격 401과 구분하며 신규 Business 경로가 공개 401로 매핑한다. */
    SESSION_NOT_ACTIVE(HttpStatus.FORBIDDEN, "유효한 로그인 세션이 아닙니다."),

    // 레거시 /api/v1/auth/* 의 선택 AT 세션 관문 거절 (GROMO-1929) — SESSION_NOT_ACTIVE 와 같은
    // 판정이지만 이 경로는 Business 매핑 없이 앱에 직접 닿으므로 공개 상태(401)를 enum 에 새긴다.
    LEGACY_SESSION_NOT_ACTIVE(HttpStatus.UNAUTHORIZED, "유효한 로그인 세션이 아닙니다."),

    // 같은 X-Login-Attempt-Id 를 다른 실행자가 이미 잡고 제공자 교환 중이다 (GROMO-1908, LLD §3).
    // 「같은 자격이지만 아직 결과가 없다」는 뜻이라 IDEMPOTENCY_KEY_CONFLICT(다른 자격)와 갈린다 —
    // 합치면 앱이 「키를 잘못 썼다」로 읽고 새 시도를 만들어, 막으려던 동시 code 교환이 그대로 생긴다.
    // Business 가 공개 409 REQUEST_IN_PROGRESS(Retry-After: 1)로 매핑한다.
    LOGIN_ATTEMPT_IN_PROGRESS(HttpStatus.CONFLICT, "로그인을 처리 중입니다. 잠시 후 다시 시도해 주세요."),

    // 그 로그인 시도로는 더 진행할 수 없다 — 복구 창이 끝났거나(LLD §3 고정 복구 마감), 주체가
    // 폐기됐거나(INVALIDATED), Business 의 digest 비밀이 교체돼 원 자격을 재현할 수 없다.
    // ⚠️ 키 교체를 IDEMPOTENCY_KEY_REUSED 로 판정하지 «않는다»(LLD §3 명시) — 자격을 바르게 들고 온
    // 정상 사용자가 배포 한 번에 409 로 막히고, 앱은 그걸 「키 오용」으로 읽어 복구를 포기한다.
    // 답은 언제나 같다: 새 제공자 인증. 그래서 401 하나로 모은다.
    LOGIN_ATTEMPT_UNUSABLE(HttpStatus.UNAUTHORIZED, "로그인을 다시 시도해 주세요.");

    private final HttpStatus status;
    private final String message;

    AuthErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
