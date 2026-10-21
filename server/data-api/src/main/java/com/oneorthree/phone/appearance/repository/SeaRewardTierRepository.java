package com.oneorthree.phone.appearance.repository;

import com.oneorthree.phone.appearance.repository.domain.SeaRewardTier;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

/** 바다 보상 단계표 (GROMO-2274) — 읽기 전용이다. 행은 운영이 SQL 로 넣는다. */
public interface SeaRewardTierRepository extends JpaRepository<SeaRewardTier, Long> {

    /**
     * 주어진 세트들의 단계 전부 — 기준 분 오름차순, 같은 분이면 세트 키·id 순이라 지급·표시 순서가 결정적이다.
     * 세트당 행이 수십 개를 넘지 않는 운영 카탈로그라 한 번에 읽는다.
     */
    @Query("SELECT t FROM SeaRewardTier t WHERE t.setKey IN :setKeys "
            + "ORDER BY t.thresholdMinutes, t.setKey, t.id")
    List<SeaRewardTier> findBySetKeys(@Param("setKeys") Collection<String> setKeys);
}
