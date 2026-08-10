package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.GroupBetStatus;
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

    /**
     * 챌린지 삭제 가드(호출부: {@code GroupChallengeService.deleteChallenge}) — 해당 status 의
     * <b>회차</b>가 걸려 있는지 본다. 시그니처는 재편 전 그대로, 판정 축만 회차로 옮겼다.
     */
    @Query("SELECT COUNT(s) > 0 FROM GroupChallengeBetSession s "
            + "WHERE s.challenge.id = :challengeId AND s.status = :status")
    boolean existsByChallengeIdAndStatus(
            @Param("challengeId") UUID challengeId,
            @Param("status") GroupBetStatus status);

    /**
     * 휴면 배지(GROMO-1201) 판정용 — "이 챌린지에 내기가 걸린 적 있나". 재편 후에는 설정 행의
     * 존재가 그 뜻이다(설정은 지워지지 않는다 — 회차가 전부 "없던 일"로 삭제돼도 남는다).
     */
    @Query("SELECT b.challenge.id FROM GroupChallengeBet b WHERE b.challenge.id IN :challengeIds")
    List<UUID> findChallengeIdsWithAnyBet(@Param("challengeIds") Collection<UUID> challengeIds);

    /**
     * 휴면 배지 판정용 — <b>OPEN 회차</b>가 걸려 있는 챌린지. 일부러 날짜 무관이다(재편 전 주석
     * 그대로): OPEN 은 오늘·내일에만 존재할 수 있어 status 만으로 "지금 걸린 판"과 동치다.
     */
    @Query("SELECT DISTINCT s.challenge.id FROM GroupChallengeBetSession s "
            + "WHERE s.challenge.id IN :challengeIds "
            + "AND s.status = com.oneorthree.phone.group.domain.GroupBetStatus.OPEN")
    List<UUID> findChallengeIdsWithOpenBet(@Param("challengeIds") Collection<UUID> challengeIds);
}
