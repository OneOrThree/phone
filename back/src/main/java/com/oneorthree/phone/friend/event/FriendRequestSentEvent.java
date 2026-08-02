package com.oneorthree.phone.friend.event;

import java.util.UUID;

/**
 * 친구 요청이 생성됐다 (GROMO-1090). 신규 요청과 거절 후 재요청(reopen) 두 경로 모두에서 1회 발행한다.
 *
 * <p>수신자에게 푸시를 보내기 위한 트리거이며, <b>커밋 이후</b>에만 소비돼야 한다
 * (요청이 롤백되는데 알림만 나가면 안 된다) — 소비 측 계약은
 * {@code FriendNotificationEventListener} 의 {@code @TransactionalEventListener(AFTER_COMMIT)} 이다.
 *
 * <p>엔티티가 아니라 id 만 싣는다. 소비는 새 트랜잭션에서 일어나므로 발행 트랜잭션의 영속성 컨텍스트에
 * 매달린 엔티티를 넘기면 그쪽에서 detach 된 객체를 다루게 된다.
 *
 * @param receiverUserId 요청을 받은 유저(= 푸시 수신자)
 * @param senderUserId 요청을 보낸 유저(= 푸시 문구에 쓸 상대)
 */
public record FriendRequestSentEvent(UUID receiverUserId, UUID senderUserId) {
}
