package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 잡지 홍보 신청·섬 소식 Data 응답 (GROMO-2267) — Data {@code IslandPromotionViews} 와 같은 필드이고, 공개 응답과
 * 모양이 같아 그대로 내보낸다. 필수 필드가 빠지거나 null 이면 계약 불일치(502)다.
 */
public final class IslandPromotions {

    private IslandPromotions() {
    }

    /** 신청 결과 — {@code feeFish} 는 이번에 낸 홍보비(고정 60), {@code newsId} 는 주민 전원에게 생긴 소식이다. */
    @Schema(name = "IslandPromotion")
    public record Created(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int feeFish,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int balanceAfter,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID newsId) {
    }

    /** 최신순 소식 목록. */
    @Schema(name = "IslandNewsPage")
    public record NewsPage(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Item> items) {
    }

    /** 소식 한 건 — {@code kind} 는 지금 {@code PROMOTION} 하나이고 모르는 종류도 그대로 내려온다. */
    @Schema(name = "IslandNewsItem")
    public record Item(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String kind,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String body,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant createdAt) {
    }
}
