package com.oneorthree.phone.quest.repository;

import com.oneorthree.phone.quest.repository.domain.IslandQuestClaim;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface IslandQuestClaimRepository extends JpaRepository<IslandQuestClaim, UUID> {

    Optional<IslandQuestClaim> findByIslandIdAndOccurrenceIdAndKind(UUID islandId, UUID occurrenceId, String kind);

    /**
     * 이 회차에서 개인 몫을 이미 받은 주민들 (GROMO-1991) — 「내가 받았나」와 「누가 받았나」가 같은 질의다.
     * 계정 탈퇴로 끊긴 행({@code claimedBy} null)은 빠진다 — 그 주민은 판정 대상에서도 이미 빠져 있다.
     *
     * <p>조건이 {@code islandId} 부터인 것은 유일 인덱스 {@code uq_island_quest_claim}
     * (island_id, occurrence_id, kind, claimed_by)의 <b>선두 컬럼</b>이기 때문이다 — 회차 × 주민으로 표가
     * 커져도 이 질의가 전체를 훑지 않는다. 회차 id 는 전역 유일이라 섬 조건이 결과를 바꾸지는 않는다.
     */
    @Query("SELECT c.claimedBy FROM IslandQuestClaim c WHERE c.islandId = :islandId "
            + "AND c.occurrenceId = :occurrenceId AND c.kind = :kind AND c.claimedBy IS NOT NULL")
    List<UUID> findClaimerIds(@Param("islandId") UUID islandId, @Param("occurrenceId") UUID occurrenceId,
                              @Param("kind") String kind);

    /**
     * 계정 탈퇴 파기 (GROMO-1950, 계정 LLD §4) — 정산 행은 섬 통장 원장의 근거라 남기고 수령한 주민 연결만
     * 끊는다. 수령 명령은 users 배타 잠금부터 잡으므로 탈퇴 TX 와 직렬화되고, 탈퇴 뒤엔 404 로 막힌다.
     */
    @Modifying(flushAutomatically = true)
    @Query("UPDATE IslandQuestClaim c SET c.claimedBy = null WHERE c.claimedBy = :userId")
    int detachClaimer(@Param("userId") UUID userId);
}
