package com.oneorthree.phone.invitelink.repository;

import java.time.Instant;
import java.util.UUID;

/**
 * 정지 스냅샷 한 행의 <b>원재료</b> — 클릭·링크·그룹·발급자·멤버십을 한 번에 읽은 것 (서비스 §7.2).
 *
 * <p>도메인을 하나씩 조회해 조립하지 않는 이유는 <b>스냅샷의 일관성</b>이다. 클릭 N건을 훑으며
 * 그룹·멤버십을 따로 읽으면 그 사이 커밋된 탈퇴·종료가 행마다 다르게 섞여, 같은 회차의 원본이
 * 서로 다른 시점을 담는다. 한 쿼리로 읽으면 적어도 그 행의 다섯 사실이 같은 스냅샷이다.
 *
 * <p>{@code inviterLeft}·{@code membershipEpoch} 가 {@code null} 일 수 있다 — 멤버십 행 자체가 없는
 * 경우다(구 데이터). 그때는 「폐기됨」으로 확정한다(ⓙ: 그대로 복사하면 죽은 slug 가 되살아난다).
 */
public interface FrozenClickProjection {

    UUID getClickId();

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

    String getIpHash();

    String getOs();

    String getUserAgent();

    Instant getClickedAt();

    boolean getMatched();

    Instant getMatchedAt();

    String getMatchedDeviceId();

    String getAppInstanceId();

    UUID getClaimedUserId();

    Instant getClaimedAt();
}
