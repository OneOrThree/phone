package com.oneorthree.phone.group.event;

import java.util.UUID;

/**
 * 그룹 챌린지가 <b>생성됐다</b>는 도메인 이벤트 (GROMO-1089).
 *
 * <p>{@code GroupChallengeService.createChallenge} 가 쓰기 트랜잭션 안에서 발행하고,
 * 알림 도메인이 {@code @TransactionalEventListener(AFTER_COMMIT)} 로 받아 그룹원 푸시를 보낸다.
 * <b>커밋 이후</b>에만 소비돼야 하므로(생성이 롤백됐는데 알림만 나가는 일을 막는다) 트랜잭션
 * 안에서 발행하는 것이 전제다 — 트랜잭션 밖에서 발행하면 AFTER_COMMIT 리스너는 조용히 스킵된다.
 *
 * <p>엔티티가 아니라 <b>식별자만</b> 싣는다. 리스너는 커밋 이후 별도 트랜잭션에서 돌기 때문에
 * 발행 시점의 영속성 컨텍스트가 없고, 엔티티를 그대로 실으면 지연 로딩이 터진다.
 *
 * @param challengeId    생성된 챌린지 id — 발송 dedup 키({@code target_user_id})로도 쓰인다
 * @param groupId        챌린지가 속한 그룹 id — 딥링크 {@code gromo://group?g=} 대상
 * @param creatorUserId  챌린지를 만든 유저(그룹 OWNER) — 본인은 발송 대상에서 제외한다
 */
public record GroupChallengeCreatedEvent(UUID challengeId, UUID groupId, UUID creatorUserId) {
}
