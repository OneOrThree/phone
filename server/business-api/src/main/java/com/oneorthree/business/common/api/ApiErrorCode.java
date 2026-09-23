package com.oneorthree.business.common.api;

import com.oneorthree.business.common.exception.ErrorCode;
import org.springframework.http.HttpStatus;

/** GROMO-1750 신규 공개 오류 표. legacy 오류 상수와 분리한다. */
public enum ApiErrorCode implements ErrorCode {
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "요청 형식이 올바르지 않습니다.", false),
    INVALID_PARAMETER(HttpStatus.BAD_REQUEST, "요청 파라미터가 올바르지 않습니다.", false),
    INVALID_IDEMPOTENCY_KEY(HttpStatus.BAD_REQUEST, "명령 키가 올바르지 않습니다.", false),
    INVALID_CURSOR(HttpStatus.BAD_REQUEST, "목록 커서가 올바르지 않습니다.", false),
    UNSUPPORTED_PROVIDER(HttpStatus.BAD_REQUEST, "지원하지 않는 소셜 로그인 제공자입니다.", false),
    // 계정 LLD §5 (GROMO-1801). Data 의 UserErrorCode·GroupErrorCode 와 «이름·상태가 같아야»
    // registeredUpstream 이 붙는다 — 없으면 정상적인 닉네임 거절·방장 탈퇴 거절이 502 로 나간다.
    NICKNAME_INVALID(HttpStatus.BAD_REQUEST, "닉네임은 앞뒤 공백 제외 2~10자여야 합니다.", false),
    // GROMO-1986. Data 의 CommonErrorCode.BANNED_WORD 와 이름·상태가 같아야 registeredUpstream 이 붙는다 —
    // 없으면 「욕설을 걸렀다」는 정상 400 이 502 UPSTREAM_CONTRACT_ERROR 로 나가 서버 장애처럼 보이고,
    // 앱은 사용자에게 왜 막혔는지 안내할 수 없다(NICKNAME_INVALID 와 같은 이유로 여기 둔다).
    BANNED_WORD(HttpStatus.BAD_REQUEST, "사용할 수 없는 표현이 포함돼 있어요.", false),
    HOST_WITHDRAW(HttpStatus.BAD_REQUEST, "섬 방장을 위임한 뒤 탈퇴할 수 있습니다.", false),
    REFRESH_TOKEN(HttpStatus.UNAUTHORIZED, "로그인 자격이 유효하지 않습니다.", false),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "인증이 필요합니다. 다시 로그인해 주세요.", false),
    // 제공자 «자격» 검증 실패 6종 (계정 LLD §2.1 · 정책 A18). Data 의 InvalidTokenErrorCode 와
    // 이름이 같아야 GlobalExceptionHandler.registeredUpstream 의 valueOf 매핑이 붙는다.
    //
    // ⚠️ 이걸 UNAUTHORIZED 로 뭉치지 않는다. 「애플 토큰이 만료됐다」와 「우리 AT 가 없다」는 앱이
    //    해야 할 일이 다르다 — 전자는 그 제공자로 다시 인증, 후자는 refresh/재로그인이다. 그리고
    //    이 코드들이 없으면 registeredUpstream 이 매핑에 실패해 «정상적인 401 이 502 로 나간다»:
    //    잘못된 애플 토큰 하나가 서버 장애처럼 보이는 것이 이 여섯 줄이 없을 때의 실제 결과다.
    KAKAO_TOKEN(HttpStatus.UNAUTHORIZED, "카카오 로그인 자격이 유효하지 않습니다.", false),
    APPLE_TOKEN(HttpStatus.UNAUTHORIZED, "애플 로그인 자격이 유효하지 않습니다.", false),
    GOOGLE_TOKEN(HttpStatus.UNAUTHORIZED, "구글 로그인 자격이 유효하지 않습니다.", false),
    LINE_TOKEN(HttpStatus.UNAUTHORIZED, "라인 로그인 자격이 유효하지 않습니다.", false),
    INSTAGRAM_TOKEN(HttpStatus.UNAUTHORIZED, "인스타그램 로그인 자격이 유효하지 않습니다.", false),
    FACEBOOK_TOKEN(HttpStatus.UNAUTHORIZED, "페이스북 로그인 자격이 유효하지 않습니다.", false),
    FORBIDDEN(HttpStatus.FORBIDDEN, "이 작업을 수행할 권한이 없습니다.", false),
    FACILITY_LOCKED(HttpStatus.FORBIDDEN, "필요한 시설을 먼저 열어 주세요.", false),
    // GROMO-1992. Data 의 CommonErrorCode.SOCIAL_LOGIN_REQUIRED 와 이름·상태가 같아야
    // registeredUpstream 이 붙는다 — 없으면 「게스트라 막았다」는 정상 403 이 502 로 나가고,
    // 앱은 소셜 로그인 안내 대신 「서버 장애」를 띄운다. 일반 FORBIDDEN 과 코드를 «가르는» 이유는
    // 앱이 이 하나에만 회원 전환 화면을 열어야 하기 때문이다.
    SOCIAL_LOGIN_REQUIRED(HttpStatus.FORBIDDEN, "소셜 로그인하면 이용할 수 있어요.", false),
    NOT_FOUND(HttpStatus.NOT_FOUND, "요청한 대상을 찾을 수 없습니다.", false),
    USER_NOT_FOUND(HttpStatus.NOT_FOUND, "사용자를 찾을 수 없습니다. 다시 로그인해 주세요.", false),
    GROUP_NOT_FOUND(HttpStatus.NOT_FOUND, "섬을 찾을 수 없습니다.", false),
    RESOURCE_NOT_FOUND(HttpStatus.NOT_FOUND, "요청 경로를 찾을 수 없습니다.", false),
    PRODUCT_NOT_FOUND(HttpStatus.NOT_FOUND, "상품을 찾을 수 없습니다.", false),
    SLUG_NOT_FOUND(HttpStatus.NOT_FOUND, "초대 링크를 찾을 수 없습니다.", false),
    METHOD_NOT_ALLOWED(HttpStatus.METHOD_NOT_ALLOWED, "지원하지 않는 요청 방식입니다.", false),
    VERSION_CONFLICT(HttpStatus.CONFLICT, "상태가 변경되었습니다. 최신 내용을 확인해 주세요.", false),
    STATE_CONFLICT(HttpStatus.CONFLICT, "현재 상태에서는 이 작업을 수행할 수 없습니다.", false),
    INSUFFICIENT_FUNDS(HttpStatus.CONFLICT, "잔액이 부족합니다.", false),
    NICKNAME_DUPLICATE(HttpStatus.CONFLICT, "이미 사용 중인 닉네임입니다.", false),
    IDEMPOTENCY_KEY_REUSED(HttpStatus.CONFLICT, "다른 요청에 사용한 명령 키입니다.", false),
    // GROMO-1994. Data 의 AuthErrorCode.SOCIAL_ACCOUNT_ALREADY_LINKED(409)와 이름·상태가 같아야
    // 매핑이 붙는다. 없으면 「이 소셜은 이미 다른 계정 것」이라는 정상 409 가 502 로 나가 앱이
    // 전환 확인 다이얼로그를 띄울 수 없다 — 그게 2단계 흐름의 «1단계» 다.
    // 일반 STATE_CONFLICT 로 접지 않는 이유도 그것이다: 앱이 이 코드에만 전환을 묻는다.
    SOCIAL_ACCOUNT_ALREADY_LINKED(HttpStatus.CONFLICT, "이미 다른 계정에 연동된 소셜 계정입니다", false),
    // GROMO-2053. Data 의 AuthErrorCode.GUEST_ALREADY_PROMOTED(409)와 이름·상태가 같아야
    // registeredUpstream 이 붙는다 — 없으면 「승격 경쟁의 패자」라는 정상 409 가 502 로 나가
    // 앱이 재로그인 안내 대신 서버 장애를 띄운다(SOCIAL_ACCOUNT_ALREADY_LINKED 와 같은 결).
    GUEST_ALREADY_PROMOTED(HttpStatus.CONFLICT, "이미 다른 계정으로 승격된 게스트예요", false),
    REQUEST_IN_PROGRESS(HttpStatus.CONFLICT, "요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.", true),
    CURSOR_EXPIRED(HttpStatus.CONFLICT, "목록 커서가 만료되었습니다. 처음부터 조회해 주세요.", false),
    INVITATION_EXPIRED(HttpStatus.GONE, "초대가 만료되었거나 폐기되었습니다.", false),
    REQUEST_TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE, "요청 본문이 너무 큽니다.", false),
    UNSUPPORTED_MEDIA_TYPE(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "지원하지 않는 요청 형식입니다.", false),
    OUT_OF_RANGE(HttpStatus.UNPROCESSABLE_ENTITY, "입력값이 허용 범위를 벗어났습니다.", false),
    RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "요청이 많습니다. 잠시 후 다시 시도해 주세요.", true),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "요청을 처리할 수 없습니다.", false),
    UPSTREAM_CONTRACT_ERROR(HttpStatus.BAD_GATEWAY, "요청을 처리할 수 없습니다.", false),
    UPSTREAM_AUTH_FAILED(HttpStatus.BAD_GATEWAY, "요청을 처리할 수 없습니다.", false),
    SERVICE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "잠시 후 다시 시도해 주세요.", true),
    UPSTREAM_TIMEOUT(HttpStatus.GATEWAY_TIMEOUT, "응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", true);

    private final HttpStatus status;
    private final String message;
    private final boolean retryable;

    ApiErrorCode(HttpStatus status, String message, boolean retryable) {
        this.status = status;
        this.message = message;
        this.retryable = retryable;
    }

    @Override
    public HttpStatus getStatus() {
        return status;
    }

    @Override
    public String getMessage() {
        return message;
    }

    public boolean isRetryable() {
        return retryable;
    }
}
