package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 망원경 목록 (GROMO-2265, 섬 외부 계약 §5) — Data {@code TelescopeView}·{@code TelescopeItemView} 와 같은 필드다.
 *
 * <p>{@code averageFocusMinutesPerDay} 는 키는 필수지만 값은 null 일 수 있다 — 아직 집계 전이거나 주민이 없다.
 * {@code pinnedFrom}·{@code pinnedAt}(GROMO-2268)은 직접 넣은 섬({@code slot=pinned})에만 값이 있고 나머지 칸에서는
 * 키가 없거나 null 이다 — 그래서 필수가 아니다.
 */
public record Telescope(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant bucketStart,
        @JsonProperty(required = true) int nextRefreshMinutes,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Item> items) {

    /** 한 칸 — {@code slot} 은 {@code joined|nearby|pinned|random}. */
    public record Item(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID islandId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String name,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String intro,
            @JsonProperty(required = true) int memberCount,
            @JsonProperty(required = true) int maxMembers,
            @JsonProperty(required = true) boolean approvalRequired,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String membershipStatus,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String slot,
            @JsonProperty(required = true) int sailingMinutes,
            @JsonProperty(required = true) Integer averageFocusMinutesPerDay,
            @JsonProperty(required = true) boolean full,
            @JsonProperty(required = true) boolean arrivedBefore,
            String pinnedFrom,
            Instant pinnedAt) {
    }
}
