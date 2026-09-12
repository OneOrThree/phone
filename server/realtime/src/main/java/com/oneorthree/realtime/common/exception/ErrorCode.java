package com.oneorthree.realtime.common.exception;

import org.springframework.http.HttpStatus;

/**
 * 에러 봉투 {@code {code, message}} 의 {@code code} 를 공급하는 계약.
 *
 * <p>Data API 의 같은 이름 인터페이스와 모양을 맞춘 것은 우연이 아니다 — 앱은 두 서버를 구분하지 않고
 * {@code code} 하나로 분기하므로, 봉투가 서비스마다 다르면 앱에 분기가 두 벌 생긴다.
 *
 * <p>{@code name()} 은 enum 이 공짜로 주는 것이라 별도 구현이 필요 없다. 그 이름이 곧 앱과의 계약이므로
 * <b>상수 이름을 바꾸는 건 계약 파기</b>다(값을 늘리는 건 안전하다).
 */
public interface ErrorCode {

    /** 앱이 분기하는 기계용 식별자 — enum 상수 이름 그대로. */
    String name();

    /** 이 실패가 나갈 HTTP 상태. STOMP 경로에서는 상태 대신 에러 프레임의 참고값으로 쓰인다. */
    HttpStatus getStatus();

    /** 사람이 읽는 문구 — 화면에 그대로 노출될 수 있으므로 구현이 드러나는 말을 넣지 않는다. */
    String getMessage();
}
