package com.oneorthree.phone.focus.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * v0.3 집중 세션 상세 (GROMO-1764) — {@code focus_sessions}(레거시) 행과 PK/FK로 1:1이다.
 * 이 행의 존재 자체가 "이 세션은 v0.3 프로토콜"이라는 판별자다(LLD §5).
 *
 * <p>소속(islandId)·subject·목표 시간은 시작 후 불변이다(FR-P03). {@code lifecycle}·{@code version}·
 * {@code lastTransitionAt}·{@code restSeat}는 pause/resume/finish가 서버 시각 anchor로 전진시킨다.
 * user당 active/paused는 부분 UNIQUE(V58)로 최대 1건, restSeat는 (islandId, restSeat)로 부분 UNIQUE다.
 *
 * <p>{@code userId}/{@code islandId}는 지연 로딩 연관관계 없이 원시 UUID로 둔다 — 이 행이 필요로 하는
 * 것은 소유·소속 비교뿐이고, outbox·PublicCommandRequest 등 호출부도 전부 UUID를 받는다.
 */
@Entity
@Table(name = "focus_session_details")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class FocusSessionDetail {

    /** 레거시 {@code focus_sessions.id}와 같은 값 — 별도로 발급하지 않는다. */
    @Id
    @Column(name = "session_id")
    private UUID sessionId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /** 시작 시 고정, 진행 중 불변(FR-P03) — 소속 변경은 진행 세션에 반영되지 않는다. */
    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    /**
     * 시작 시점의 {@code GroupMember.membershipEpoch} 스냅샷 — 강퇴·재가입 감지용 앵커.
     * FR-D03(소속 상실 시 처리)이 미결이라 지금은 기록만 하고 비교 로직은 없다.
     */
    @Column(name = "membership_epoch_at_start", nullable = false)
    private long membershipEpochAtStart;

    @Column(nullable = false, length = 200)
    private String subject;

    @Column(name = "target_minutes", nullable = false)
    private int targetMinutes;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private FocusSessionLifecycle lifecycle;

    /** 낙관 버전 — pause/resume/finish마다 +1. expectedVersion 검사 대상(FR-P07). */
    @Column(nullable = false)
    @Builder.Default
    private long version = 1L;

    @Column(name = "last_transition_at", nullable = false)
    private Instant lastTransitionAt;

    /**
     * 시작 시 고정한 보상 정책 revision — FR-D01 미확정인 동안은 항상 {@code null}(미설정 sentinel).
     * finish의 지급 게이트가 이 값이 아니라 {@link com.oneorthree.phone.focus.support.FocusRewardPolicyGate}의
     * 전역 설정 여부로 판단한다 — 세션별로 다른 값을 지어내지 않는다.
     */
    @Column(name = "policy_revision")
    private Integer policyRevision;

    /**
     * paused 동안만 값이 있다 — 섬 안에서 1..N 중 빈 최소 번호(기술 선택, 자리 예약 API 아님).
     * active/completed 전이에서 null로 지운다.
     */
    @Column(name = "rest_seat")
    private Integer restSeat;

    @CreationTimestamp
    private Instant createdAt;

    /** pause 전이 — REST 구간을 연 t로 lifecycle·restSeat·version·lastTransitionAt을 한 번에 전진시킨다. */
    public void applyPause(Instant t, int restSeat) {
        this.lifecycle = FocusSessionLifecycle.PAUSED;
        this.restSeat = restSeat;
        this.version = this.version + 1;
        this.lastTransitionAt = t;
    }

    /** resume 전이 — restSeat를 지우고 ACTIVE로 되돌린다. */
    public void applyResume(Instant t) {
        this.lifecycle = FocusSessionLifecycle.ACTIVE;
        this.restSeat = null;
        this.version = this.version + 1;
        this.lastTransitionAt = t;
    }
}
