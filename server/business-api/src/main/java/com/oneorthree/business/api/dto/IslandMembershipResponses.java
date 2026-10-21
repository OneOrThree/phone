package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.upstream.data.dto.CurrentIsland;
import com.oneorthree.business.upstream.data.dto.InvitationResolved;
import com.oneorthree.business.upstream.data.dto.IslandArrival;
import com.oneorthree.business.upstream.data.dto.IslandCreated;
import com.oneorthree.business.upstream.data.dto.IslandDetail;
import com.oneorthree.business.upstream.data.dto.IslandInvitationIssued;
import com.oneorthree.business.upstream.data.dto.IslandSummary;
import com.oneorthree.business.upstream.data.dto.JoinIslandResult;
import com.oneorthree.business.upstream.data.dto.JoinRequestCancel;
import com.oneorthree.business.upstream.data.dto.JoinRequestStatus;
import com.oneorthree.business.upstream.data.dto.Magazines;
import com.oneorthree.business.upstream.data.dto.MyJoinRequestsPage;
import com.oneorthree.business.upstream.data.dto.Telescope;
import com.oneorthree.business.upstream.data.dto.TelescopePin;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.List;
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
            String themeId,
            Boolean arrivedBefore,
            String greeting,
            Boolean greetingIsDefault) {
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
                    value.themeId(),
                    value.arrivedBefore(),
                    value.greeting(),
                    value.greetingIsDefault());
        }
    }

    /**
     * 섬 도착 결과 (GROMO-2260) — {@code POST /islands/{islandId}/arrivals}.
     *
     * @param arrivedBefore   주민이면 현 가입 이후 이미 와 본 적이 있었는가 — false 면 이번이 주민 첫 도착(「환영해요」,
     *                        GROMO-2302). 방문(비주민)이면 언제나 true
     * @param currentIslandId 도착 처리 뒤 현재 섬. 방문(비주민)이면 그대로이고 없으면 null
     */
    public record IslandArrivalView(
            @JsonProperty(required = true) UUID islandId,
            @JsonProperty(required = true) boolean arrivedBefore,
            @JsonProperty(required = true) String membershipStatus,
            @JsonInclude(JsonInclude.Include.ALWAYS) UUID currentIslandId) {
        public static IslandArrivalView from(IslandArrival value) {
            return new IslandArrivalView(value.islandId(), value.arrivedBefore(), value.membershipStatus(),
                    value.currentIslandId());
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
            @JsonProperty(required = true) long version,
            String greeting,
            Boolean greetingIsDefault) {
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
                    value.version(),
                    value.greeting(),
                    value.greetingIsDefault());
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

    /**
     * 초대 해석 결과.
     *
     * @param arrival 초대로 그 섬에 도착한 결과 (GROMO-2264). 도착을 요청({@code arrive=true})하지 않은 미리보기와 구 Data
     *     서버와 붙은 동안은 null 이다
     */
    public record InvitationResolvedView(
            @JsonProperty(required = true) IslandSummaryView island,
            @JsonProperty(required = true) String invitationToken,
            InvitationArrivalView arrival) {
        public static InvitationResolvedView from(InvitationResolved value) {
            if (value == null) {
                return null;
            }
            return new InvitationResolvedView(
                    IslandSummaryView.from(value.island()),
                    value.invitationToken(),
                    InvitationArrivalView.from(value.arrival()));
        }
    }

    /**
     * 초대 도착 결과 (GROMO-2264, 섬 외부 계약 §4) — 해석은 그 섬에 항해 없이 도착하고, 누구나 가입 섬이면 가입까지 한다.
     * 승인제 섬은 도착만이다 — 승인 전까지 방문자이고 가입 신청은 방문자가 직접 한다.
     *
     * @param membershipStatus {@code active|pending|none} — 해석 뒤 본인 기준. {@code pending} 은 이미 열려 있던 신청이다
     * @param reason 바로 가입하지 않은 사유 {@code ISLAND_LIMIT}(소속 섬 3개 — 가입·신청 불가)·{@code KICKED}(강퇴된 섬 —
     *     도착만 하고, 가입 신청은 승인 대기로 할 수 있다. GROMO-2315). 없으면 키가 없다
     */
    public record InvitationArrivalView(
            @JsonProperty(required = true) UUID islandId,
            @JsonProperty(required = true) boolean arrived,
            @JsonProperty(required = true) String membershipStatus,
            @JsonInclude(JsonInclude.Include.NON_NULL) String reason) {
        public static InvitationArrivalView from(InvitationResolved.Arrival value) {
            if (value == null) {
                return null;
            }
            return new InvitationArrivalView(value.islandId(), value.arrived(), value.membershipStatus(),
                    value.reason());
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

    /**
     * 망원경 목록 (GROMO-2265) — {@code GET /me/telescope}. 같은 1시간 안에 다시 부르면 같은 목록이다.
     *
     * @param bucketStart        이 목록의 1시간 버킷 시작
     * @param nextRefreshMinutes 다음 목록까지 남은 분(1~60)
     * @param items              {@code joined} → {@code nearby} → {@code pinned} → {@code random} 순
     */
    public record TelescopeView(
            @JsonProperty(required = true) Instant bucketStart,
            @JsonProperty(required = true) int nextRefreshMinutes,
            @JsonProperty(required = true) List<TelescopeItemView> items) {
        public static TelescopeView from(Telescope value) {
            return new TelescopeView(value.bucketStart(), value.nextRefreshMinutes(),
                    value.items().stream().map(TelescopeItemView::from).toList());
        }
    }

    /**
     * 망원경 한 칸.
     *
     * @param slot                      {@code joined|nearby|pinned|random}
     * @param sailingMinutes            항해 분 — {@code nearby} 는 15, 나머지는 30·60·90 중 하나
     * @param averageFocusMinutesPerDay 주민 1인당 하루 평균 집중(분). 아직 집계 전이면 null
     * @param full                      정원이 찼다 — 구경만 할 수 있다
     * @param pinnedFrom                {@code magazine|observatory} — 직접 넣은 섬({@code slot=pinned})에만 있다. 나머지 칸에서는
     *                                  키가 없다(GROMO-2268)
     * @param pinnedAt                  핀을 넣은 시각 — {@code pinnedFrom} 과 함께 있거나 함께 없다
     * @param magazineCell              잡지에서 넣은 섬의 그 잡지 홍보 칸(잡지 한 호의 칸과 같은 모양). 없으면 null 이고 키는
     *                                  항상 있다(GROMO-2289)
     * @param buildingCount             완공 건물 수 — 단계 그림은 앱 {@code islandStage(memberCount, buildingCount)} 가 정한다
     *                                  (GROMO-2306). 이 필드를 모르는 옛 Data 면 키가 빠진다(null 을 보내지 않는다 — 앱은 0 으로 읽는다)
     */
    public record TelescopeItemView(
            @JsonProperty(required = true) UUID islandId,
            @JsonProperty(required = true) String name,
            @JsonProperty(required = true) String intro,
            @JsonProperty(required = true) int memberCount,
            @JsonProperty(required = true) int maxMembers,
            @JsonProperty(required = true) boolean approvalRequired,
            @JsonProperty(required = true) String membershipStatus,
            @JsonProperty(required = true) String slot,
            @JsonProperty(required = true) int sailingMinutes,
            Integer averageFocusMinutesPerDay,
            @JsonProperty(required = true) boolean full,
            @JsonProperty(required = true) boolean arrivedBefore,
            @JsonInclude(JsonInclude.Include.NON_NULL) String pinnedFrom,
            @JsonInclude(JsonInclude.Include.NON_NULL) Instant pinnedAt,
            @JsonInclude(JsonInclude.Include.ALWAYS) Magazines.Cell magazineCell,
            @JsonInclude(JsonInclude.Include.NON_NULL)
            @Schema(description = "완공 건물 수. 키가 없으면 0 으로 읽는다(옛 Data 호환 — 롤링 배포 중에만 빠지고 null 은 보내지 않는다). "
                    + "단계 그림은 앱 islandStage(memberCount, buildingCount)",
                    requiredMode = Schema.RequiredMode.NOT_REQUIRED)
            Integer buildingCount) {
        public static TelescopeItemView from(Telescope.Item value) {
            if (value == null) {
                return null;
            }
            return new TelescopeItemView(
                    value.islandId(),
                    value.name(),
                    value.intro(),
                    value.memberCount(),
                    value.maxMembers(),
                    value.approvalRequired(),
                    value.membershipStatus(),
                    value.slot(),
                    value.sailingMinutes(),
                    value.averageFocusMinutesPerDay(),
                    value.full(),
                    value.arrivedBefore(),
                    value.pinnedFrom(),
                    value.pinnedAt(),
                    value.magazineCell(),
                    value.buildingCount());
        }
    }

    /**
     * 망원경에 섬을 넣은 결과 (GROMO-2268) — {@code POST /me/telescope/pins}. 새 핀이면 201, 이미 있던 핀이면 200 으로
     * 같은 항목을 돌려준다.
     *
     * @param item    넣은 섬 — 목록에서 보이는 그대로({@code slot=pinned}, {@code pinnedFrom}·{@code pinnedAt} 포함)
     * @param evicted 넣기로 보이는 핀이 4개를 넘어 정리된 핀(지운 것 중 가장 최근 — 넣는 섬은 밀려나지 않는다). 이미 있던
     *     핀을 다시 넣어도 넘침이 있으면 실린다. 정리된 핀이 없으면 null 이고 키는 항상 있다
     */
    public record TelescopePinView(
            @JsonProperty(required = true) TelescopeItemView item,
            @JsonInclude(JsonInclude.Include.ALWAYS) EvictedPinView evicted) {
        public static TelescopePinView from(TelescopePin value) {
            return new TelescopePinView(TelescopeItemView.from(value.item()), EvictedPinView.from(value.evicted()));
        }
    }

    /** 밀려난 핀의 섬 — 앱이 「{name}섬이 망원경에서 빠져요」를 띄운다. */
    public record EvictedPinView(
            @JsonProperty(required = true) UUID islandId,
            @JsonProperty(required = true) String name) {
        public static EvictedPinView from(TelescopePin.Evicted value) {
            return value == null ? null : new EvictedPinView(value.islandId(), value.name());
        }
    }
}
