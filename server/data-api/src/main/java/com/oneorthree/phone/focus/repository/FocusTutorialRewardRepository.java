package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusTutorialReward;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/** 사용자 잠금 아래 영수증을 확인하고 기록한다. */
public interface FocusTutorialRewardRepository extends JpaRepository<FocusTutorialReward, UUID> {
    Optional<FocusTutorialReward> findByUserId(UUID userId);
}
