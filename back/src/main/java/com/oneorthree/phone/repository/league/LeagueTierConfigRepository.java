package com.oneorthree.phone.repository.league;

import com.oneorthree.phone.domain.league.LeagueTier;
import com.oneorthree.phone.domain.league.LeagueTierConfig;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LeagueTierConfigRepository extends JpaRepository<LeagueTierConfig, LeagueTier> {
}
