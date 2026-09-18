package com.oneorthree.phone.appearance.repository;

import com.oneorthree.phone.appearance.repository.domain.IslandAppearance;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface IslandAppearanceRepository extends JpaRepository<IslandAppearance, UUID> {

    /**
     * 테마 PATCH·시설 완공 writer 공용 배타 잠금 — <b>반드시 트랜잭션 안에서</b>.
     * 두 writer 가 이 행에서 직렬화되므로 version 순서가 곧 커밋 순서다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT a FROM IslandAppearance a WHERE a.islandId = :islandId")
    Optional<IslandAppearance> findByIdForUpdate(@Param("islandId") UUID islandId);

    /** 첫 writer 접근 때 행을 만든다 — 동시 첫 접근의 UNIQUE 오염 방지. */
    @Modifying
    @Query(value = "INSERT INTO island_appearances (island_id) VALUES (:islandId) "
            + "ON CONFLICT (island_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("islandId") UUID islandId);
}
