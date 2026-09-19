package com.oneorthree.phone.quest.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.UUID;

/**
 * 섬 퀘스트 회차 (GROMO-1773, LLD §3 Occurrence) — (퀘스트, UTC 날짜)마다 하나다.
 *
 * <p>여는 순간 정의(제목·목표·창)와 보상 설정을 <b>스냅샷</b>으로 복사한다. 그래서 정의 PATCH 는 이
 * 행을 건드리지 않고 다음 회차부터 적용된다(결정 Q-4). 판정 대상 주민(cohort)도 같은 순간 고정해
 * {@code island_quest_cohort_members} 에 남긴다(결정 Q-3).
 *
 * <p>날짜 축은 UTC 다(결정 Q-6): 회차는 {@code date 00:00Z} 에 시작하고, focus 창은
 * {@code date windowStart~windowEnd} UTC 이다. 자정을 넘는 창은 만들 수 없다(정의 CHECK).
 *
 * <p>{@code version} 은 quest.progress 축(섬·퀘스트·회차)의 마지막 발급값이다 — 여는 사건이 1,
 * 정산 사건이 2 를 받는다. 이벤트 봉투의 aggregateVersion 과 늘 같은 값이다(LLD §6).
 */
@Entity
@Table(name = "island_quest_occurrences", uniqueConstraints = @UniqueConstraint(
        name = "uq_island_quest_occurrence", columnNames = {"quest_id", "occurrence_date"}))
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class IslandQuestOccurrence {

    /** 스크린타임 측정 유예 — 다음 날 12:00 UTC 까지 보고를 받는다(결정 Q-5). */
    private static final LocalTime SCREEN_GRACE = LocalTime.NOON;

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "quest_id", nullable = false)
    private UUID questId;

    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    /** UTC 날짜 — 회차 귀속일. */
    @Column(name = "occurrence_date", nullable = false)
    private LocalDate occurrenceDate;

    @Column(name = "definition_revision", nullable = false)
    private int definitionRevision;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private QuestType type;

    @Column(nullable = false, length = 40)
    private String title;

    @Column(name = "target_minutes", nullable = false)
    private int targetMinutes;

    @Column(name = "window_start")
    private LocalTime windowStart;

    @Column(name = "window_end")
    private LocalTime windowEnd;

    /** 달성 주민 1명당 섬 통장 적립(D5 개인 달성 +10 — 귀속은 결정 Q-1 로 섬 통장 100%). */
    @Column(name = "reward_per_achiever", nullable = false)
    private int rewardPerAchiever;

    /** 전원 달성 보너스의 1인당 몫(D5 대상 주민 수 × 5). */
    @Column(name = "reward_bonus_per_member", nullable = false)
    private int rewardBonusPerMember;

    @Column(nullable = false)
    private long version;

    /** 정산(claim) 확정 시각 — null 이면 미정산. */
    @Column(name = "claimed_at")
    private Instant claimedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public boolean isClaimed() {
        return claimedAt != null;
    }

    /** focus 창 시작 instant — screen 이면 null. */
    public Instant windowStartAt() {
        return windowStart == null ? null : occurrenceDate.atTime(windowStart).toInstant(ZoneOffset.UTC);
    }

    /** focus 창 끝 instant(제외) — screen 이면 null. */
    public Instant windowEndAt() {
        return windowEnd == null ? null : occurrenceDate.atTime(windowEnd).toInstant(ZoneOffset.UTC);
    }

    /** 스크린타임 보고 유예 끝 — 이 시각 이후 보고 없는 주민은 측정 불가로 분모에서 빠진다. */
    public Instant screenGraceEndsAt() {
        return occurrenceDate.plusDays(1).atTime(SCREEN_GRACE).toInstant(ZoneOffset.UTC);
    }

    /**
     * 이 회차가 «현재»(조회·수령 가능)인 마지막 순간(제외).
     *
     * <p>focus 는 다음 날 12:00 UTC 까지 — 달성은 창 안에서 끝나지만 수령에 반나절 여유를 준다.
     * screen 은 측정 유예(다음 날 12:00)가 끝난 뒤에야 측정 불가자를 확정할 수 있으므로 그다음 자정
     * (date+2 00:00 UTC)까지다. 이 경계를 지나면 회차는 과거가 되어 조회·수령이 닫힌다(LLD §6 과거 없음).
     */
    public Instant closesAt() {
        return type == QuestType.FOCUS
                ? screenGraceEndsAt()
                : occurrenceDate.plusDays(2).atStartOfDay().toInstant(ZoneOffset.UTC);
    }

    /** 정산 확정 — 같은 TX 에서 발급한 quest.progress version 을 싣는다. */
    public void markClaimed(Instant at, long newVersion) {
        this.claimedAt = at;
        this.version = newVersion;
    }

    /** 여는 사건이 발급한 version 을 싣는다(보통 1). */
    public void opened(long newVersion) {
        this.version = newVersion;
    }
}
