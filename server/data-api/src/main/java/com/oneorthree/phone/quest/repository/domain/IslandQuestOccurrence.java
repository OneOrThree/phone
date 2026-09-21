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

import java.time.Duration;
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
 * <p>{@code version} 은 quest.progress 축(섬·퀘스트·회차)의 마지막 발급값이다 — 여는 사건이 1 을 받고
 * 이후 주민의 개인 수령마다 1씩 오른다(GROMO-1991). 이벤트 봉투의 aggregateVersion 과 늘 같은 값이다(LLD §6).
 */
@Entity
@Table(name = "island_quest_occurrences", uniqueConstraints = @UniqueConstraint(
        name = "uq_island_quest_occurrence", columnNames = {"quest_id", "occurrence_date"}))
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class IslandQuestOccurrence {

    /** 다음 날 12:00 UTC — 스크린타임 보고 유예 끝(결정 Q-5)이자 focus 수령 마감. */
    private static final LocalTime NEXT_DAY_NOON = LocalTime.NOON;

    /** 보너스 finalizer 틱 간격 — {@link #bonusSettleDeadline()} 이 수령 마감을 넘겨 주는 폭이다. */
    private static final Duration BONUS_SETTLE_CATCH_UP = Duration.ofMinutes(1);

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

    /**
     * 전원 달성 보너스를 섬 통장에 적립한 시각 — null 이면 아직이다(GROMO-1991). 개인 수령은 주민마다
     * 시각이 달라 여기 담기지 않는다 — {@code island_quest_claims} 의 ACHIEVER 행이 갖는다.
     */
    @Column(name = "bonus_settled_at")
    private Instant bonusSettledAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public boolean isBonusSettled() {
        return bonusSettledAt != null;
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
        return nextDayNoon();
    }

    /**
     * 수령 마감 — 이 회차가 «현재»(조회·수령 가능)인 마지막 순간(제외).
     *
     * <p>focus 는 다음 날 12:00 UTC 까지 — 달성은 창 안에서 끝나지만 수령에 반나절 여유를 준다(스크린타임
     * 유예와 시각만 같을 뿐 다른 규칙이다). screen 은 측정 유예(다음 날 12:00)가 끝난 뒤에야 측정 불가자를
     * 확정할 수 있으므로 그다음 자정(date+2 00:00 UTC)까지다. 이 경계를 지나면 회차는 과거가 되어
     * 조회·수령이 닫힌다(LLD §6 과거 없음).
     */
    public Instant claimDeadline() {
        return type == QuestType.FOCUS
                ? nextDayNoon()
                : occurrenceDate.plusDays(2).atStartOfDay().toInstant(ZoneOffset.UTC);
    }

    /**
     * 전원 달성 보너스 <b>정산</b> 마감 — 수령 마감보다 딱 한 틱 늦다(GROMO-1991 codex 2R).
     *
     * <p>보너스는 매분 finalizer 가 적립한다. 그래서 <b>마지막 틱과 {@link #claimDeadline()} 사이</b>(최대
     * 한 틱)에 미달성 주민이 분모에서 빠져 전원 달성이 «마감 전에» 성립하면, 그 판정을 볼 틱이 하나도 없다 —
     * 다음 틱은 이미 마감 뒤라 예전 가드가 0 을 돌려주고 보너스가 <b>영구 누락</b>됐다. 마감을 넘긴 첫 틱
     * 하나까지 정산을 열어 두어 그 판정을 뒤늦게라도 보게 한다.
     *
     * <p>「마감 뒤에 새로 생긴 달성」과 「마감 전에 이미 성립한 달성」은 <b>판정 시각</b>이 가른다 —
     * 마감을 넘긴 틱은 {@code now} 가 아니라 이 마감으로 잘라 판정한다
     * ({@code IslandQuestService#settleBonusIfAllAchieved}). 그래도 분모(현재 활성 주민)만은 «지금»이라
     * 마감 직후 한 틱 안의 탈퇴는 섞일 수 있는데, 그 창이 곧 틱 간격이라 이 기능이 선언한 해상도
     * (정책 Q05 「즉시의 해상도는 1분」)를 넘지 않는다.
     */
    public Instant bonusSettleDeadline() {
        return claimDeadline().plus(BONUS_SETTLE_CATCH_UP);
    }

    private Instant nextDayNoon() {
        return occurrenceDate.plusDays(1).atTime(NEXT_DAY_NOON).toInstant(ZoneOffset.UTC);
    }

    /** 전원 달성 보너스 적립 — 회차당 1회다(기획 정본 「각각 한 번만 지급」). */
    public void settleBonus(Instant at) {
        this.bonusSettledAt = at;
    }

    /** quest.progress 축이 발급한 version 을 싣는다 — 여는 사건·개인 수령·보너스 적립이 모두 이 축이다. */
    public void progressed(long newVersion) {
        this.version = newVersion;
    }
}
