package com.oneorthree.phone.appearance.repository;

import com.oneorthree.phone.appearance.repository.domain.CustomizationRewardPolicy;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

/** 꾸미기 보상 정책 (GROMO-2301) — 읽기 전용. */
public interface CustomizationRewardPolicyRepository extends JpaRepository<CustomizationRewardPolicy, Integer> {

    /** 지금 정책 — 가장 큰 revision. */
    Optional<CustomizationRewardPolicy> findTopByOrderByRevisionDesc();
}
