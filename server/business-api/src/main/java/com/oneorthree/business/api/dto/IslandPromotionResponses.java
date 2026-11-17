package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.upstream.data.dto.IslandPromotions;
import io.swagger.v3.oas.annotations.media.Schema;
import tools.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * 주민이 읽는 다음 호 홍보 칸 공개 응답 (GROMO-2893) — 상류 레코드({@link IslandPromotions.NextPage})를 그대로 내보내지 않고
 * 한 번 감싼다(PublicResponseTypeAuditTest). 수정 가능 여부·홍보비·잔액은 싣지 않는다.
 */
public final class IslandPromotionResponses {

    private IslandPromotionResponses() {
    }

    /** {@code next} 는 없으면 null 이고 키는 늘 실린다. */
    @Schema(name = "IslandPromotionNextPage")
    public record NextPage(@JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) ResidentNext next) {

        public static NextPage from(IslandPromotions.NextPage page) {
            IslandPromotions.ResidentNext n = page.next();
            return new NextPage(n == null ? null
                    : new ResidentNext(n.promotionId(), n.issueDate(), n.body(), n.layout(), n.appliedAt()));
        }
    }

    @Schema(name = "IslandPromotionResidentNext")
    public record ResidentNext(
            @JsonProperty(required = true) UUID promotionId,
            @JsonProperty(required = true) String issueDate,
            @JsonProperty(required = true) String body,
            @JsonProperty(required = true) @Schema(implementation = Map.class) ObjectNode layout,
            @JsonProperty(required = true) Instant appliedAt) {
    }
}
