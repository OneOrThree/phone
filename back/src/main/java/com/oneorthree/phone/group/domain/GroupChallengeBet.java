package com.oneorthree.phone.group.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.domain.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * 그룹 챌린지 내기 — 챌린지 하나의 특정 날짜({@code betDate})에 걸린 판.
 *
 * <p>대상은 FOCUS + DURATION 챌린지뿐이다(스크린타임 달성은 클라 신뢰라 돈을 걸 수 없다).
 * 챌린지당·날짜당 1개이며, 유니크 제약이 동시 개설의 최후 방어선이다.
 */
@Entity
@Table(name = "group_challenge_bets",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_group_challenge_bets_challenge_bet_date",
                columnNames = {"challenge_id", "bet_date"}))
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class GroupChallengeBet {

    @Id
    @GeneratedUuidV7
    private UUID id;

    // 조회가 항상 그룹 스코프로 들어오므로(그룹원 검증) 챌린지를 거치지 않고 바로 걸러내려 비정규화해 둔다.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id", nullable = false)
    private Group group;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "challenge_id", nullable = false)
    private GroupChallenge challenge;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "creator_user_id", nullable = false)
    private User creatorUser;

    /** 1인 판돈. 팟 = stake × 참가자 수. 서버 허용값만 저장된다. */
    @Column(nullable = false)
    private int stake;

    /** 내기 대상 날짜(KST). 개설·참가는 오늘 날짜만 허용한다. */
    @Column(name = "bet_date", nullable = false)
    private LocalDate betDate;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private GroupBetStatus status = GroupBetStatus.OPEN;

    @Column(name = "settled_at")
    private Instant settledAt;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private Instant updatedAt;

    /**
     * OPEN → SETTLED/REFUNDED 전이는 <b>엔티티 세터가 아니라</b>
     * {@code GroupChallengeBetRepository.compareAndSetSettled} 의 원자적 UPDATE 가 소유한다.
     * 세터를 두면 "읽고-판단하고-쓰는" 사이가 열려 동시 정산이 둘 다 통과할 수 있기 때문이다
     * (돈이 걸린 전이라 게이트 자체가 원자적이어야 한다).
     */
    public boolean isOpen() {
        return status == GroupBetStatus.OPEN;
    }
}
