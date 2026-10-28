package com.oneorthree.phone.common.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/** 도메인에 속하지 않는 요청 검증·인프라 오류의 공통 응답 코드. */
@Getter
public enum CommonErrorCode implements ErrorCode {

    /** 액세스 자격이 없거나 검증에 실패했다. */
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "인증이 필요합니다. 다시 로그인해 주세요."),
    /** 요청 바디가 검증({@code @Valid})에 걸렸거나 JSON 으로 읽을 수 없다. */
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "요청 형식이 올바르지 않습니다."),
    /** 쿼리·경로 파라미터가 없거나 타입이 맞지 않는다. 문구에는 파라미터 이름이 붙는다. */
    INVALID_PARAMETER(HttpStatus.BAD_REQUEST, "요청 파라미터 형식이 올바르지 않습니다."),
    /**
     * 사용자 입력에 금칙어가 들어 있다 (GROMO-1986, 앱스토어 심사 지침 1.2).
     * 막는 입력 6종이 {@code group}·{@code letter}·{@code user}·{@code internal} 네 도메인에 걸쳐 있어
     * 공통이 코드를 소유한다 — {@link #RATE_LIMITED} 와 같은 이유다. 길이 초과(422)와 상태가 다르다:
     * 앱이 「줄여 주세요」와 「다른 말로 써 주세요」를 다른 안내로 띄워야 한다.
     */
    BANNED_WORD(HttpStatus.BAD_REQUEST, "사용할 수 없는 표현이 포함돼 있어요."),
    /**
     * 게스트가 회원 전용 작업을 시도했다 (GROMO-1992, 정책 「인증·게스트 계정」 —
     * 「친구 추가·편지 보내기·상점 구매를 처음 시도할 때 소셜 로그인을 요청한다」).
     * 막는 작업이 {@code friend}·{@code shop} 두 도메인에 걸쳐 있어 공통이 코드를 소유한다 —
     * {@link #BANNED_WORD}·{@link #RATE_LIMITED} 와 같은 이유다(오류 계약 규약 §3 이 도메인 간
     * code 이름 재사용도, 남의 {@code ErrorCode} 빌려 쓰기도 금지한다).
     * <p>{@code GroupErrorCode.MEMBER_ONLY}(섬 «주민» 인가)와 <b>축이 다르다</b> — 이쪽은 계정
     * 상태(게스트/회원), 저쪽은 섬 안의 역할이다. 이름이 비슷하면 앱이 두 안내를 섞으므로
     * 「무엇을 하면 풀리는가」(소셜 로그인)를 이름에 담았다.
     */
    SOCIAL_LOGIN_REQUIRED(HttpStatus.FORBIDDEN, "소셜 로그인하면 이용할 수 있어요."),
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
    /**
     * 계정당 시간 한도 초과 (GROMO-1934 — 게스트 친구 요청 · 전 계정 편지 발송). 응답에 {@code retryAfterMs} 가 붙는다.
     * Business 공개 표의 {@code RATE_LIMITED}(429)와 이름·상태가 같아야 이름 매핑이 붙는다.
     */
    RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "요청이 많습니다. 잠시 후 다시 시도해 주세요."),
    /** 그 외 전부. 원인은 로그에만 남는다 — 응답에 내부 정보를 싣지 않는다. */
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.");

    private final HttpStatus status;
    private final String message;

    CommonErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }
}
