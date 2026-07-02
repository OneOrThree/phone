package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface LeagueArenaRepository extends JpaRepository<LeagueArena, UUID> {

    List<LeagueArena> findByTierConfigAndStatus(LeagueTierConfig tierConfig, LeagueArenaStatus status);

    // 주간 배치용 — 상태별 아레나 전체 조회 (ACTIVE 전체 마감 대상)
    // tierConfig JOIN FETCH 로 배치 루프 내 N+1 쿼리 방지
    @Query("SELECT a FROM LeagueArena a JOIN FETCH a.tierConfig WHERE a.status = :status")
    List<LeagueArena> findByStatus(@Param("status") LeagueArenaStatus status);
}
