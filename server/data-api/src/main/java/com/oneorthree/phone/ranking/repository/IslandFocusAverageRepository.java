package com.oneorthree.phone.ranking.repository;

import com.oneorthree.phone.ranking.repository.domain.IslandFocusAverage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/** 섬별 7일 평균 일 스냅샷 (GROMO-2257, V109). */
public interface IslandFocusAverageRepository
        extends JpaRepository<IslandFocusAverage, IslandFocusAverage.Key> {

    /**
     * 그날의 스냅샷을 <b>한 문장으로</b> 적는다 — 이미 적힌 (날짜, 섬) 행은 건드리지 않는다.
     *
     * <p>세 배열은 <b>같은 길이·같은 순서</b>다(i 번째가 한 섬의 한 행). {@code unnest} 가 그것을 행으로 펼친다.
     * 평균 배열의 null 은 «주민 0명» 이다 — 0 과 섞지 않는다.
     *
     * <p>{@code ON CONFLICT DO NOTHING} 이라 <b>재실행해도 첫 값이 남는다</b>. 이것이 «같은 날 2회 조회 = 같은 값»
     * 의 멱등 가드다 — 분산 락은 중복 작업을 줄일 뿐 정합성의 유일한 방어선이 아니다.
     *
     * <p>트랜잭션 경계는 여기서 열지 않는다(규약 §4·§5) — 호출부인 {@code IslandFocusAverageSnapshotService} 가
     * 소유한다.
     *
     * @param snapshotDate  배치가 도는 날의 KST 날짜
     * @param islandIds     섬 id
     * @param memberCounts  섬별 현재 주민 수(0 이상)
     * @param averages      섬별 하루 평균 집중(분). 주민 0명이면 null
     * @return 새로 적힌 행 수. 이미 적힌 (날짜, 섬)은 세지 않으므로 재실행이면 0 이다
     */
    @Modifying
    @Query(value = "INSERT INTO island_focus_averages "
            + "(snapshot_date, island_id, member_count, avg_minutes_per_member_day) "
            + "SELECT CAST(:snapshotDate AS date), r.island_id, r.member_count, r.avg_minutes "
            + "FROM unnest(CAST(:islandIds AS uuid[]), CAST(:memberCounts AS integer[]), "
            + "CAST(:averages AS integer[])) AS r(island_id, member_count, avg_minutes) "
            + "ON CONFLICT (snapshot_date, island_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("snapshotDate") LocalDate snapshotDate,
                       @Param("islandIds") UUID[] islandIds,
                       @Param("memberCounts") Integer[] memberCounts,
                       @Param("averages") Integer[] averages);

    /**
     * 섬마다 <b>가장 최근 snapshot_date 의 행 하나</b> — 읽기 쪽(망원경 목록)의 유일한 질의다.
     * {@code DISTINCT ON} 이 섬당 첫 행만 남기고, {@code (island_id, snapshot_date DESC)} 인덱스(V109)가 받친다.
     *
     * <p>«가장 최근 <b>값이 있는</b> 행» 이 아니다 — 최근 행의 평균이 null(주민 0명)이면 그것이 답이다. 옛 값으로
     * 되돌아가지 않는다.
     *
     * @param islandIds 조회할 섬 id. 비어 있으면 SQL 이 깨지므로 호출부가 걸러야 한다
     * @return 행이 있는 섬만 1건씩(요청의 부분집합). 한 번도 집계되지 않은 섬은 빠진다
     */
    @Query(value = "SELECT DISTINCT ON (a.island_id) a.* FROM island_focus_averages a "
            + "WHERE a.island_id IN (:islandIds) "
            + "ORDER BY a.island_id, a.snapshot_date DESC", nativeQuery = true)
    List<IslandFocusAverage> findLatestByIslandIds(@Param("islandIds") Collection<UUID> islandIds);
}
