package com.oneorthree.phone.group.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
                columnNames = {"session_id", "user_id"}),
        // 참가자 스코프 조회(/me/*)와 탈퇴 연동은 user_id 선두로 걷는다 — 유니크는 (session_id,
        // user_id) 라 선두가 달라 못 쓴다(V44).
        indexes = @Index(name = "idx_group_challenge_bet_participants_user_session",
                columnList = "user_id, session_id"))
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

    /**
     * 결과 모달 확인 표시(GROMO-1577, N58 · V49) — 1회 노출 가드의 <b>정본</b>이다. 앱 로컬 seen
     * 마커는 ack 실패 창의 보완재로 잔류할 뿐이고, 기기 교체·재설치를 넘어 가드가 유지되는 것은
     * 이 컬럼이다. 세팅 경로는 {@code acknowledged_at IS NULL} 조건부 원자 UPDATE 하나뿐이라
     * (리포지토리 {@code acknowledge}) 중복·동시 호출에도 최초 1회만 박힌다.
     *
     * <p><b>정산 시각이 아니다</b> — "언제 결과가 났나"는 회차의 {@code settled_at} 이고, 여기는
     * "사용자가 그 결과를 봤나"다.
     */
    @Column(name = "acknowledged_at")
    private Instant acknowledgedAt;

    /**
     * 표시 선점(lease) 시각(GROMO-1577, B17 · V49) — 이 시각 + 리스 수명까지가 유효 점유다.
     * 만료 판정을 <b>서버 시각으로만</b> 한다(응답에 절대 만료 시각을 싣지 않는다) — 기기 시계가
     * 서버보다 빠르면 살아 있는 남의 lease 를 즉시 다시 요청해 1회 기회를 태우고, 느리면 만료된
     * 뒤에도 한참 결과를 안 띄운다({@code ShedLockConfig.usingDbTime()} 과 같은 이유).
     */
    @Column(name = "display_claimed_at")
    private Instant displayClaimedAt;

    /**
     * 표시 선점 토큰(버전)(GROMO-1577, B17 · V49) — 선점할 때마다 새로 발급된다. 앱은 렌더 직전
     * 이 토큰으로 자기 선점이 아직 활성인지 확인하고, ack 은 토큰이 일치할 때만 성사된다.
     * 시각 비교만으로는 "만료 후 남이 재선점" 과 "내 선점이 아직 살아 있음"이 구분되지 않는다.
     */
    @Column(name = "display_claim_token")
    private UUID displayClaimToken;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    /** 결과 모달 확인 여부 — 조회 응답의 {@code acknowledged} 병기용(N58). */
    public boolean isAcknowledged() {
        return acknowledgedAt != null;
    }

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
     * 개인 승리 <b>사전 확정</b>(GROMO-1268 조기 확정 N11·FR-23 / GROMO-1423 계정 탈퇴 근거 박제)
     * — <b>불가역</b>이다. 목표분이 나중에 바뀌어도 회차 박제값으로 판정했으므로 번복 사유가 없다.
     *
     * <p><b>조기 확정</b>은 FOCUS 회차 전용이다 — SCREEN_TIME 은 값이 하루 종일 늘어나는 지표라
     * "먼저 확정"이 성립하지 않는다(조기 확정하면 이후 목표 초과가 정산에서 뒤집히지 못한다).
     * <b>계정 탈퇴 박제</b>는 카테고리를 가리지 않는다 — 탈퇴는 관측이 끝나는 지점이라 "그 시점
     * 달성"이 마지막 진실이고(기기가 더는 보고하지 않는다), 통계 nullify 뒤에도 이 값이 정산
     * 판정에 남는다.
     *
     * <p>{@code progressMinutes} 는 확정 시점 실측이지만 <b>박제가 아니다</b> — 정산이 전원 최종값으로
     * 다시 잰다(잔여 코인 순위가 박제값으로 엉뚱한 승자에게 가는 것을 막는다, LLD §5.2). 실측이
     * 사라진 탈퇴자만 이 값으로 폴백한다({@code GroupBetSettler.measuredOrFrozen}).
     * {@code achievedAt} 은 반대로 <b>박제</b>다 — 승리가 닫힌 순간의 시각(LLD §1.1·§5.1).
     *
     * <p><b>오버로드를 두지 않는다</b>: 시각을 안 받는 판이 함께 있으면 호출부가 무심코 그쪽을 골라
     * {@code achieved_at} 이 조용히 비는 경로가 생긴다(병합 중 실제로 두 판이 공존했다).
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
