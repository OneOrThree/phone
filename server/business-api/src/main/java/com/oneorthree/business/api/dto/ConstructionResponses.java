package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.upstream.data.dto.ConstructionOptions;
import com.oneorthree.business.upstream.data.dto.ConstructionResult;
import com.oneorthree.business.upstream.data.dto.ConstructionTarget;

import java.util.List;

/** 공개 필드만 명시적으로 조립한다. 내부 전송 DTO의 확장이 응답에 섞이지 않도록 분리한다. */
public final class ConstructionResponses {

    private ConstructionResponses() {
    }

    public record ConstructionOptionsView(
            @JsonProperty(required = true) long islandVersion,
            @JsonProperty(required = true) long costPolicyVersion,
            @JsonProperty(required = true) String selectedBuildingId,
            @JsonProperty(required = true) long villagePoints,
            @JsonProperty(required = true) long walletVersion,
            @JsonProperty(required = true) List<ConstructionOptionItem> items) {
        public static ConstructionOptionsView from(ConstructionOptions value) {
            if (value == null) {
                return null;
            }
            return new ConstructionOptionsView(
                    value.islandVersion(),
                    value.costPolicyVersion(),
                    value.selectedBuildingId(),
                    value.villagePoints(),
                    value.walletVersion(),
                    value.items() == null ? null : value.items().stream().map(ConstructionOptionItem::from).toList());
        }
    }

    public record ConstructionOptionItem(
            @JsonProperty(required = true) String id,
            @JsonProperty(required = true) String name,
            @JsonProperty(required = true) long cost,
            @JsonProperty(required = true) String currency,
            @JsonProperty(required = true) boolean selectable,
            @JsonProperty(required = true) boolean buildable,
            @JsonProperty(required = true) String blockedReason) {
        public static ConstructionOptionItem from(ConstructionOptions.Item value) {
            if (value == null) {
                return null;
            }
            return new ConstructionOptionItem(
                    value.id(),
                    value.name(),
                    value.cost(),
                    value.currency(),
                    value.selectable(),
                    value.buildable(),
                    value.blockedReason());
        }
    }

    public record ConstructionTargetView(
            @JsonProperty(required = true) String buildingId,
            @JsonProperty(required = true) boolean selected,
            @JsonProperty(required = true) long spent,
            @JsonProperty(required = true) long version) {
        public static ConstructionTargetView from(ConstructionTarget value) {
            if (value == null) {
                return null;
            }
            return new ConstructionTargetView(
                    value.buildingId(),
                    value.selected(),
                    value.spent(),
                    value.version());
        }
    }

    public record ConstructionResultView(
            @JsonProperty(required = true) String buildingId,
            @JsonProperty(required = true) String status,
            @JsonProperty(required = true) ConstructionSpent spent,
            @JsonProperty(required = true) long version,
            @JsonProperty(required = true) long villagePoints,
            @JsonProperty(required = true) long walletVersion,
            @JsonProperty(required = true) String startedAt,
            @JsonProperty(required = true) String completesAt) {
        public static ConstructionResultView from(ConstructionResult value) {
            if (value == null) {
                return null;
            }
            return new ConstructionResultView(
                    value.buildingId(),
                    value.status(),
                    ConstructionSpent.from(value.spent()),
                    value.version(),
                    value.villagePoints(),
                    value.walletVersion(),
                    value.startedAt(),
                    value.completesAt());
        }
    }

    public record ConstructionSpent(
            @JsonProperty(required = true) String currency,
            @JsonProperty(required = true) long amount) {
        public static ConstructionSpent from(ConstructionResult.Spent value) {
            if (value == null) {
                return null;
            }
            return new ConstructionSpent(
                    value.currency(),
                    value.amount());
        }
    }
}
