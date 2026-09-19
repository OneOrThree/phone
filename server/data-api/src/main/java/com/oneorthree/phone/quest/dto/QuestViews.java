package com.oneorthree.phone.quest.dto;

import com.fasterxml.jackson.annotation.JsonUnwrapped;

import java.util.List;
import java.util.UUID;

/**
 * 섬 퀘스트 5계약의 Data 응답 모양 (GROMO-1773, LLD §1·§2). 공개 {@code data} 와 같은 필드다.
 *
 * <p>시각 축은 UTC 다(결정 Q-6) — {@code timezone} 은 언제나 {@code "UTC"}, {@code date} 는 UTC 날짜,
 * {@code windowStart}·{@code windowEnd} 는 UTC {@code HH:mm} 이고 screen 이면 null 이다.
 */
public final class QuestViews {

    public static final String TIMEZONE = "UTC";
    public static final String CURRENCY = "village_points";
    public static final String STATUS_IN_PROGRESS = "in_progress";
    public static final String STATUS_CLAIMED = "claimed";
    /** 판정 대상 중 미달성이 있다(원본 값). */
    public static final String BLOCKED_MEMBERS_INCOMPLETE = "MEMBERS_INCOMPLETE";
    /** 스크린타임 보고 유예 중이라 아직 판정할 수 없는 주민이 있다(결정 Q-5 로 추가). */
    public static final String BLOCKED_MEASUREMENT_PENDING = "MEASUREMENT_PENDING";

    private QuestViews() {
    }

    /** 회차 헤더 — current 목록의 항목이자 progress 의 머리. */
    public record Item(UUID id, UUID occurrenceId, String title, String type, String windowStart,
                       String windowEnd, String timezone, String date, int targetMinutes, Integer myRate,
                       Reward reward, String settlementStatus, boolean claimable, String claimBlockedReason,
                       boolean claimed, long version) {
    }

    /** 이 회차가 섬 통장에 적립할(또는 적립한) 섬 물고기 — 결정 Q-1 로 개인 지급은 없다. */
    public record Reward(String currency, int amount) {
    }

    public record Current(List<Item> items) {
    }

    /**
     * 판정 대상 주민 한 명. {@code catColor} 는 제공자가 main 에 없어 싣지 않는다(GROMO-1765 와 같은 결정).
     * {@code measurementStatus} 는 authorized/pending/unavailable.
     */
    public record Member(UUID userId, String name, Integer rate, String measurementStatus) {
    }

    /**
     * 회차 진행 — 헤더 필드를 평평하게 펼치고 주민 목록을 붙인다. 섬 정원(최대 15)이 페이지 크기(30)보다
     * 작아 한 페이지로 끝나므로 {@code nextCursor} 는 언제나 null 이다.
     */
    public record Progress(@JsonUnwrapped Item header, List<Member> members, String nextCursor) {
    }

    public record Created(UUID id, String title) {
    }

    public record Updated(UUID id, String title, int targetMinutes) {
    }

    public record Claimed(UUID claimId, UUID occurrenceId, int villagePointsAdded, boolean claimed) {
    }
}
