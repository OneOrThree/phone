package com.oneorthree.phone.construction.repository;

import com.oneorthree.phone.construction.repository.domain.IslandConstructionContribution;
import com.oneorthree.phone.construction.repository.domain.IslandConstructionContributionId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface IslandConstructionContributionRepository
        extends JpaRepository<IslandConstructionContribution, IslandConstructionContributionId> {

    /** 한 epoch 아래 모인 기여 전부 — 「각자 몫 n빵」판정이 주민별로 대조하는 집합이다. */
    List<IslandConstructionContribution> findByIslandIdAndEpoch(UUID islandId, long epoch);

    /**
     * 같은 epoch 안에서는 사용자당 한 행에 누적한다 — {@code ON CONFLICT} 로 upsert 해
     * 동시 기입이 UNIQUE 위반으로 죽지 않게 한다.
     *
     * <p>{@code DO UPDATE} 의 WHERE 가 더해질 합이 {@code integer} 상한을 넘을 때 갱신을 건너뛴다 —
     * 없으면 PostgreSQL 이 {@code integer out of range}(22003)로 500 을 내고, 있으면 조용한
     * wrap 도 500 도 아닌 「0행 갱신」이 돼 호출측이 도메인 거절로 옮길 수 있다.
     *
     * @return 반영된 행 수 — 0 이면 누적 상한 초과로 거절된 것이다
     */
    @Modifying
    @Query(value = "INSERT INTO island_construction_contributions "
            + "(island_id, epoch, user_id, amount, updated_at) "
            + "VALUES (:islandId, :epoch, :userId, :amount, :now) "
            + "ON CONFLICT (island_id, epoch, user_id) "
            + "DO UPDATE SET amount = island_construction_contributions.amount + EXCLUDED.amount, "
            + "updated_at = EXCLUDED.updated_at "
            + "WHERE island_construction_contributions.amount <= 2147483647 - EXCLUDED.amount",
            nativeQuery = true)
    int accumulate(@Param("islandId") UUID islandId, @Param("epoch") long epoch,
                   @Param("userId") UUID userId, @Param("amount") int amount,
                   @Param("now") Instant now);
}
