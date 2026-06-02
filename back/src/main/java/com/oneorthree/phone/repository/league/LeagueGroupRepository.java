package com.oneorthree.phone.repository.league;

import com.oneorthree.phone.domain.league.LeagueGroup;
import com.oneorthree.phone.domain.league.LeagueGroupStatus;
import com.oneorthree.phone.domain.league.LeagueTierConfig;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface LeagueGroupRepository extends JpaRepository<LeagueGroup, Long> {
    List<LeagueGroup> findByTierConfigAndStatus(LeagueTierConfig tierConfig, LeagueGroupStatus status);
}
