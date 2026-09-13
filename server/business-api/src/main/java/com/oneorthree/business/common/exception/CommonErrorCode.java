package com.oneorthree.business.common.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 이 서비스가 «스스로» 내리는 실패 사유. 상류가 내린 판정은 {@link UpstreamDomainException} 으로
 * 코드까지 그대로 중계하므로 여기 들어오지 않는다.
 *
 * <p><b>이름은 Data API 의 {@code CommonErrorCode} 와 글자 그대로 맞춘다</b> — 앱이 같은 문자열로
 * 분기하고 있고, Business 를 앞에 세운 것만으로 그 분기가 빠지면 안 된다.
 */
@Getter
public enum CommonErrorCode implements ErrorCode {

    /** 토큰이 없거나 검증에 실패했다 — {@code AccessTokenFilter} 가 디스패처 앞에서 직접 쓴다. */
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "인증이 필요합니다. 다시 로그인해 주세요."),
    /** 요청 바디가 검증({@code @Valid})에 걸렸거나 JSON 으로 읽을 수 없다. */
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "요청 형식이 올바르지 않습니다."),
    /** 쿼리·경로·헤더 파라미터가 없거나 타입이 맞지 않는다. */
    INVALID_PARAMETER(HttpStatus.BAD_REQUEST, "요청 파라미터 형식이 올바르지 않습니다."),
    /** 요청 {@code Content-Type} 을 받을 수 없다. */
    UNSUPPORTED_MEDIA_TYPE(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "지원하지 않는 요청 형식입니다."),
    /** 해당 method 를 지원하지 않는 경로다. */
    METHOD_NOT_ALLOWED(HttpStatus.METHOD_NOT_ALLOWED, "지원하지 않는 요청 방식입니다."),
    /**
     * 탈퇴·비활성 사용자가 위성 쓰기를 시도했다 — <b>위성 쓰기 전 Data 활성 검사</b>(A22 ⓖ)의 결과다.
     * 위성 직행 쓰기는 Data 의 {@code X-User-Id} 검사를 안 거치므로, 이 검사가 없으면 탈퇴 직전 발급된
     * AT 로 최대 AT 수명 동안 기기 토큰을 재등록하거나 초대를 귀속시킬 수 있다.
     */
    USER_INACTIVE(HttpStatus.UNAUTHORIZED, "인증이 필요합니다. 다시 로그인해 주세요."),
    /**
     * 상류가 응답하지 않아 <b>판정을 내릴 수 없다</b>. 「아니오」로 접지 않는다 — 장애를 거부로 접으면
     * 사용자는 원인을 못 찾고, 기기 토큰·설정처럼 앱이 실패를 삼키는 경로는 영구 유실이 된다.
     */
    UPSTREAM_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요."),
    /**
     * 이 서비스의 <b>서비스 토큰</b>이 상류에서 거절됐다(401/403). 요청자의 문제가 아니라 배포·시크릿
     * 배선 사고이므로 사용자에게 401 을 주지 않는다 — 그러면 정상 세션이 전부 재로그인으로 튄다.
     */
    UPSTREAM_CREDENTIAL_REJECTED(HttpStatus.BAD_GATEWAY, "일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요."),
    /** 상류가 우리 요청을 해석하지 못했다(코드 없는 4xx) — 배선·계약 어긋남이다. 사용자 탓으로 돌리지 않는다. */
    UPSTREAM_CONTRACT_MISMATCH(HttpStatus.BAD_GATEWAY, "일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요."),
    /** 이관 정지 창 밖에서 한시 호환 핸들러가 호출됐다. */
    COMPAT_HANDLER_DISABLED(HttpStatus.NOT_FOUND, "지원하지 않는 요청입니다."),
    /**
     * 매핑되지 않은 경로다.
     *
     * <p>전역 핸들러의 {@code Exception} 그물에 걸리면 <b>500</b> 이 되는데, 그건 라우팅 문제를
     * 「서버 장애」로 보이게 만든다(실제로 컨테이너 검증에서 {@code /actuator/health} 를 서비스 포트로
     * 부르니 500 이 나왔다 — 관리 포트 격리가 정상 동작한 것인데 장애처럼 보였다).
     *
     * <p>⚠️ {@code NOT_FOUND} 라는 이름을 쓰지 않는다 — 앱이 그 문자열을 「그룹이 사라짐」으로
     * 해석하는 분기가 17곳이다(GROMO-1725). Data API 의 {@code CommonErrorCode} 가 같은 이유로
     * 그 이름을 피한다.
     */
    ENDPOINT_NOT_FOUND(HttpStatus.NOT_FOUND, "지원하지 않는 요청입니다."),
    /** 그 밖의 예상하지 못한 실패. */
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");

    private final HttpStatus status;
    private final String message;

    CommonErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
