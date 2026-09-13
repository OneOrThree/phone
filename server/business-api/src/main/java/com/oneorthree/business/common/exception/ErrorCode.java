package com.oneorthree.business.common.exception;

import org.springframework.http.HttpStatus;

/**
 * 실패 사유의 공통 계약 — Data API 의 같은 이름 인터페이스와 <b>같은 모양</b>이다.
 *
 * <p>봉투는 {@code {"code": name(), "message": getMessage()}} 이고 HTTP 상태는 {@link #getStatus()} 다.
 * 앱이 {@code code} 문자열로 분기하므로 <b>상수 이름은 계약</b>이다. Business 를 앞에 세워도 앱이 보는
 * 문자열은 바뀌지 않아야 하며, 상류가 도메인 코드를 주면 <b>그 코드를 그대로 중계</b>한다
 * ({@link UpstreamDomainException}).
 */
public interface ErrorCode {

    /** 앱이 분기하는 기계용 식별자 — enum 상수 이름 그대로. */
    String name();

    /** 이 실패가 나갈 HTTP 상태. */
    HttpStatus getStatus();

    /** 사람이 읽는 문구 — 화면에 그대로 노출될 수 있으므로 구현이 드러나는 말을 넣지 않는다. */
    String getMessage();
}
