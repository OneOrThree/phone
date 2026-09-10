package com.oneorthree.chat.common.exception;

import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;

/**
 * 도메인에 속하지 않는 실패 — 인증, 형식 오류, 상류 장애, 못 잡은 예외.
 *
 * <p>도메인 규칙 위반(같은 섬이 아니다 · 집중 중이다)은 여기 두지 않는다. 그건
 * {@code ChatErrorCode} 의 몫이고, 이 enum 은 «채팅이라서» 생긴 실패가 아닌 것만 담는다.
 */
@Getter
@RequiredArgsConstructor
public enum CommonErrorCode implements ErrorCode {

    /**
     * 토큰이 없거나·서명/만료가 무효거나·{@code type} 이 access 가 아닐 때. 세 경우를 구분하지 않는 건
     * 앱이 401 을 «재로그인» 트리거 하나로 처리하기 때문이고, 구분해 봐야 공격자에게만 정보가 된다.
     */
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "인증이 필요합니다."),

    /** 본문·파라미터가 형식을 어겼을 때(@Valid 위반, 파싱 실패). 어느 필드인지는 본문에 싣지 않는다. */
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, "요청 형식이 올바르지 않습니다."),

    /**
     * 상류(Data API) 가 응답하지 않아 <b>판정을 내릴 수 없을 때</b>. 멤버십을 확인하지 못한 채 통과시키면
     * 남의 섬 대화가 새므로 fail-closed 로 거절한다 — 채팅이 잠깐 안 되는 쪽이 대화가 새는 쪽보다 낫다.
     */
    UPSTREAM_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "잠시 후 다시 시도해 주세요."),

    /** 위 어디에도 안 걸린 예외. 원인 문자열은 로그에만 남기고 본문에는 절대 싣지 않는다. */
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "일시적인 오류가 발생했습니다.");

    private final HttpStatus status;
    private final String message;
}
