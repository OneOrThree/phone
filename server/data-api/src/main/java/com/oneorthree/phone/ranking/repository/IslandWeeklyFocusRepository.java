package com.oneorthree.phone.ranking.repository;

import com.oneorthree.phone.ranking.repository.domain.IslandWeeklyFocus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 주간 섬 랭킹 분자의 read model (GROMO-2343, V130). 트랜잭션 경계는 호출부가 소유한다(규약 §4·§5).
 */
public interface IslandWeeklyFocusRepository extends JpaRepository<IslandWeeklyFocus, IslandWeeklyFocus.Key> {

    /**
     * 그 주의 섬별 집중 초 — {@code FocusSessionDetailRepository.sumIslandActiveSeconds} 와 같은 모양이다.
     * μs 합을 섬마다 한 번만 내리고, 내린 뒤 0초인 섬은 내보내지 않는다(RK-D09).
     */
    @Query(value = "SELECT island_id AS \"islandId\", active_micros / 1000000 AS \"seconds\" "
            + "FROM island_weekly_focus WHERE week_start = :weekStart AND active_micros >= 1000000",
            nativeQuery = true)
    List<IslandSeconds> findSeconds(@Param("weekStart") LocalDate weekStart);

    /** 완료 전이 하나의 그 주 몫을 더한다 — 행이 없으면 만든다. */
    @Modifying
    @Query(value = "INSERT INTO island_weekly_focus (week_start, island_id, active_micros, updated_at) "
            + "VALUES (:weekStart, :islandId, :micros, :now) "
            + "ON CONFLICT (week_start, island_id) DO UPDATE SET "
            + "active_micros = island_weekly_focus.active_micros + EXCLUDED.active_micros, "
            + "updated_at = EXCLUDED.updated_at", nativeQuery = true)
    void add(@Param("weekStart") LocalDate weekStart, @Param("islandId") UUID islandId,
             @Param("micros") long micros, @Param("now") Instant now);

    /**
     * 재계산 1/3 — 진행 중인 가산(행 쓰기 잠금)과 직렬화한다. SHARE ROW EXCLUSIVE 는 가산의 ROW EXCLUSIVE 와
     * 충돌하므로, 이미 가산한 트랜잭션은 커밋을 기다렸다가 아래 집계에 보이고, 아직 가산하지 않은 트랜잭션은
     * 재계산이 커밋된 «뒤에» 더한다. READ COMMITTED 라 집계 문장이 잠금 뒤 새 스냅샷을 잡는다.
     */
    @Modifying
    @Query(value = "LOCK TABLE island_weekly_focus IN SHARE ROW EXCLUSIVE MODE", nativeQuery = true)
    void lockForRecompute();

    /** 재계산 2/3 — 그 주를 비운다. */
    @Modifying
    @Query(value = "DELETE FROM island_weekly_focus WHERE week_start = :weekStart", nativeQuery = true)
    int clear(@Param("weekStart") LocalDate weekStart);

    /**
     * 재계산 3/3 — 정본({@code focus_session_details} × {@code focus_session_intervals})을 원본 집계와
     * <b>같은 술어</b>로 접어 그 주를 다시 채운다.
     */
    @Modifying
    @Query(value = "INSERT INTO island_weekly_focus (week_start, island_id, active_micros, updated_at) "
            + "SELECT :weekStart, d.island_id, CAST(SUM(EXTRACT(EPOCH FROM ("
            + "LEAST(i.ended_at, CAST(:windowEnd AS timestamptz)) "
            + "- GREATEST(i.started_at, CAST(:windowStart AS timestamptz)))) * 1000000) AS bigint), :now "
            + "FROM focus_session_details d JOIN focus_session_intervals i ON i.session_id = d.session_id "
            + "WHERE d.lifecycle = 'COMPLETED' AND d.kind = 'ISLAND' AND i.kind = 'ACTIVE' AND i.ended_at IS NOT NULL "
            + "AND i.started_at < CAST(:windowEnd AS timestamptz) "
            + "AND i.ended_at > CAST(:windowStart AS timestamptz) "
            + "GROUP BY d.island_id", nativeQuery = true)
    int fill(@Param("weekStart") LocalDate weekStart, @Param("windowStart") Instant windowStart,
             @Param("windowEnd") Instant windowEnd, @Param("now") Instant now);

    /** {@link #findSeconds} 한 행. */
    interface IslandSeconds {

        UUID getIslandId();

        long getSeconds();
    }
}
