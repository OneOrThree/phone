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
 * <p>대상은 목표분이 있는 모든 챌린지다 — FOCUS·SCREEN_TIME × DURATION·TIME_WINDOW 4조합
 * (창은 목표분이 있는 것만). <b>비취소</b> 내기는 챌린지당·날짜당 1개 — 취소(CANCELED)는 "없던 일"이라
 * 같은 날짜 재개설을 막지 않는다(GROMO-1201). 동시 개설의 최후 방어선은 V27 부분 유니크 인덱스
 * ({@code WHERE status <> 'CANCELED'})인데, JPA 가 부분 인덱스를 표현할 수 없어 여기엔
 * {@code @UniqueConstraint} 를 두지 않는다(실 SQL 검증은 {@code GroupChallengeV27MigrationTest}).
 */
@Entity
@Table(name = "group_challenge_bets")
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
