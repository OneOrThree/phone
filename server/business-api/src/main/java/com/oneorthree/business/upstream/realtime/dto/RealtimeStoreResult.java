package com.oneorthree.business.upstream.realtime.dto;

/**
 * 저장 응답 — 메시지와 «이번에 처음 저장됐는가». 후자가 {@code message.created} 적재 여부를 정한다:
 * 재전송(이미 있던 행)에 또 적으면 같은 메시지의 사건이 두 번 남는다.
 *
 * @param message         저장된(또는 이미 있던) 메시지
 * @param freshlyInserted 이번 호출이 행을 만들었으면 true
 */
public record RealtimeStoreResult(RealtimeMessage message, boolean freshlyInserted) {
}
