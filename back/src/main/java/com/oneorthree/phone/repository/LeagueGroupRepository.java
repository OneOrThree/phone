package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.LeagueGroup;
import com.oneorthree.phone.domain.LeagueGroupStatus;
import com.oneorthree.phone.domain.LeagueTierConfig;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface LeagueGroupRepository extends JpaRepository<LeagueGroup, Long> {
    List<LeagueGroup> findByTierConfigAndStatus(LeagueTierConfig tierConfig, LeagueGroupStatus status);
}
