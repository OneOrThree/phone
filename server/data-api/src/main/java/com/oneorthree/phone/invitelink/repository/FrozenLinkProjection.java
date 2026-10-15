package com.oneorthree.phone.invitelink.repository;

import java.time.Instant;
import java.util.UUID;

/**
 * 링크 정지 스냅샷 한 행의 <b>원재료</b> — 링크·그룹·발급자·멤버십을 한 번에 읽은 것 (A22 ㊏).
 *
 * <p>클릭에서 역산하지 않는 이유가 이 조회의 존재 이유다 — 클릭이 <b>한 번도 없던</b> slug 도
 * 이미 공유돼 있고, 그 원장이 없으면 전환 직후 눌렸을 때 되돌릴 수 없는 실패가 된다.
 */
public interface FrozenLinkProjection {

    UUID getLinkId();

    String getSlug();

    UUID getGroupId();

    UUID getInviterId();

    Instant getLinkCreatedAt();

    String getGroupName();

    String getGroupStatus();

    Instant getGroupDeletedAt();

    String getInviterName();

    Long getMembershipEpoch();

    Long getTransitionSeq();

    Long getSnapshotVersion();

    Boolean getInviterLeft();

    Instant getMembershipUpdatedAt();
}
