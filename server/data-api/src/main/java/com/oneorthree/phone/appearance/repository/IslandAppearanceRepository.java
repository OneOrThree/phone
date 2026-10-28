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

    /**
     * 잠금 없는 버전 조회 — 낡은 expectedVersion 을 값·상품 검증보다 먼저 409 로 돌려보내는
     * 사전 판정용이다. 엔티티가 아니라 스칼라라 영속성 컨텍스트에 남지 않아 뒤따르는
     * {@link #findByIdForUpdate} 가 최신 행을 읽는다. 확정 판정은 잠긴 행이 한다.
     */
    @Query("SELECT a.version FROM IslandAppearance a WHERE a.islandId = :islandId")
    Optional<Long> findVersion(@Param("islandId") UUID islandId);

    /** 첫 writer 접근 때 행을 만든다 — 동시 첫 접근의 UNIQUE 오염 방지. */
    @Modifying
    @Query(value = "INSERT INTO island_appearances (island_id) VALUES (:islandId) "
            + "ON CONFLICT (island_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("islandId") UUID islandId);
}
