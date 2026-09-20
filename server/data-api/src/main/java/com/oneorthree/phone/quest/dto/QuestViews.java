package com.oneorthree.phone.quest.dto;

import com.fasterxml.jackson.annotation.JsonUnwrapped;

import java.util.List;
import java.util.UUID;

/**
 * 섬 퀘스트 5계약의 Data 응답 모양 (GROMO-1773, LLD §1·§2). 공개 {@code data} 와 같은 필드다.
 *
 * <p><b>수령 축은 「나」다</b>(GROMO-1991) — {@code claimable}·{@code claimed}·{@code settlementStatus}·
 * {@code reward} 는 모두 요청한 주민 기준이고, 회차 축은 {@code bonusAmount}·{@code bonusGranted} 다.
 *
 * <p>시각 축은 UTC 다(결정 Q-6) — {@code timezone} 은 언제나 {@code "UTC"}, {@code date} 는 UTC 날짜,
 * {@code windowStart}·{@code windowEnd} 는 UTC {@code HH:mm} 이고 screen 이면 null 이다.
 */
public final class QuestViews {

    public static final String TIMEZONE = "UTC";
    public static final String CURRENCY = "village_points";
    public static final String STATUS_IN_PROGRESS = "in_progress";
    public static final String STATUS_CLAIMED = "claimed";
    /** 내가 아직 목표를 채우지 못했다(또는 판정 대상이 아니다) — GROMO-1991 로 판정 축이 「나」가 됐다. */
    public static final String BLOCKED_NOT_ACHIEVED = "NOT_ACHIEVED";
    /** 내 스크린타임 보고 유예가 끝나지 않아 아직 판정할 수 없다(결정 Q-5 로 추가). */
    public static final String BLOCKED_MEASUREMENT_PENDING = "MEASUREMENT_PENDING";

    private QuestViews() {
    }

    /**
     * 회차 헤더 — current 목록의 항목이자 progress 의 머리.
     *
     * @param reward       내가 받을(또는 받은) 개인 몫 — 회차 스냅샷의 달성자 1인 보상이다
     * @param claimable    지금 내가 «받기»를 누를 수 있다(달성했고 아직 안 받았다)
     * @param claimed      내가 이미 받았다
     * @param bonusAmount  전원 달성 보너스 총액 — 적립 전엔 지금 분모 기준 예상, 적립 뒤엔 실제 적립량
     * @param bonusGranted 전원 달성 보너스가 이미 섬 통장에 적립됐다(축하 모달 조건)
     */
    public record Item(UUID id, UUID occurrenceId, String title, String type, String windowStart,
                       String windowEnd, String timezone, String date, int targetMinutes, Integer myRate,
                       Reward reward, String settlementStatus, boolean claimable, String claimBlockedReason,
                       boolean claimed, int bonusAmount, boolean bonusGranted, long version) {
    }

    /** 섬 통장에 적립할(또는 적립한) 섬 물고기 — 개인 지갑 지급은 없다(결정 Q-1). */
    public record Reward(String currency, int amount) {
    }

    public record Current(List<Item> items) {
    }

    /**
     * 판정 대상 주민 한 명. {@code catColor} 는 제공자가 main 에 없어 싣지 않는다(GROMO-1765 와 같은 결정).
     * {@code measurementStatus} 는 authorized/pending/unavailable.
     *
     * @param achieved 목표를 채웠다 — {@code rate} 100 과 같지 않다(측정 대기·분모 제외가 있다)
     * @param claimed  개인 몫을 이미 받았다(GROMO-1991)
     */
    public record Member(UUID userId, String name, Integer rate, String measurementStatus, boolean achieved,
                         boolean claimed) {
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

    /**
     * 수령 결과 — 섬 통장 적립량은 {@code villagePointsAdded + bonusAdded} 다.
     *
     * @param villagePointsAdded 내 개인 몫
     * @param bonusAdded         이 요청이 함께 적립한 전원 달성 보너스 — 전원 달성이 아니거나 이미 적립됐으면 0
     */
    public record Claimed(UUID claimId, UUID occurrenceId, int villagePointsAdded, int bonusAdded,
                          boolean claimed) {
    }
}
