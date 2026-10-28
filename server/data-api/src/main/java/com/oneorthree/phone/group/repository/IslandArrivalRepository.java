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

/** 섬 도착 기록 (GROMO-2260, V112). */
public interface IslandArrivalRepository extends JpaRepository<IslandArrival, IslandArrival.Key> {

    /**
     * 도착을 기록한다 — 처음이면 first=last=now 로 넣고, 이미 있으면 last 만 갱신한다. {@code asMember} 면
     * {@code member_arrived_at} 도 덮는다(주민으로서 마지막 도착, GROMO-2302) — 방문자 도착은 그 값을 건드리지 않는다.
     *
     * <p>{@code member_arrived_at} 은 {@code GREATEST(now, 현 멤버십 시작)} 이다. 가입과 같은 트랜잭션의 도착(섬 생성·
     * 방문 중 가입·초대·1.x)은 {@code now} 를 가입 행 INSERT 보다 먼저 읽는다 — 가입 행의 {@code created_at} 은
     * {@code @CreationTimestamp} 라 flush 때 찍혀 {@code now} 보다 늦을 수 있고, 그러면 다음 도착이 «현 가입 이전» 값을
     * 보고 거짓 첫 도착을 낸다. 네이티브 쿼리 앞의 auto-flush 가 가입 행을 먼저 넣으므로 서브쿼리가 그 시각을 본다.
     * 모든 주민 writer 가 이 한 곳을 지나므로 여기서 보장한다.
     *
     * <p>{@code ON CONFLICT} 인 이유: 같은 사람의 두 도착이 겹쳐도 «있으면 갱신» 이 원자적이어야 한다 —
     * 읽고 나서 쓰면 둘 다 «없음» 을 보고 두 번째 INSERT 가 PK 위반이 된다.
     */
    @Modifying
    @Query(value = "INSERT INTO island_arrivals (user_id, island_id, first_arrived_at, last_arrived_at, "
            + "member_arrived_at) VALUES (:userId, :islandId, :now, :now, "
            + "CASE WHEN :asMember THEN GREATEST(CAST(:now AS timestamptz), "
            + "(SELECT COALESCE(m.rejoined_at, m.created_at) FROM group_members m "
            + "WHERE m.user_id = :userId AND m.group_id = :islandId AND m.is_left = false)) END) "
            + "ON CONFLICT (user_id, island_id) DO UPDATE SET last_arrived_at = EXCLUDED.last_arrived_at, "
            + "member_arrived_at = COALESCE(EXCLUDED.member_arrived_at, island_arrivals.member_arrived_at)",
            nativeQuery = true)
    int recordArrival(@Param("userId") UUID userId, @Param("islandId") UUID islandId, @Param("now") Instant now,
                      @Param("asMember") boolean asMember);

    boolean existsByUserIdAndIslandId(UUID userId, UUID islandId);

    /**
     * 탈퇴자의 도착 기록을 전부 지운다 (GROMO-2260). 그 사람의 이동·방문 이력일 뿐 남의 판정 근거가 아니라
     * 남길 이유가 없다 — 화면 시간 관측·스냅샷 파기와 같은 결이다.
     *
     * @param userId 탈퇴하는 유저
     * @return 지운 행 수
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM IslandArrival a WHERE a.userId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);

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
