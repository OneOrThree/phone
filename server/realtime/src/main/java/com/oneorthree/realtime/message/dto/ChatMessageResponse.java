package com.oneorthree.realtime.message.dto;

import com.oneorthree.realtime.message.repository.domain.ChatMessage;

import java.time.Instant;
import java.util.UUID;

/**
 * 메시지 한 건의 표현 — 실시간 브로드캐스트와 히스토리 조회가 <b>같은 모양</b>을 쓴다.
 *
 * <p>같게 둔 이유는 앱이 두 경로에서 온 메시지를 같은 목록에 섞어 그리기 때문이다. 모양이 다르면
 * 앱에 변환이 두 벌 생기고, 한쪽만 필드를 늘렸을 때 「소켓으로 온 건 보이는데 새로고침하면 사라지는」
 * 종류의 버그가 난다.
 *
 * @param messageId 서버가 부여한 id. 정렬·커서·읽음 커서가 전부 이 값을 쓴다
 * @param groupId 어느 섬의 말인지 — 앱이 방 여러 개를 한 소켓으로 받으므로 분류에 필요하다
 * @param senderId 보낸 사람. 표시 이름·프로필은 여기 싣지 않는다(개명이 반영 안 되고, 이 서비스는
 *                 프로필을 소유하지 않는다) — 앱이 이미 들고 있는 섬 멤버 목록에서 붙인다
 * @param content 본문
 * @param sentAt 서버 수신 시각
 * @param clientMessageId 보낸 쪽이 만든 멱등 키. <b>발신자 본인의 낙관적 렌더링을 실제 메시지로
 *                        갈아 끼우는 데 쓴다</b> — 이 값이 없으면 앱은 자기가 방금 그린 말풍선과
 *                        서버가 돌려준 말풍선을 같은 것으로 알아볼 수 없어 두 번 그린다
 */
public record ChatMessageResponse(
        UUID messageId,
        UUID groupId,
        UUID senderId,
        String content,
        Instant sentAt,
        UUID clientMessageId
) {

    public static ChatMessageResponse from(ChatMessage m) {
        return new ChatMessageResponse(m.getId(), m.getGroupId(), m.getSenderId(),
                m.getContent(), m.getSentAt(), m.getClientMessageId());
    }
}
