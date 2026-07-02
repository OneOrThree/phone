package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface LeagueArenaRepository extends JpaRepository<LeagueArena, UUID> {

    List<LeagueArena> findByTierConfigAndStatus(LeagueTierConfig tierConfig, LeagueArenaStatus status);

    // 주간 배치용 — 상태별 아레나 전체 조회 (ACTIVE 전체 마감 대상)
    List<LeagueArena> findByStatus(LeagueArenaStatus status);
}
