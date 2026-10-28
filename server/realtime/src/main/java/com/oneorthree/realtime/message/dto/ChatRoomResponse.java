package com.oneorthree.realtime.message.dto;

import java.util.UUID;

/**
 * 방 목록의 한 줄 — 「어느 섬에 몇 개가 쌓였는가」.
 *
 * <p>이 화면이 채팅의 알림을 대신한다. 푸시를 보내지 않기로 했으니 안 읽음은 여기서만 드러나고,
 * 그래서 집중이 끝난 뒤 사용자가 가장 먼저 보는 화면이 된다.
 *
 * @param groupId 섬 id. 섬 이름은 여기 없다 — 앱이 이미 그룹 목록을 들고 있고, 이름의 정본은 Data API 다
 * @param lastMessage 마지막 말 미리보기. 아직 아무 말도 없는 방이면 null
 * @param unreadCount 안 읽은 개수(자기가 보낸 말은 빼고 센다). 한 번도 안 들어간 방은 전량이 안 읽음이다
 */
public record ChatRoomResponse(
        UUID groupId,
        ChatMessageResponse lastMessage,
        long unreadCount
) {
}
