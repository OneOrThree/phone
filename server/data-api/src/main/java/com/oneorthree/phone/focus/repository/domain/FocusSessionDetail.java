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

    /**
     * 세션 주인. <b>탈퇴하면 null</b>이 된다 — 레거시 {@code focus_sessions.user_id}와 같은 익명화
     * 방식이다({@code FocusSessionDetailRepository#anonymizeWithdrawnUser}). 행을 지우지 않는 것은
     * 이 상세가 섬 건설 기여·정산 원장의 근거이기 때문이고, {@code user_id} 조건이 붙은 모든 조회는
     * 끊긴 행을 자연히 걸러 낸다.
     */
    @Column(name = "user_id")
    private UUID userId;

    /** 시작 시 고정, 진행 중 불변(FR-P03) — 소속 변경은 진행 세션에 반영되지 않는다. */
    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    /**
     * 시작 시점의 {@code GroupMember.membershipEpoch} 스냅샷 — 강퇴·재가입 감지용 앵커.
     * 소속 상실은 강퇴 TX 가 진행 세션을 직접 종결해 다룬다(FR-D03, GROMO-1924) — 그래서 이 값을 비교해
     * 뒤늦게 감지할 필요가 없고, 지금은 기록만 한다.
     */
    @Column(name = "membership_epoch_at_start", nullable = false)
    private long membershipEpochAtStart;

    @Column(nullable = false, length = 200)
    private String subject;

    @Column(name = "target_minutes", nullable = false)
    private int targetMinutes;

    /** 열 폭 20 — {@link FocusSessionLifecycle#MEMBERSHIP_LOST}(15자)가 V58 의 10 을 넘어 V67 이 넓혔다. */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private FocusSessionLifecycle lifecycle;

    /**
     * 낙관 버전 — pause/resume/finish마다 +1. expectedVersion 검사 대상(FR-P07).
     *
     * <p>{@code columnDefinition}으로 DB 기본값까지 선언한다. local 은 Flyway 를 끄고
     * {@code ddl-auto: update} 를 쓰므로, 빠뜨리면 local 스키마에만 기본값이 없어
     * V58 이 만든 스키마와 조용히 어긋난다.
     */
    @Column(nullable = false, columnDefinition = "bigint not null default 1")
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

    /** 값은 {@link CreationTimestamp}가 채우지만, DB 기본값도 V58 과 같게 선언해 둔다(위 version 주석 참조). */
    @CreationTimestamp
    @Column(columnDefinition = "timestamptz not null default now()")
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

    /**
     * 포기 전이 — 기본 {@code focus_sessions} 마커가 바깥에서 닫혀 더 진행할 수 없게 된 세션을
     * {@link FocusSessionLifecycle#ABANDONED}로 종결한다(정상 완료 아님, 정산 없음).
     * 휴식 자리는 반납한다(resume과 같은 결) — paused인 채로 어긋났을 수 있다.
     */
    public void applyAbandon(Instant t) {
        this.lifecycle = FocusSessionLifecycle.ABANDONED;
        this.restSeat = null;
        this.version = this.version + 1;
        this.lastTransitionAt = t;
    }

    /**
     * 소속 상실 종결 — 강퇴 TX 가 진행 세션을 {@link FocusSessionLifecycle#MEMBERSHIP_LOST} 로 끝낸다
     * (FR-D03, 정산 없음). 휴식 자리는 반납한다.
     */
    public void applyMembershipLost(Instant t) {
        this.lifecycle = FocusSessionLifecycle.MEMBERSHIP_LOST;
        this.restSeat = null;
        this.version = this.version + 1;
        this.lastTransitionAt = t;
    }
}
