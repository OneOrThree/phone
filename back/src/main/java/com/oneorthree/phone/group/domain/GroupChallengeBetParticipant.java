package com.oneorthree.phone.group.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.domain.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
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

import java.time.Instant;
import java.util.UUID;

/**
 * 내기 <b>회차</b> 참가자(GROMO-1262 — 축이 내기 행에서 회차로 이동했다). 참가비는 참가 즉시
 * 차감(에스크로)되므로 이 행의 존재 자체가 "돈을 걸었다"는 뜻이다.
 *
 * <p>이 행의 {@code id} 는 회차 단위 돈 흐름 <b>멱등키의 축</b>이다(FR-42) — 차감·환불·지급 키가
 * 전부 {@code session:{sid}:…:{participantId}} 꼴이라, 취소 → 재참여 회차가 키에서 갈리고
 * 어떤 경로의 환불이든 참가 행당 정확히 1회로 원장 유니크가 최후 방어한다.
 *
 * <p>{@code achieved}/{@code payout} 은 정산 시점에만 채워진다 — 정산 전에는 둘 다 null 이라
 * "아직 판정 안 됨"과 "달성 실패(payout 0)"가 구분된다.
 */
@Entity
@Table(name = "group_challenge_bet_participants",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_group_challenge_bet_participants_session_user",
                columnNames = {"session_id", "user_id"}))
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class GroupChallengeBetParticipant {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "session_id", nullable = false)
    private GroupChallengeBetSession session;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    /** 정산 시 기록 — 당일 집중 분 ≥ 챌린지 목표 분. 정산 전이면 null. */
    @Column(name = "achieved")
    private Boolean achieved;

    /**
     * 조기 확정 시각(GROMO-1268, LLD §1.1) — {@link #confirmWin} 이 일어난 순간의 박제.
     * <b>조기 확정 전용</b>이다: 정산 시점 판정({@link #recordSettlement})은 회차의 {@code settled_at}
     * 이 시각 축을 담당하므로 여기를 채우지 않는다 — null 이면 "정산에서 판정됨(또는 미판정)"이고,
     * 값이 있으면 "그 시각에 이미 승리가 닫혀 있었다"는 뜻이다.
     */
    @Column(name = "achieved_at")
    private Instant achievedAt;

    /** 정산 시 기록 — 승자 분배금(패자 0) 또는 전원 환불금. 정산 전이면 null. */
    @Column(name = "payout")
    private Integer payout;

    /**
     * 정산 시 기록(GROMO-1207) — 판정에 실제로 쓴 실측 분. FOCUS 무기록은 0(판정도 0으로 봤다),
     * SCREEN_TIME 미보고는 null(미계측 — 앱이 "—" 로 그린다). 정산 전·V29 이전 정산 행도 null 이라
     * {@code achieved}/{@code payout} 처럼 "아직 판정 안 됨"과 값 0 이 구분된다.
     */
    @Column(name = "progress_minutes")
    private Integer progressMinutes;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    /**
     * 정산 결과 기록. 재실행은 내기 status 가드로 막으므로 여기서는 덮어쓰기만 한다.
     *
     * @param progressMinutes 판정에 쓴 실측 분 — 미계측(SCREEN_TIME 미보고)이면 null
     */
    public void recordSettlement(boolean achieved, int payout, Integer progressMinutes) {
        this.achieved = achieved;
        this.payout = payout;
        this.progressMinutes = progressMinutes;
    }

    /**
     * 개인 승리 조기 확정(GROMO-1268, N11·FR-23) — <b>불가역</b>이다. 목표분이 나중에 바뀌어도
     * 회차 박제값으로 판정했으므로 번복 사유가 없다. FOCUS 회차 전용이다 — SCREEN_TIME 은 값이
     * 하루 종일 늘어나는 지표라 "먼저 확정"이 성립하지 않는다(조기 확정하면 이후 목표 초과가
     * 정산에서 뒤집히지 못한다).
     *
     * <p>{@code progressMinutes} 는 확정 시점 실측이지만 <b>박제가 아니다</b> — 정산이 전원 최종값으로
     * 다시 잰다(잔여 코인 순위가 박제값으로 엉뚱한 승자에게 가는 것을 막는다, LLD §5.2).
     * {@code achievedAt} 은 반대로 <b>박제</b>다 — 조기 확정이 일어난 순간의 시각(LLD §1.1·§5.1).
     * 호출 전제: 회차 행 잠금 아래 + {@code achieved == null}.
     */
    public void confirmWin(int progressMinutes, Instant achievedAt) {
        this.achieved = true;
        this.achievedAt = achievedAt;
        this.progressMinutes = progressMinutes;
    }

    /**
     * 환불 기록(무산·24h 데드라인) — 판정 없이 돈만 되돌아간 경우다. {@code achieved} 는 null 로
     * 남겨 "판정 안 됨"과 "달성 실패(payout 0)"의 구분(클래스 주석)을 지킨다. 원장이 단일 진실이고
     * 이 값은 표시용 근거다.
     */
    public void recordRefund(int payout) {
        this.payout = payout;
    }

    /**
     * id 기반 동등성 — 저장 전(id null)인 엔티티는 자기 자신 외 어떤 객체와도 같지 않다.
     * 비교 상대의 id 는 필드가 아니라 getter 로 읽는다 — Hibernate 프록시는 필드가 비어 있어도
     * getter 호출로 초기화되기 때문이다.
     */
    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof GroupChallengeBetParticipant other)) {
            return false;
        }
        return id != null && id.equals(other.getId());
    }

    /**
     * 클래스 상수 해시 — id 기반 해시는 persist 시점에 값이 바뀌어 Set 에 먼저 넣은 엔티티를
     * 잃어버린다. getClass() 가 아니라 클래스 리터럴을 쓰는 것도 같은 이유다(프록시는 서브클래스라
     * getClass() 해시가 원본과 달라진다).
     */
    @Override
    public int hashCode() {
        return GroupChallengeBetParticipant.class.hashCode();
    }
}
