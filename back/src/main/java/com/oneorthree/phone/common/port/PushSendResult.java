package com.oneorthree.phone.common.port;

public enum PushSendResult {
    /** 발송 성공 (FCM 200). */
    SENT,
    /** 무효 토큰 (FCM 404 UNREGISTERED / 400 INVALID_ARGUMENT) — 호출측이 deviceToken null 정리. */
    INVALID_TOKEN,
    /** 그 외 실패 (401/403 키 오설정=error 로그, 429/5xx=warn 로그) — 재시도 없음. */
    FAILED
}
