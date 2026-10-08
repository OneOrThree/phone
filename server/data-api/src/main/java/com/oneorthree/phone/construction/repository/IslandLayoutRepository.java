package com.oneorthree.phone.construction.repository;

import com.oneorthree.phone.construction.repository.domain.IslandLayout;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface IslandLayoutRepository extends JpaRepository<IslandLayout, UUID> {

    /** 완공 revision 증가 전용 배타 잠금 — <b>반드시 트랜잭션 안에서</b>. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT l FROM IslandLayout l WHERE l.islandId = :islandId")
    Optional<IslandLayout> findByIdForUpdate(@Param("islandId") UUID islandId);

    /**
     * 행이 없는 섬의 첫 접근 때 기본 템플릿으로 만든다(백필 없음). 동시 첫 조회는
     * {@code IslandConstructionStateRepository#insertIfAbsent} 와 같은 이유로 {@code ON CONFLICT DO NOTHING}
     * — UNIQUE 위반으로 트랜잭션을 오염시키지 않고, 진 쪽은 이긴 쪽의 행을 다시 읽는다.
     */
    @Modifying
    @Query(value = "INSERT INTO island_layouts (island_id, layout_revision, layout, updated_at) "
            + "VALUES (:islandId, 1, CAST(:layout AS jsonb), now()) "
            + "ON CONFLICT (island_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("islandId") UUID islandId, @Param("layout") String layout);
}
