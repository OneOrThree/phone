package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;

/**
 * 섬 퀘스트 5계약의 상류 응답 (GROMO-1773, island-quests LLD §1·§2). 공개 {@code data} 와 같은 필드라 그대로
 * 내보낸다. 시각 축은 UTC 다(2026-09-19 결정 Q-6) — {@code timezone} 은 {@code "UTC"} 이다.
 *
 * <p>nullable 은 타입별로 명시된 것만이다: screen 의 {@code windowStart}/{@code windowEnd}, 판정 대상이 아닌
 * 주민의 {@code myRate}, 수령 가능·정산 완료 때의 {@code claimBlockedReason}, 주민의 {@code name}·{@code rate}.
 * 키는 항상 싣는다. 주민의 {@code catColor} 는 제공자가 main 에 없어 싣지 않는다(GROMO-1765 와 같은 결정).
 */
public final class IslandQuestViews {

    private IslandQuestViews() {
    }

    public record Current(@JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Item> items) {
    }

    /** 회차 헤더 — current 목록의 항목. */
    public record Item(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String occurrenceId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String title,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String type,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String windowStart,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String windowEnd,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String timezone,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String date,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int targetMinutes,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Integer myRate,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Reward reward,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String settlementStatus,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean claimable,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String claimBlockedReason,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean claimed,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long version) {
    }

    /** 섬 통장 적립량 — 통화는 섬 물고기 {@code village_points} 다. */
    public record Reward(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String currency,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long amount) {
    }

    /** 회차 진행 — 헤더 필드가 평평하게 펼쳐지고 판정 대상 주민 목록이 붙는다. */
    public record Progress(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String occurrenceId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String title,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String type,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String windowStart,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String windowEnd,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String timezone,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String date,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int targetMinutes,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Integer myRate,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Reward reward,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String settlementStatus,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean claimable,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String claimBlockedReason,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean claimed,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long version,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Member> members,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String nextCursor) {
    }

    /** 판정 대상 주민 — measurementStatus 는 authorized/pending/unavailable. */
    public record Member(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String userId,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String name,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) Integer rate,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String measurementStatus) {
    }

    public record Created(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String title) {
    }

    public record Updated(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String title,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int targetMinutes) {
    }

    /** 정산 결과 — {@code villagePointsAdded} 는 섬 통장에 적립된 섬 물고기다(결정 Q-1, 개명 미결). */
    public record Claimed(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String claimId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String occurrenceId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long villagePointsAdded,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean claimed) {
    }
}
