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

    /**
     * 목표 시간(분) — <b>선택</b>이다(GROMO-1990, V82 에서 NOT NULL 해제). 보상이 목표가 아니라 순수
     * 집중 시간에만 걸리므로 목표 없이도 시작할 수 있고, 그때 {@code goalAchieved} 는 늘 false 다.
     * 값이 있으면 0 이하는 여전히 거절한다.
     */
    @Column(name = "target_minutes")
    private Integer targetMinutes;

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
     * 시작 시 고정한 보상 정책 revision({@link FocusRewardPolicy}) — 운영이 새 revision 을 내도 진행 중
     * 세션의 지급률은 바뀌지 않는다(LLD §3). GROMO-1924 이전에 생긴 행(시작 게이트가 닫혀 있어 실제로는
     * 없다)은 {@code null} 이고, finish 는 그 세션을 {@code REWARD_POLICY_UNAVAILABLE} 로 막는다 —
     * 정책 없이 값을 지어내 지급하지 않는다.
     */
    @Column(name = "policy_revision")
    private Integer policyRevision;

    /**
     * paused 동안만 값이 있다 — 섬 안에서 1..N 중 빈 최소 번호(기술 선택, 자리 예약 API 아님).
     * active/completed 전이에서 null로 지운다.
     */
    @Column(name = "rest_seat")
    private Integer restSeat;

    /**
     * 적립 틱이 <b>판정을 마친</b> 순수 집중 초 (V82, GROMO-1990). 언제나
     * {@code secondsPerFish} 의 배수이고, 하루 상한에 걸려 실제로는 못 받은 몫도 여기에 포함된다 —
     * 그래야 자정에 상한이 풀릴 때 어제 깎인 몫이 한꺼번에 터지지 않는다.
     *
     * <p>{@code version}·{@code lastTransitionAt} 은 건드리지 않는다: 적립은 사용자가 일으킨 전이가
     * 아니라서 앱이 쥔 {@code expectedVersion} 을 낡게 만들면 안 된다.
     */
    @Column(name = "rewarded_seconds", nullable = false, columnDefinition = "bigint not null default 0")
    @Builder.Default
    private long rewardedSeconds = 0L;

    /** 값은 {@link CreationTimestamp}가 채우지만, DB 기본값도 V58 과 같게 선언해 둔다(위 version 주석 참조). */
    @CreationTimestamp
    @Column(columnDefinition = "timestamptz not null default now()")
    private Instant createdAt;

    /**
     * 적립 워터마크를 민다 (GROMO-1990) — 판정을 마친 순수 집중 초까지. 전이가 아니므로 version 은
     * 그대로다.
     */
    public void markRewarded(long seconds) {
        this.rewardedSeconds = seconds;
    }

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
     * 완료 전이 — finish 가 정산과 같은 TX 에서 {@link FocusSessionLifecycle#COMPLETED} 로 끝낸다.
     * 휴식 중 finish 도 가능하므로 휴식 자리를 반납한다.
     */
    public void applyComplete(Instant t) {
        this.lifecycle = FocusSessionLifecycle.COMPLETED;
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
