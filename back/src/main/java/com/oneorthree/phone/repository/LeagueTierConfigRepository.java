package com.oneorthree.phone.repository;

import com.oneorthree.phone.domain.LeagueTier;
import com.oneorthree.phone.domain.LeagueTierConfig;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LeagueTierConfigRepository extends JpaRepository<LeagueTierConfig, LeagueTier> {
}
