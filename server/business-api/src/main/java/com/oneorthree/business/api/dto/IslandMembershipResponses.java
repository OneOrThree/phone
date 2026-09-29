package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.upstream.data.dto.CurrentIsland;
import com.oneorthree.business.upstream.data.dto.InvitationResolved;
import com.oneorthree.business.upstream.data.dto.IslandCreated;
import com.oneorthree.business.upstream.data.dto.IslandDetail;
import com.oneorthree.business.upstream.data.dto.IslandInvitationIssued;
import com.oneorthree.business.upstream.data.dto.IslandSummary;
import com.oneorthree.business.upstream.data.dto.JoinIslandResult;
import com.oneorthree.business.upstream.data.dto.JoinRequestCancel;
import com.oneorthree.business.upstream.data.dto.JoinRequestStatus;
import com.oneorthree.business.upstream.data.dto.MyJoinRequestsPage;

import java.time.Instant;
import java.util.UUID;

/** 공개 필드만 명시적으로 조립한다. 내부 전송 DTO의 확장이 응답에 섞이지 않도록 분리한다. */
public final class IslandMembershipResponses {

    private IslandMembershipResponses() {
    }

    public record IslandSummaryView(
            @JsonProperty(required = true) UUID id,
            @JsonProperty(required = true) String name,
            @JsonProperty(required = true) String intro,
            @JsonProperty(required = true) String visibility,
            @JsonProperty(required = true) boolean approvalRequired,
            @JsonProperty(required = true) int memberCount,
            @JsonProperty(required = true) int maxMembers,
            @JsonProperty(required = true) String membershipStatus,
            @JsonProperty(required = true) UUID joinRequestId,
            String growthStage,
            String themeId) {
        public static IslandSummaryView from(IslandSummary value) {
            if (value == null) {
                return null;
            }
            return new IslandSummaryView(
                    value.id(),
                    value.name(),
                    value.intro(),
                    value.visibility(),
                    value.approvalRequired(),
                    value.memberCount(),
                    value.maxMembers(),
                    value.membershipStatus(),
                    value.joinRequestId(),
                    value.growthStage(),
                    value.themeId());
        }
    }

    public record IslandDetailView(
            @JsonProperty(required = true) UUID id,
            @JsonProperty(required = true) String name,
            @JsonProperty(required = true) String intro,
            @JsonProperty(required = true) String visibility,
            @JsonProperty(required = true) boolean approvalRequired,
            @JsonProperty(required = true) int memberCount,
            @JsonProperty(required = true) int maxMembers,
            @JsonProperty(required = true) String membershipStatus,
            String growthStage,
            String themeId,
            @JsonProperty(required = true) String role,
            @JsonProperty(required = true) long version) {
        public static IslandDetailView from(IslandDetail value) {
            if (value == null) {
                return null;
            }
            return new IslandDetailView(
                    value.id(),
                    value.name(),
                    value.intro(),
                    value.visibility(),
                    value.approvalRequired(),
                    value.memberCount(),
                    value.maxMembers(),
                    value.membershipStatus(),
                    value.growthStage(),
                    value.themeId(),
                    value.role(),
                    value.version());
        }
    }

    public record IslandCreatedView(
            @JsonProperty(required = true) UUID id,
            @JsonProperty(required = true) String membershipStatus,
            @JsonProperty(required = true) String role,
            @JsonProperty(required = true) UUID currentIslandId) {
        public static IslandCreatedView from(IslandCreated value) {
            if (value == null) {
                return null;
            }
            return new IslandCreatedView(
                    value.id(),
                    value.membershipStatus(),
                    value.role(),
                    value.currentIslandId());
        }
    }

    public record CurrentIslandView(
            @JsonProperty(required = true) UUID currentIslandId) {
        public static CurrentIslandView from(CurrentIsland value) {
            if (value == null) {
                return null;
            }
            return new CurrentIslandView(
                    value.currentIslandId());
        }
    }

    public record InvitationResolvedView(
            @JsonProperty(required = true) IslandSummaryView island,
            @JsonProperty(required = true) String invitationToken) {
        public static InvitationResolvedView from(InvitationResolved value) {
            if (value == null) {
                return null;
            }
            return new InvitationResolvedView(
                    IslandSummaryView.from(value.island()),
                    value.invitationToken());
        }
    }

    public record IslandInvitationView(
            @JsonProperty(required = true) String code,
            @JsonProperty(required = true) String url,
            @JsonProperty(required = true) Instant expiresAt) {
        public static IslandInvitationView from(IslandInvitationIssued value) {
            if (value == null) {
                return null;
            }
            return new IslandInvitationView(
                    value.code(),
                    value.url(),
                    value.expiresAt());
        }
    }

    public record IslandJoinResultView(
            @JsonProperty(required = true) String status,
            @JsonProperty(required = true) UUID requestId,
            @JsonProperty(required = true) UUID islandId,
            @JsonProperty(required = true) UUID currentIslandId,
            @JsonProperty(required = true) long version) {
        public static IslandJoinResultView from(JoinIslandResult value) {
            if (value == null) {
                return null;
            }
            return new IslandJoinResultView(
                    value.status(),
                    value.requestId(),
                    value.islandId(),
                    value.currentIslandId(),
                    value.version());
        }
    }

    public record JoinRequestStatusView(
            @JsonProperty(required = true) UUID id,
            @JsonProperty(required = true) UUID islandId,
            @JsonProperty(required = true) String status,
            @JsonProperty(required = true) long version) {
        public static JoinRequestStatusView from(JoinRequestStatus value) {
            if (value == null) {
                return null;
            }
            return new JoinRequestStatusView(
                    value.id(),
                    value.islandId(),
                    value.status(),
                    value.version());
        }
    }

    public record JoinRequestCancelView(
            @JsonProperty(required = true) UUID id,
            @JsonProperty(required = true) String status) {
        public static JoinRequestCancelView from(JoinRequestCancel value) {
            if (value == null) {
                return null;
            }
            return new JoinRequestCancelView(
                    value.id(),
                    value.status());
        }
    }

    public record MyJoinRequestView(
            @JsonProperty(required = true) UUID id,
            @JsonProperty(required = true) UUID islandId,
            String islandName,
            @JsonProperty(required = true) int memberCount,
            @JsonProperty(required = true) int maxMembers,
            @JsonProperty(required = true) String status,
            @JsonProperty(required = true) long version,
            @JsonProperty(required = true) Instant createdAt) {
        public static MyJoinRequestView from(MyJoinRequestsPage.Item value) {
            if (value == null) {
                return null;
            }
            return new MyJoinRequestView(
                    value.id(),
                    value.islandId(),
                    value.islandName(),
                    value.memberCount(),
                    value.maxMembers(),
                    value.status(),
                    value.version(),
                    value.createdAt());
        }
    }
}
