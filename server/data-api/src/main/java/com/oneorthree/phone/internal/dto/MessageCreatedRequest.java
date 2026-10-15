package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.util.UUID;

/**
 * 저장이 끝난 메시지의 사건 입력 — {@code message.created} payload 의 식별자·시각뿐이다(LLD §5). 작성자는 본문이
 * 아니라 {@code X-User-Id} 다. <b>본문 text 는 받지 않는다</b> — M02(메시지 정본은 gromo_chat, Data 복제 금지).
 *
 * @param messageId       realtime 이 부여한 메시지 id — eventId·순서 축의 근거
 * @param clientMessageId 앱이 만든 멱등 키
 * @param sentAt          서버 수신 시각
 */
public record MessageCreatedRequest(
        @NotNull UUID messageId,
        @NotNull UUID clientMessageId,
        @NotNull Instant sentAt) {
}
