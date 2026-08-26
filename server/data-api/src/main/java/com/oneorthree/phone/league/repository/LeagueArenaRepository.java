package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface LeagueArenaRepository extends JpaRepository<LeagueArena, UUID> {

    boolean existsByStartedAt(Instant startedAt);

    List<LeagueArena> findByStatus(LeagueArenaStatus status);

    List<LeagueArena> findByStatusAndStartedAtBefore(LeagueArenaStatus status, Instant startedAt);
}
