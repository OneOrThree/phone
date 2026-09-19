package com.oneorthree.phone.quest.repository;

import com.oneorthree.phone.quest.repository.domain.IslandQuestClaim;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface IslandQuestClaimRepository extends JpaRepository<IslandQuestClaim, UUID> {

    Optional<IslandQuestClaim> findByIslandIdAndOccurrenceIdAndKind(UUID islandId, UUID occurrenceId, String kind);

    /**
     * 계정 탈퇴 파기 (GROMO-1950, 계정 LLD §4) — 정산 행은 섬 통장 원장의 근거라 남기고 수령한 주민 연결만
     * 끊는다. 수령 명령은 users 배타 잠금부터 잡으므로 탈퇴 TX 와 직렬화되고, 탈퇴 뒤엔 404 로 막힌다.
     */
    @Modifying(flushAutomatically = true)
    @Query("UPDATE IslandQuestClaim c SET c.claimedBy = null WHERE c.claimedBy = :userId")
    int detachClaimer(@Param("userId") UUID userId);
}
