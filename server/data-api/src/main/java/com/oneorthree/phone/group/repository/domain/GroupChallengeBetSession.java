package com.oneorthree.phone.group.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

/**
 * 그룹 챌린지 내기 <b>회차</b> — 챌린지가 실제로 도는 하루(GROMO-1262). 참가·판정·정산의 단위다.
 *
 * <p>설정({@link GroupChallengeBet})과 1:N 이고, {@code UNIQUE (bet_id, session_date)} 로 하루
 * 1회차가 강제된다. 구 (챌린지, 날짜) 부분 유니크(V19/V20/V28, 구 FR-7)는 V39 에서 폐기됐다.
 *
 * <p><b>미션 스냅샷(GROMO-1263)</b> — 카테고리·방식·목표분·창 시각·참가비를 개설 시점에 챌린지에서
 * 복사해 박제한다. 챌린지가 삭제돼도 「그룹 챌린지 내역」의 한 줄이 조인 없이 온전해야 하기
 * 때문이다(N6-1). 정규화를 깨는 대가로 이력의 불멸성을 산다. {@code goalMinutes} 가 null 인 행은
 * V39 백필 이전(V29 미만) 정산 이력뿐이다 — 새 회차는 항상 채워진다.
 *
 * <p>OPEN → 종료 상태 전이는 <b>엔티티 세터가 아니라</b>
 * {@code GroupChallengeBetSessionRepository.compareAndSetSettled} 의 원자적 UPDATE 가 소유한다.
 * 세터를 두면 "읽고-판단하고-쓰는" 사이가 열려 동시 정산이 둘 다 통과할 수 있기 때문이다.
 */
@Entity
@Table(name = "group_challenge_bet_sessions",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_group_challenge_bet_sessions_bet_date",
                columnNames = {"bet_id", "session_date"}),
        indexes = {
            @Index(name = "idx_group_challenge_bet_sessions_settle_scan",
                    columnList = "status, settle_after, next_attempt_at"),
            @Index(name = "idx_group_challenge_bet_sessions_group_date",
                    columnList = "group_id, session_date"),
            @Index(name = "idx_group_challenge_bet_sessions_challenge_id",
                    columnList = "challenge_id")
        })
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class GroupChallengeBetSession {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "bet_id", nullable = false)
    private GroupChallengeBet bet;

    /**
     * 내역이 그룹 소유라(챌린지 삭제 후에도 조회) 그룹을 비정규화해 둔다.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id", nullable = false)
    private Group group;

    /**
     * 챌린지는 소프트 삭제라 행이 남는다 — 삭제 뒤에도 참조는 유효하고, 표시용 스냅샷은 이 행에 있다.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "challenge_id", nullable = false)
    private GroupChallenge challenge;

    /** 회차 날짜(KST). */
    @Column(name = "session_date", nullable = false)
    private LocalDate sessionDate;

    /** 개설 시점 박제 참가비 — 설정 stake 가 이후 바뀌어도 이 회차의 돈 계산은 이 값이다. */
    @Column(nullable = false)
    private int stake;

    /**
     * 개설 시점 박제 목표 분(스냅샷). null = V39 백필 이전(V29 미만) 정산 이력 — 앱은 "—" 로 그린다.
     * 새 회차는 항상 채워진다.
     */
    @Column(name = "goal_minutes")
    private Integer goalMinutes;

    /** 미션 스냅샷 — 카테고리. */
    @Enumerated(EnumType.STRING)
    @Column(name = "mission_category", nullable = false, length = 20)
    private MissionCategory missionCategory;

    /** 미션 스냅샷 — 방식. */
    @Enumerated(EnumType.STRING)
    @Column(name = "mission_type", nullable = false, length = 20)
    private MissionType missionType;

    /** 미션 스냅샷 — 창 시작(KST 벽시계, 창형만). DURATION 은 null. */
    @Column(name = "window_start")
    private LocalTime windowStart;

    /** 미션 스냅샷 — 창 종료(KST 벽시계, 창형만). DURATION 은 null. */
    @Column(name = "window_end")
    private LocalTime windowEnd;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private GroupBetStatus status = GroupBetStatus.OPEN;

    /**
     * 무산·환불 사유(GROMO-1404) — VOIDED(인원 미달·챌린지 삭제)·24h 환불(REFUND_DEADLINE)에만
     * 채워진다. 쓰기는 상태 전이와 같은 CAS UPDATE 가 소유한다.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "void_reason", length = 40)
    private GroupBetVoidReason voidReason;

    /** 회차 시작 — 참가 취소(시작 전) 기준. 하루형은 회차일 00:00 KST, 창형은 창 시작. */
    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;

    /**
     * 참가 마감(LLD §1.1) — 창형은 창 시작, 하루형은 회차 종료. 브리지 기간의 레거시 참가 경로는
     * 종전 규칙(창 종료까지) 그대로 {@code closesAt} 을 보고, 이 값의 강제는 신 참여 API(B4)가 한다.
     */
    @Column(name = "join_closes_at", nullable = false)
    private Instant joinClosesAt;

    /** 회차 종료. */
    @Column(name = "closes_at", nullable = false)
    private Instant closesAt;

    /** 정산 가능 시각 — 창형은 종료+30분 그레이스, 하루형은 카테고리별(FOCUS +1h · SCREEN_TIME +12h). */
    @Column(name = "settle_after", nullable = false)
    private Instant settleAfter;

    @Column(name = "settled_at")
    private Instant settledAt;

    /** 정산 재시도 횟수(백오프 — B4 배선). */
    @Column(name = "settle_attempts", nullable = false)
    @Builder.Default
    private int settleAttempts = 0;

    /** 다음 재시도 시각(백오프 — B4 배선). null = 즉시. */
    @Column(name = "next_attempt_at")
    private Instant nextAttemptAt;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private Instant updatedAt;

    /**
     * 아직 참가·정산 전인 회차인가 — 종료 상태 6종과 {@link GroupBetStatus#OPEN} 을 가르는 단일 판정.
     *
     * @return {@code OPEN} 이면 true. <b>시각은 보지 않으므로</b> 참가 마감이 지났거나 정산 대기 중인
     *     회차도 true 다 — "지금 참가할 수 있다"는 뜻이 아니라 "아직 결과가 없다"는 뜻이다
     */
    public boolean isOpen() {
        return status == GroupBetStatus.OPEN;
    }
}
