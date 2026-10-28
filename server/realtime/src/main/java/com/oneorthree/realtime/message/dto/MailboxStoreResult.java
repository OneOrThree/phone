package com.oneorthree.realtime.message.dto;

/**
 * 우체통 내부 POST 의 응답 — 저장된 메시지와 <b>이번에 처음 저장됐는가</b>.
 *
 * <p>둘째 값이 wire 에 실리는 이유: {@code message.created} 의 outbox 적재는 Business 가 Data 에
 * 하는데, 재전송(이미 있던 행)에도 적재하면 같은 메시지의 사건이 두 번 남는다. 상태 코드로 가르지
 * 않는 것은 Business 의 상류 클라이언트가 본문만 돌려주기 때문이다.
 *
 * @param message 저장된(또는 이미 있던) 메시지
 * @param freshlyInserted 이번 호출이 행을 만들었으면 true. 재전송이면 false
 */
public record MailboxStoreResult(ChatMessageResponse message, boolean freshlyInserted) {
}
