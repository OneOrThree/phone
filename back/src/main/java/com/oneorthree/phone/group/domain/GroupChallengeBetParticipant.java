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
 * 내기 참가자. 판돈은 참가 즉시 차감(에스크로)되므로 이 행의 존재 자체가 "돈을 걸었다"는 뜻이다.
 *
 * <p>{@code achieved}/{@code payout} 은 정산 시점에만 채워진다 — 정산 전에는 둘 다 null 이라
 * "아직 판정 안 됨"과 "달성 실패(payout 0)"가 구분된다.
 */
@Entity
@Table(name = "group_challenge_bet_participants",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_group_challenge_bet_participants_bet_user",
                columnNames = {"bet_id", "user_id"}))
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class GroupChallengeBetParticipant {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "bet_id", nullable = false)
    private GroupChallengeBet bet;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    /** 정산 시 기록 — 당일 집중 분 ≥ 챌린지 목표 분. 정산 전이면 null. */
    @Column(name = "achieved")
    private Boolean achieved;

    /** 정산 시 기록 — 승자 분배금(패자 0) 또는 전원 환불금. 정산 전이면 null. */
    @Column(name = "payout")
    private Integer payout;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    /** 정산 결과 기록. 재실행은 내기 status 가드로 막으므로 여기서는 덮어쓰기만 한다. */
    public void recordSettlement(boolean achieved, int payout) {
        this.achieved = achieved;
        this.payout = payout;
    }
}
