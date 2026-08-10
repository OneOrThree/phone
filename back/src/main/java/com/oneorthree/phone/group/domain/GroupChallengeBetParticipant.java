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
