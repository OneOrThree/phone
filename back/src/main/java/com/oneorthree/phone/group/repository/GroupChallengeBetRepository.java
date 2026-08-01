package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GroupChallengeBetRepository extends JpaRepository<GroupChallengeBet, UUID> {

    boolean existsByChallengeIdAndBetDate(UUID challengeId, LocalDate betDate);

    /** 챌린지 삭제 가드 — 진행 중(OPEN) 내기가 걸려 있는 챌린지는 지울 수 없다. */
    boolean existsByChallengeIdAndStatus(UUID challengeId, GroupBetStatus status);

    /** 참가 진입점 — 내기 id 와 그룹 스코프를 함께 검증한다(남의 그룹 내기에 참가 불가). */
    Optional<GroupChallengeBet> findByIdAndGroupId(UUID id, UUID groupId);

    /** 조회 조립용 — 챌린지 목록의 해당 날짜 내기를 IN 절 1회로 배치 로드한다(N+1 방지). */
    List<GroupChallengeBet> findByChallengeIdInAndBetDate(Collection<UUID> challengeIds, LocalDate betDate);

    /**
     * 조회 조립용 — 챌린지별 <b>가장 최근 정산 내기 1건만</b> 배치 로드한다("지난 내기" 한 줄용).
     *
     * <p>Postgres {@code DISTINCT ON} 은 {@code ORDER BY} 선두 컬럼(challenge_id)마다 첫 행 하나만
     * 남긴다 — 그래서 결과는 챌린지 수만큼으로 고정된다. 전건을 끌어와 애플리케이션에서 추리면
     * 정산 이력이 쌓일수록(챌린지당 하루 1건) 그룹 상세 조회가 통째로 무거워진다.
     *
     * <p>(challenge_id, bet_date) 유니크 제약이 있어 동률이 없으므로 선택은 항상 결정적이다.
     * JPQL 로는 표현할 수 없어 네이티브 쿼리로 둔다.
     */
    @Query(value = "SELECT DISTINCT ON (b.challenge_id) b.* FROM group_challenge_bets b "
            + "WHERE b.challenge_id IN (:challengeIds) AND b.status <> 'OPEN' "
            + "ORDER BY b.challenge_id, b.bet_date DESC", nativeQuery = true)
    List<GroupChallengeBet> findLatestSettledByChallengeIds(
            @Param("challengeIds") Collection<UUID> challengeIds);

    /**
     * 정산 게이트 — {@code OPEN} 인 내기만 종료 상태로 <b>원자적으로</b> 전이시킨다(compare-and-set).
     *
     * <p>스케줄러(04:00)와 수동 트리거({@code POST /groups/bets/settle})가 겹쳐도 이 UPDATE 에
     * 성공한 트랜잭션 하나만 지급을 적용한다 — 뒤에 온 트랜잭션은 행 락에서 대기하다가 앞이 커밋되면
     * {@code status = OPEN} 조건이 깨져 0행을 돌려받고 스킵한다. 멱등키 유니크 제약은 이제
     * "우연한 방어선"이 아니라 최후 방어선으로만 남는다.
     *
     * <p>벌크 UPDATE 라 영속성 컨텍스트를 우회한다 — 호출 후 같은 트랜잭션에서 엔티티의
     * {@code status}/{@code settledAt} 을 읽지 말 것(값이 갱신 전 그대로다). {@code @UpdateTimestamp}
     * 도 타지 않으므로 {@code updatedAt} 을 함께 써 준다.
     *
     * @return 1 = 이 트랜잭션이 정산 권한을 가져갔다, 0 = 이미 다른 트랜잭션이 가져갔다(스킵)
     */
    @Modifying(flushAutomatically = true)
    @Query("UPDATE GroupChallengeBet b SET b.status = :settledStatus, b.settledAt = :settledAt, "
            + "b.updatedAt = :settledAt "
            + "WHERE b.id = :id AND b.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN")
    int compareAndSetSettled(
            @Param("id") UUID id,
            @Param("settledStatus") GroupBetStatus settledStatus,
            @Param("settledAt") Instant settledAt);

    /** CAS 실패(0행) 시 "누가 어떤 상태로 끝냈는지" 를 엔티티 캐시 없이 다시 읽는다. */
    @Query("SELECT b.status FROM GroupChallengeBet b WHERE b.id = :id")
    Optional<GroupBetStatus> findStatusById(@Param("id") UUID id);

    /**
     * 일 배치 대상 — 어제까지의 미정산 내기 id. 엔티티가 아니라 id 만 뽑는 이유는 내기 단위로
     * 트랜잭션을 새로 열어 처리하기 때문이다(한 건 실패가 다른 건을 말아먹지 않게).
     */
    @Query("SELECT b.id FROM GroupChallengeBet b "
            + "WHERE b.status = :status AND b.betDate < :beforeDate ORDER BY b.betDate, b.id")
    List<UUID> findIdsByStatusAndBetDateBefore(
            @Param("status") GroupBetStatus status,
            @Param("beforeDate") LocalDate beforeDate);
}
