package com.oneorthree.business.upstream.realtime.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * 실시간 서버의 메시지 한 건 — legacy {@code ChatMessageResponse} 와 같은 이름이다(그쪽이 계약이다).
 *
 * @param messageId       서버 부여 id(UUID v7). 공개 {@code id}
 * @param groupId         섬. 공개 응답에는 싣지 않는다(경로에 이미 있다)
 * @param senderId        작성자. 공개 {@code userId}
 * @param content         저장된 본문. 공개 {@code text}
 * @param sentAt          서버 수신 시각. 공개 {@code createdAt}
 * @param clientMessageId 앱 멱등 키
 */
public record RealtimeMessage(UUID messageId, UUID groupId, UUID senderId, String content, Instant sentAt,
        UUID clientMessageId) {
}
