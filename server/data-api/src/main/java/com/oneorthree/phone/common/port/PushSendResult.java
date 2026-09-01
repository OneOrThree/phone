package com.oneorthree.phone.common.port;

/**
 * 푸시 1건의 발송 결과 — 호출측의 <b>후속 조치</b>를 가르는 값이다.
 * 세 값이 필요한 이유는 {@link #INVALID_TOKEN} 만 데이터 정리(기기 토큰 제거)를 요구하기 때문이다.
 *
 * <p>어느 값도 재시도를 뜻하지 않는다. FCM 이 5xx 를 줘도 {@link #FAILED} 로 접고 그 건은 버린다.
 */
public enum PushSendResult {
    /** 발송 성공 (FCM 200). */
    SENT,
    /** 무효 토큰 (FCM 404 UNREGISTERED / 400 INVALID_ARGUMENT) — 호출측이 deviceToken null 정리. */
    INVALID_TOKEN,
    /** 그 외 실패 (401/403 키 오설정=error 로그, 429/5xx=warn 로그) — 재시도 없음. */
    FAILED
}
