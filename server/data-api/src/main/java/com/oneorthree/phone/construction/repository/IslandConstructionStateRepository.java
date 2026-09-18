package com.oneorthree.phone.construction.repository;

import com.oneorthree.phone.construction.repository.domain.IslandConstructionState;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface IslandConstructionStateRepository
        extends JpaRepository<IslandConstructionState, UUID> {

    /**
     * 목표 변경·건설 확정 경로 전용 배타 잠금 — <b>반드시 트랜잭션 안에서</b>.
     * 시설 잠금보다 먼저 잡는다(LLD §4 의 섬/시설 구간).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM IslandConstructionState s WHERE s.islandId = :islandId")
    Optional<IslandConstructionState> findByIdForUpdate(@Param("islandId") UUID islandId);

    /**
     * V62 이전에 생긴 섬은 상태 행이 없을 수 있으므로 첫 접근 때 만든다.
     * {@code aggregate_versions.insertIfAbsent} 와 같은 이유로 {@code ON CONFLICT DO NOTHING} —
     * 동시 첫 접근이 UNIQUE 위반으로 트랜잭션을 오염시키지 않는다.
     */
    @Modifying
    @Query(value = "INSERT INTO island_construction_states (island_id) VALUES (:islandId) "
            + "ON CONFLICT (island_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("islandId") UUID islandId);
}
