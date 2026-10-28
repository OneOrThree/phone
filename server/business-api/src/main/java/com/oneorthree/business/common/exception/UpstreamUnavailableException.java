package com.oneorthree.business.common.exception;

/**
 * 상류가 응답하지 않았다 — 타임아웃 · 연결 불가 · 5xx · 서킷 오픈.
 *
 * <p><b>「아니오」가 아니라 「모른다」다.</b> 이 실패를 정상 응답(빈 결과·matched:false·204)으로 접으면
 * ⓐ 초대 매치는 되돌릴 수 없는 {@code matched:false} 가 되고 ⓑ 기기 토큰·설정은 앱이 실패를 삼켜
 * 영구 유실된다. 그래서 503 으로 올린다.
 */
public class UpstreamUnavailableException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public UpstreamUnavailableException(String message) {
        super(message);
    }

    public UpstreamUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
