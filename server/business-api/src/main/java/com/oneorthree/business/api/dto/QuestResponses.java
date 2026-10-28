package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.upstream.data.dto.IslandQuestViews;

import java.util.List;

/** 공개 필드만 명시적으로 조립한다. 내부 전송 DTO의 확장이 응답에 섞이지 않도록 분리한다. */
public final class QuestResponses {

    private QuestResponses() {
    }

    public record CurrentQuestsView(
            @JsonProperty(required = true) List<IslandQuestItem> items) {
        public static CurrentQuestsView from(IslandQuestViews.Current value) {
            if (value == null) {
                return null;
            }
            return new CurrentQuestsView(
                    value.items() == null ? null : value.items().stream().map(IslandQuestItem::from).toList());
        }
    }

    public record IslandQuestItem(
            @JsonProperty(required = true) String id,
            @JsonProperty(required = true) String occurrenceId,
            @JsonProperty(required = true) String title,
            @JsonProperty(required = true) String type,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String windowStart,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String windowEnd,
            @JsonProperty(required = true) String timezone,
            @JsonProperty(required = true) String date,
            @JsonProperty(required = true) int targetMinutes,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Integer myRate,
            @JsonProperty(required = true) IslandQuestReward reward,
            @JsonProperty(required = true) String settlementStatus,
            @JsonProperty(required = true) boolean claimable,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String claimBlockedReason,
            @JsonProperty(required = true) boolean claimed,
            @JsonProperty(required = true) long bonusAmount,
            @JsonProperty(required = true) boolean bonusGranted,
            @JsonProperty(required = true) long version) {
        public static IslandQuestItem from(IslandQuestViews.Item value) {
            if (value == null) {
                return null;
            }
            return new IslandQuestItem(
                    value.id(),
                    value.occurrenceId(),
                    value.title(),
                    value.type(),
                    value.windowStart(),
                    value.windowEnd(),
                    value.timezone(),
                    value.date(),
                    value.targetMinutes(),
                    value.myRate(),
                    IslandQuestReward.from(value.reward()),
                    value.settlementStatus(),
                    value.claimable(),
                    value.claimBlockedReason(),
                    value.claimed(),
                    value.bonusAmount(),
                    value.bonusGranted(),
                    value.version());
        }
    }

    public record IslandQuestReward(
            @JsonProperty(required = true) String currency,
            @JsonProperty(required = true) long amount) {
        public static IslandQuestReward from(IslandQuestViews.Reward value) {
            if (value == null) {
                return null;
            }
            return new IslandQuestReward(
                    value.currency(),
                    value.amount());
        }
    }

    public record IslandQuestProgressView(
            @JsonProperty(required = true) String id,
            @JsonProperty(required = true) String occurrenceId,
            @JsonProperty(required = true) String title,
            @JsonProperty(required = true) String type,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String windowStart,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String windowEnd,
            @JsonProperty(required = true) String timezone,
            @JsonProperty(required = true) String date,
            @JsonProperty(required = true) int targetMinutes,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Integer myRate,
            @JsonProperty(required = true) IslandQuestReward reward,
            @JsonProperty(required = true) String settlementStatus,
            @JsonProperty(required = true) boolean claimable,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String claimBlockedReason,
            @JsonProperty(required = true) boolean claimed,
            @JsonProperty(required = true) long bonusAmount,
            @JsonProperty(required = true) boolean bonusGranted,
            @JsonProperty(required = true) long version,
            @JsonProperty(required = true) List<IslandQuestMember> members,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String nextCursor) {
        public static IslandQuestProgressView from(IslandQuestViews.Progress value) {
            if (value == null) {
                return null;
            }
            return new IslandQuestProgressView(
                    value.id(),
                    value.occurrenceId(),
                    value.title(),
                    value.type(),
                    value.windowStart(),
                    value.windowEnd(),
                    value.timezone(),
                    value.date(),
                    value.targetMinutes(),
                    value.myRate(),
                    IslandQuestReward.from(value.reward()),
                    value.settlementStatus(),
                    value.claimable(),
                    value.claimBlockedReason(),
                    value.claimed(),
                    value.bonusAmount(),
                    value.bonusGranted(),
                    value.version(),
                    value.members() == null ? null : value.members().stream().map(IslandQuestMember::from).toList(),
                    value.nextCursor());
        }
    }

    public record IslandQuestMember(
            @JsonProperty(required = true) String userId,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String name,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Integer rate,
            @JsonProperty(required = true) String measurementStatus,
            @JsonProperty(required = true) boolean achieved,
            @JsonProperty(required = true) boolean claimed) {
        public static IslandQuestMember from(IslandQuestViews.Member value) {
            if (value == null) {
                return null;
            }
            return new IslandQuestMember(
                    value.userId(),
                    value.name(),
                    value.rate(),
                    value.measurementStatus(),
                    value.achieved(),
                    value.claimed());
        }
    }

    public record IslandQuestCreated(
            @JsonProperty(required = true) String id,
            @JsonProperty(required = true) String title) {
        public static IslandQuestCreated from(IslandQuestViews.Created value) {
            if (value == null) {
                return null;
            }
            return new IslandQuestCreated(
                    value.id(),
                    value.title());
        }
    }

    public record IslandQuestUpdated(
            @JsonProperty(required = true) String id,
            @JsonProperty(required = true) String title,
            @JsonProperty(required = true) int targetMinutes) {
        public static IslandQuestUpdated from(IslandQuestViews.Updated value) {
            if (value == null) {
                return null;
            }
            return new IslandQuestUpdated(
                    value.id(),
                    value.title(),
                    value.targetMinutes());
        }
    }

    public record IslandQuestClaimed(
            @JsonProperty(required = true) String claimId,
            @JsonProperty(required = true) String occurrenceId,
            @JsonProperty(required = true) long villagePointsAdded,
            @JsonProperty(required = true) long bonusAdded,
            @JsonProperty(required = true) boolean claimed) {
        public static IslandQuestClaimed from(IslandQuestViews.Claimed value) {
            if (value == null) {
                return null;
            }
            return new IslandQuestClaimed(
                    value.claimId(),
                    value.occurrenceId(),
                    value.villagePointsAdded(),
                    value.bonusAdded(),
                    value.claimed());
        }
    }
}
