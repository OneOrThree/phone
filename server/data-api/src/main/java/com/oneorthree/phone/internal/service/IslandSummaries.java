package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.group.repository.IslandJoinRequestRepository.JoinRequestRef;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.IslandJoinRequestStatus;
import com.oneorthree.phone.internal.dto.IslandSummaryView;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * {@link IslandSummaryView} 조립 규칙 — 섬 요약을 만드는 경로(조회·검색·탐색·초대 해석)가
 * 전부 같은 필드 규칙을 써야 하므로 한곳에 둔다 (LLD §2 PublicIslandSummary).
 */
final class IslandSummaries {

    static final String VISIBILITY_PUBLIC = "public";
    static final String VISIBILITY_PRIVATE = "private";
    static final String STATUS_ACTIVE = "active";
    static final String STATUS_PENDING = "pending";
    static final String STATUS_NONE = "none";

    private IslandSummaries() {
    }

    static IslandSummaryView of(Group island, int memberCount, String membershipStatus,
                                UUID joinRequestId) {
        return new IslandSummaryView(island.getId(), island.getName(), introOf(island),
                visibilityOf(island), island.isApprovalRequired(), memberCount, island.getMaxMembers(),
                membershipStatus, null, null, joinRequestId);
    }

    /** 기존 nullable {@code description} 의 공개 projection — DB 값은 바꾸지 않는다(LLD §2). */
    static String introOf(Group island) {
        return island.getDescription() == null ? "" : island.getDescription();
    }

    static String visibilityOf(Group island) {
        return island.isPrivate() ? VISIBILITY_PRIVATE : VISIBILITY_PUBLIC;
    }

    /** 신청 참조 묶음에서 «섬별 최신 요청» 하나씩을 고른다 — 요약의 {@code joinRequestId} 용. */
    static Map<UUID, JoinRequestRef> latestByIsland(List<JoinRequestRef> refs) {
        Map<UUID, JoinRequestRef> latest = new HashMap<>();
        for (JoinRequestRef ref : refs) {
            latest.merge(ref.getIslandId(), ref,
                    (a, b) -> b.getCreatedAt().isAfter(a.getCreatedAt()) ? b : a);
        }
        return latest;
    }

    /** 그 섬에 대한 본인 최신 요청이 열려 있으면 {@code pending} 이다. */
    static String statusOf(boolean activeMember, JoinRequestRef latestRef) {
        if (activeMember) {
            return STATUS_ACTIVE;
        }
        return latestRef != null && latestRef.getStatus() == IslandJoinRequestStatus.PENDING
                ? STATUS_PENDING : STATUS_NONE;
    }
}
