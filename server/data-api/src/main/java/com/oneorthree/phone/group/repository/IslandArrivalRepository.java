package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.IslandArrival;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 섬 도착 기록 (GROMO-2260, V107). */
public interface IslandArrivalRepository extends JpaRepository<IslandArrival, IslandArrival.Key> {

    /**
     * 도착을 기록한다 — 처음이면 first=last=now 로 넣고, 이미 있으면 last 만 갱신한다.
     *
     * <p>{@code ON CONFLICT} 인 이유: 같은 사람의 두 도착이 겹쳐도 «있으면 갱신» 이 원자적이어야 한다 —
     * 읽고 나서 쓰면 둘 다 «없음» 을 보고 두 번째 INSERT 가 PK 위반이 된다.
     */
    @Modifying
    @Query(value = "INSERT INTO island_arrivals (user_id, island_id, first_arrived_at, last_arrived_at) "
            + "VALUES (:userId, :islandId, :now, :now) "
            + "ON CONFLICT (user_id, island_id) DO UPDATE SET last_arrived_at = EXCLUDED.last_arrived_at",
            nativeQuery = true)
    int recordArrival(@Param("userId") UUID userId, @Param("islandId") UUID islandId, @Param("now") Instant now);

    boolean existsByUserIdAndIslandId(UUID userId, UUID islandId);

    /** 후보 중 도착 기록이 있는 섬 — 목록의 {@code arrivedBefore} 를 한 번에 채운다. 빈 후보는 호출자가 거른다. */
    @Query("SELECT a.islandId FROM IslandArrival a WHERE a.userId = :userId AND a.islandId IN :islandIds")
    List<UUID> findArrivedIslandIdsAmong(@Param("userId") UUID userId,
                                         @Param("islandIds") Collection<UUID> islandIds);

    /**
     * 후보 중 가장 최근에 머문 섬 — 나가기·강퇴 뒤 다음 위치 규칙이다. 같은 시각이면 id 로 고정한다.
     * 빈 후보는 호출자가 거른다.
     */
    @Query(value = "SELECT island_id FROM island_arrivals WHERE user_id = :userId AND island_id IN (:islandIds) "
            + "ORDER BY last_arrived_at DESC, island_id LIMIT 1", nativeQuery = true)
    Optional<UUID> findLatestArrivedIslandIdAmong(@Param("userId") UUID userId,
                                                  @Param("islandIds") Collection<UUID> islandIds);
}
