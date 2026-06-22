package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.domain.LeagueGroup;
import com.oneorthree.phone.league.domain.LeagueGroupStatus;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface LeagueGroupRepository extends JpaRepository<LeagueGroup, UUID> {

    List<LeagueGroup> findByTierConfigAndStatus(LeagueTierConfig tierConfig, LeagueGroupStatus status);
}
