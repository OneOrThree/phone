package com.oneorthree.phone.common.exception;

import org.springframework.http.HttpStatus;

/**
 * 도메인 실패 사유의 공통 계약 (GROMO-1657) — 각 도메인의 {@code XxxErrorCode} enum 이 구현한다.
 *
 * <p><b>왜 인터페이스인가.</b> enum 11개가 전부 {@code (HttpStatus, String)} 같은 모양이었는데
 * 공통 타입이 없어서, 전역 핸들러가 도메인마다 글자 그대로 같은 메서드를 11개 들고 있었다.
 * 새 도메인이 생길 때마다 핸들러에 한 줄을 더 붙여야 했고, 빠뜨리면 그 도메인 예외는 스프링
 * 기본 {@code /error} 바디로 새어 나갔다. 계약을 타입으로 묶으면 핸들러는 하나로 족하고,
 * 빠뜨릴 자리 자체가 없어진다.
 *
 * <p><b>응답 규칙</b> — {@code ErrorResponse.code} 는 {@link #name()} 그대로, HTTP 상태는
 * {@link #getStatus()}, 본문 {@code message} 는 {@link #getMessage()} 다. 앱이 {@code code}
 * 문자열로 분기하므로 <b>상수 이름은 계약</b>이다 — 개명·삭제는 앱을 깨뜨린다.
 *
 * <p>{@link #name()} 은 enum 이 이미 갖고 있어 구현체가 따로 쓸 것이 없다. 이 인터페이스를
 * enum 이 아닌 클래스가 구현하면 {@code name()} 을 손으로 채워야 하는데, 그럴 이유가 없다 —
 * 실패 사유는 열거형이어야 앱이 분기할 수 있다.
 */
public interface ErrorCode {

    /** 앱이 분기하는 기계용 식별자 — enum 상수 이름 그대로. */
    String name();

    /** 이 실패가 나갈 HTTP 상태. */
    HttpStatus getStatus();

    /** 사람이 읽는 문구 — 화면에 그대로 노출될 수 있으므로 구현이 드러나는 말을 넣지 않는다. */
    String getMessage();
}
