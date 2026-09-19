package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusSettlement;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.UUID;

/** v0.3 세션 정산 (GROMO-1924). */
public interface FocusSettlementRepository extends JpaRepository<FocusSettlement, UUID> {

    /**
     * 하루 상한 판정 — 이 사용자가 이 섬에서 {@code [from, to)} 에 정산 완료한 물고기 합.
     *
     * <p>잠금이 없어도 되는 이유: 사용자당 진행 세션은 하나라(V58 부분 UNIQUE) 같은 사용자의 finish 둘이
     * 동시에 정산될 수 없다. 이 합에 들어갈 새 행을 만드는 것은 지금 잠긴 그 세션뿐이다.
     *
     * @return 합(없으면 0)
     */
    @Query("SELECT COALESCE(SUM(s.earnedFish), 0) FROM FocusSettlement s, "
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionDetail d "
            + "WHERE d.sessionId = s.sessionId AND d.userId = :userId AND d.islandId = :islandId "
            + "AND s.completedAt >= :from AND s.completedAt < :to")
    long sumEarnedFish(@Param("userId") UUID userId, @Param("islandId") UUID islandId,
                       @Param("from") Instant from, @Param("to") Instant to);
}
