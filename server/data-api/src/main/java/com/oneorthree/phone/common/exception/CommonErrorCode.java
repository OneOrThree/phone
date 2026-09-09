package com.oneorthree.phone.common.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 도메인에 속하지 않는 실패 사유 (GROMO-1657) — 프레임워크·인프라 예외를 봉투에 실을 때 쓴다.
 *
 * <p><b>왜 따로 두나.</b> 종전엔 전역 핸들러가 {@code "INVALID_PARAMETER"} 같은 문자열을 손으로
 * 박았고, 낙관락 충돌 코드는 {@code GroupErrorCode.CONCURRENT_UPDATE} 를 <b>빌려</b> 썼다 —
 * {@code common} 이 {@code group} 을 참조하는 유일한 자리였다. 공통 실패는 공통이 소유한다.
 *
 * <p><b>이름은 계약이다.</b> 종전에도 나가던 다섯({@code INVALID_PARAMETER} · {@code INVALID_TIMEZONE} ·
 * {@code DATA_INTEGRITY_VIOLATION} · {@code CONCURRENT_UPDATE} · {@code LOGIN_USER_RESOLUTION_FAILED})은
 * 문자열·상태·문구가 종전과 글자 그대로 같다. {@code ILLEGAL_ARGUMENT} 는 <b>문자열만</b> 같다 —
 * 문구는 일부러 바꿨고(종전엔 예외 메시지를 그대로 반사해 내부 구현이 드러났다), 상태는 GROMO-1725 에서
 * 409 → 400 으로 바꿨다.
 * {@code UNAUTHORIZED} · {@code PAYLOAD_TOO_LARGE} 는 필터가 {@code {"error": …}} 로 내던 것에
 * 같은 이름으로 {@code code}·{@code message} 를 <b>더한</b> 것이다({@code error} 필드는 남긴다).
 * 그 외 새로 생긴 것은 종전에 봉투 없이 새던 경로에 처음으로 {@code code} 를 주는 것이라 앱 계약을
 * 깨지 않는다.
 *
 * <p><b>{@code NOT_FOUND} 를 쓰지 않는 이유</b> — 앱이 그 문자열을 「그룹이 사라짐」으로 해석하는
 * 분기가 17곳이다(GROMO-1725). 없는 경로·없는 엔티티에 그 코드를 주면 엉뚱한 안내가 뜬다.
 */
@Getter
public enum CommonErrorCode implements ErrorCode {

    /** 토큰이 없거나 검증에 실패했다 — {@code JwtFilter} 가 디스패처 앞에서 직접 쓴다. */
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "인증이 필요합니다. 다시 로그인해 주세요."),
    /** 요청 본문이 상한을 넘었다 — {@code RequestSizeLimitFilter} 가 디스패처 앞에서 직접 쓴다. */
    PAYLOAD_TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE, "요청 본문이 너무 큽니다."),
    /** 요청 바디가 검증({@code @Valid})에 걸렸거나 JSON 으로 읽을 수 없다. */
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "요청 형식이 올바르지 않습니다."),
    /** 쿼리·경로 파라미터가 없거나 타입이 맞지 않는다. 문구에는 파라미터 이름이 붙는다. */
    INVALID_PARAMETER(HttpStatus.BAD_REQUEST, "요청 파라미터 형식이 올바르지 않습니다."),
    /** 클라이언트가 보낸 타임존 id 를 해석하지 못했다. 문구는 그 id 를 되돌려 준다. */
    INVALID_TIMEZONE(HttpStatus.BAD_REQUEST, "알 수 없는 타임존입니다."),
    /** 요청 {@code Content-Type} 을 받을 수 없다 (예: {@code @RequestBody} 에 {@code text/plain}). */
    UNSUPPORTED_MEDIA_TYPE(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "지원하지 않는 요청 형식입니다."),
    /** 요청 {@code Accept} 로는 응답을 만들 수 없다. */
    NOT_ACCEPTABLE(HttpStatus.NOT_ACCEPTABLE, "지원하지 않는 응답 형식입니다."),
    /** 경로는 있는데 그 HTTP 메서드를 받지 않는다. */
    METHOD_NOT_ALLOWED(HttpStatus.METHOD_NOT_ALLOWED, "허용되지 않는 요청 방식입니다."),
    /** 그런 경로가 없다 — 앱의 «그룹이 사라짐» 분기({@code NOT_FOUND})와 섞이지 않게 따로 둔다. */
    RESOURCE_NOT_FOUND(HttpStatus.NOT_FOUND, "요청한 경로를 찾을 수 없습니다."),
    /**
     * JPA {@code EntityNotFoundException} — 도메인 예외로 감싸지 않은 조회가 빈 결과를 만났다.
     * 종전엔 매핑이 없어 <b>500</b> 이 나갔다(item, GROMO-895). 도메인 코드로 치환되면 이 코드는 안 쓰인다.
     */
    ENTITY_NOT_FOUND(HttpStatus.NOT_FOUND, "요청한 대상을 찾을 수 없습니다."),
    /**
     * 어디서도 잡히지 않은 {@code IllegalArgumentException} — 잘못된 입력이라 <b>400</b> 이다 (GROMO-1725).
     * 종전엔 409 였는데, 앱이 «충돌 → 재시도»로 오해할 수 있었다. 앱의 {@code status === 409} 분기 6곳은
     * 전부 도메인 코드(닉네임 중복·이미 친구·마지막 소셜 연동)가 원천이라 이 전환에 영향이 없다(실측).
     * 앱까지 닿던 raw 발급 3곳(집중 세션 시각·친구 검색 수단·소셜 제공자)은 도메인 코드로 치환됐으므로
     * 이 그물에 남는 것은 리포지토리·값객체 내부 가드뿐이다. 문구는 예외 메시지를 반사하지 않는다.
     */
    ILLEGAL_ARGUMENT(HttpStatus.BAD_REQUEST, "요청을 처리할 수 없습니다."),
    /** DB 유니크·무결성 제약 위반 — 사전 검사를 뚫은 동시 요청의 최종 폴백. */
    DATA_INTEGRITY_VIOLATION(HttpStatus.CONFLICT, "요청이 기존 데이터와 충돌합니다."),
    /** 낙관락·비관락 충돌 — 트랜잭션은 롤백됐고 그대로 재시도하면 풀린다. */
    CONCURRENT_UPDATE(HttpStatus.CONFLICT, "잠시 후 다시 시도해주세요"),
    /** {@code @LoginUser} 주입 실패 — 재시도로 풀리지 않는 서버 배선 오류. */
    LOGIN_USER_RESOLUTION_FAILED(HttpStatus.INTERNAL_SERVER_ERROR, "서버 설정 오류로 요청을 처리하지 못했습니다."),
    /** 그 외 전부. 원인은 로그에만 남는다 — 응답에 내부 정보를 싣지 않는다. */
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.");

    private final HttpStatus status;
    private final String message;

    CommonErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
