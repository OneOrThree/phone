package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface LeagueArenaRepository extends JpaRepository<LeagueArena, UUID> {

    List<LeagueArena> findByTierConfigAndStatus(LeagueTierConfig tierConfig, LeagueArenaStatus status);
}
