package com.oneorthree.chat.fanout;

import com.oneorthree.chat.message.dto.ChatMessageResponse;

import java.util.UUID;

/**
 * Redis Pub/Sub 채널에 실려 다니는 한 건 — 「이 섬에 이 메시지가 생겼다」.
 *
 * <p>본문 전체를 싣는다(id 만 싣고 각 인스턴스가 DB 에서 다시 읽는 방식이 아니다). 그쪽이 메시지
 * 크기는 작지만, 인스턴스 수만큼 읽기 쿼리가 늘고 <b>발행이 커밋보다 빨리 도착하면 아직 없는 행을
 * 읽는</b> 경합이 생긴다. 채팅 본문은 최대 2000자라 그냥 싣는 편이 싸고 단순하다.
 *
 * @param originInstanceId 발행한 인스턴스의 id. 받는 쪽이 <b>자기가 보낸 것을 걸러내는</b> 데 쓴다 —
 *                         Redis Pub/Sub 는 발행자에게도 되돌려 주므로, 이 필드가 없으면 발행 인스턴스에
 *                         붙어 있는 구독자만 같은 메시지를 두 번 받는다
 * @param message 브로드캐스트할 내용. 소켓으로 나가는 모양과 히스토리 조회의 모양이 같다
 */
public record ChatFanoutEvent(
        UUID originInstanceId,
        ChatMessageResponse message
) {
}
