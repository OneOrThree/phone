package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.domain.LeagueRankSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 일간 순위 스냅샷 조회/저장 (GROMO-579).
 * 특정 날짜의 아레나 스냅샷을 일괄 조회(멤버별 N+1 금지)해 두 용도로 재사용한다:
 * ① 어제(created_at = 어제) 스냅샷 → 오늘 실시간 순위와 대조해 추월 감지,
 * ② 오늘(created_at = 오늘) 스냅샷 → 존재하면 upsert(값 갱신), 없으면 신규 INSERT.
 */
public interface LeagueRankSnapshotRepository extends JpaRepository<LeagueRankSnapshot, UUID> {

    @Query("SELECT s FROM LeagueRankSnapshot s "
            + "WHERE s.arenaId IN :arenaIds AND s.createdAt = :capturedOn")
    List<LeagueRankSnapshot> findByArenaIdInAndCapturedOn(
            @Param("arenaIds") List<UUID> arenaIds, @Param("capturedOn") LocalDate capturedOn);
}
