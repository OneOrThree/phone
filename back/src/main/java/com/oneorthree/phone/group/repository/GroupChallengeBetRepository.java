package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.GroupChallengeBet;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 내기 <b>설정</b> 리포지토리(GROMO-1262 재편 이후) — 챌린지당 1행. 회차(참가·정산 단위)는
 * {@link GroupChallengeBetSessionRepository} 가 맡는다.
 *
 * <p>아래 세 조회는 {@code GroupChallengeService}(챌린지 카드·삭제 가드)가 쓰는 기존 시그니처를
 * 유지한 채 새 2계층 스키마 위로 재구현한 것이다 — 호출부(B1 소유)를 깨지 않기 위한 계약이다.
 */
public interface GroupChallengeBetRepository extends JpaRepository<GroupChallengeBet, UUID> {

    /** 설정 1:1 조회 — 레거시 개설 브리지가 "이미 설정이 있나"를 본다. */
    Optional<GroupChallengeBet> findByChallengeId(UUID challengeId);

    // 구 삭제 가드 existsByChallengeIdAndStatus 는 GROMO-1272(삭제 = OPEN 회차 무효화+환불)로
    // 폐기 — 호출부가 GroupBetSettler.voidOpenSessionsForChallengeDelete 로 대체됐다.

    /**
     * 휴면 배지(GROMO-1201) 판정용 — "이 챌린지에 내기가 걸린 적 있나". 재편 후에는 설정 행의
     * 존재가 그 뜻이다(설정은 지워지지 않는다 — 회차가 전부 "없던 일"로 삭제돼도 남는다).
     */
    @Query("SELECT b.challenge.id FROM GroupChallengeBet b WHERE b.challenge.id IN :challengeIds")
    List<UUID> findChallengeIdsWithAnyBet(@Param("challengeIds") Collection<UUID> challengeIds);

    /**
     * 자동 개설 스캔 대상(GROMO-1411 배치·N35) — 내기가 켜진 설정 중 챌린지가 살아 있는(ACTIVE·
     * 미삭제) 것의 <b>챌린지 id</b>. 엔티티가 아니라 id 만 뽑는 이유는 개설이 챌린지 단위로
     * 트랜잭션을 새로 열어 처리되기 때문이다(한 건 실패가 다른 건을 말아먹지 않게).
     */
    @Query("SELECT b.challenge.id FROM GroupChallengeBet b JOIN b.challenge c "
            + "WHERE b.enabled = true "
            + "AND c.status = com.oneorthree.phone.group.domain.GroupChallengeStatus.ACTIVE "
            + "AND c.deletedAt IS NULL ORDER BY b.id")
    List<UUID> findActiveEnabledChallengeIds();

    /**
     * 카드 조립용(GROMO-1418) — <b>켜져 있는 설정</b>을 챌린지 목록 단위로 배치 로드한다. 회차가
     * 하루도 없는 챌린지(마지막 참가자 취소로 회차 행 삭제 / lazy 개설 전)도 "내기가 걸려 있다"는
     * 사실은 설정 행에 남아 있으므로, 회차 조회만으로 카드를 만들면 신앱이 {@code bet=null} 을
     * "내기 꺼짐"으로 읽어 참여 진입점을 지운다.
     *
     * <p>끝났거나(ACTIVE 아님) 삭제된 챌린지는 제외한다 — 참여할 수 없는 챌린지에 내기 진입점을
     * 세우지 않는다({@link #findActiveEnabledChallengeIds} 와 같은 기준).
     */
    @Query("SELECT b FROM GroupChallengeBet b JOIN FETCH b.challenge c "
            + "WHERE c.id IN :challengeIds AND b.enabled = true "
            + "AND c.status = com.oneorthree.phone.group.domain.GroupChallengeStatus.ACTIVE "
            + "AND c.deletedAt IS NULL")
    List<GroupChallengeBet> findEnabledByChallengeIdIn(@Param("challengeIds") Collection<UUID> challengeIds);

    /**
     * 휴면 배지 판정용 — <b>OPEN 회차</b>가 걸려 있는 챌린지. 일부러 날짜 무관이다(재편 전 주석
     * 그대로): OPEN 은 오늘·내일에만 존재할 수 있어 status 만으로 "지금 걸린 판"과 동치다.
     */
    @Query("SELECT DISTINCT s.challenge.id FROM GroupChallengeBetSession s "
            + "WHERE s.challenge.id IN :challengeIds "
            + "AND s.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN")
    List<UUID> findChallengeIdsWithOpenBet(@Param("challengeIds") Collection<UUID> challengeIds);
}
