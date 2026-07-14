package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.domain.LeagueWeeklyResultType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LeagueWeeklyResultRepository extends JpaRepository<LeagueWeeklyResult, UUID> {

    Optional<LeagueWeeklyResult> findTopByUserIdOrderByCreatedAtDesc(UUID userId);

    List<LeagueWeeklyResult> findByWeekStartAtAndResultIn(
            Instant weekStartAt, Collection<LeagueWeeklyResultType> results);
}
