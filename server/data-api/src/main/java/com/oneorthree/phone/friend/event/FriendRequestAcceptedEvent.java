package com.oneorthree.phone.friend.event;

import java.util.UUID;

/**
 * 받은 친구 요청을 수락했다 (GROMO-1090). 요청을 <b>보냈던</b> 쪽에게 푸시를 보내기 위한 트리거다.
 *
 * <p>커밋 이후 소비 계약·id 만 싣는 이유는 {@link FriendRequestSentEvent} 와 같다.
 *
 * @param requesterUserId 요청을 보냈던 유저(= 푸시 수신자)
 * @param accepterUserId 요청을 수락한 유저(= 푸시 문구에 쓸 상대)
 */
public record FriendRequestAcceptedEvent(UUID requesterUserId, UUID accepterUserId) {
}
