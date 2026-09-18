package com.oneorthree.phone.construction.repository;

import com.oneorthree.phone.construction.repository.domain.IslandFacility;
import com.oneorthree.phone.construction.repository.domain.IslandFacilityId;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface IslandFacilityRepository extends JpaRepository<IslandFacility, IslandFacilityId> {

    List<IslandFacility> findByIslandId(UUID islandId);

    /**
     * 건설 명령이 시설 행을 잠그는 경로 — 없으면 empty(아직 짓지 않은 시설).
     * 지갑 잠금보다 먼저 잡는다(LLD §4).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT f FROM IslandFacility f WHERE f.islandId = :islandId AND f.buildingId = :buildingId")
    Optional<IslandFacility> findByIdForUpdate(@Param("islandId") UUID islandId,
                                             @Param("buildingId") String buildingId);

    /** 이 시설이 완공됐는가 — 전망대·우체통 게이트의 유일한 판정 근거다. */
    @Query("SELECT COUNT(f) > 0 FROM IslandFacility f WHERE f.islandId = :islandId "
            + "AND f.buildingId = :buildingId AND f.status = 'COMPLETED'")
    boolean existsCompleted(@Param("islandId") UUID islandId, @Param("buildingId") String buildingId);

    /** 공사 중인 시설이 하나라도 있는가 — BUILDING 동안 새 목표 선택을 막는다. */
    @Query("SELECT COUNT(f) > 0 FROM IslandFacility f WHERE f.islandId = :islandId "
            + "AND f.status = 'BUILDING'")
    boolean existsBuildingInProgress(@Param("islandId") UUID islandId);

    /** 공사 시간이 지난 BUILDING 행 — 완공 스윕이 훑는 대상이다(부분 인덱스와 짝). */
    @Query("SELECT f FROM IslandFacility f WHERE f.status = 'BUILDING' AND f.completesAt <= :now "
            + "ORDER BY f.completesAt")
    List<IslandFacility> findDueForCompletion(@Param("now") Instant now);

    /** 완공 스윕이 잠그는 단일 행. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT f FROM IslandFacility f WHERE f.islandId = :islandId AND f.buildingId = :buildingId")
    Optional<IslandFacility> findByIdForCompletionUpdate(@Param("islandId") UUID islandId,
                                                       @Param("buildingId") String buildingId);

    /** 유저가 활성 주민으로 속한 섬 중 우체통 완공 섬이 있는가 — 편지 게이트 판정. */
    @Query("SELECT COUNT(f) > 0 FROM IslandFacility f WHERE f.buildingId = :buildingId "
            + "AND f.status = 'COMPLETED' AND f.islandId IN :islandIds")
    boolean existsCompletedInAny(@Param("buildingId") String buildingId,
                                 @Param("islandIds") List<UUID> islandIds);
}
