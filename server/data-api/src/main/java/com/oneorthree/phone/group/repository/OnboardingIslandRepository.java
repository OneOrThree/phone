package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.OnboardingIsland;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

/** 사용자 배타 잠금 안에서만 생성·확정한다. 사용자당 미정착 목적지는 하나다. */
public interface OnboardingIslandRepository extends JpaRepository<OnboardingIsland, UUID> {
    Optional<OnboardingIsland> findByIslandId(UUID islandId);

    boolean existsByIslandId(UUID islandId);

    @Query("SELECT r FROM OnboardingIsland r WHERE r.userId = :userId")
    Optional<OnboardingIsland> findPendingForUser(@Param("userId") UUID userId);

    /** 탈퇴 시 아직 주민 없는 비공개 섬도 닫아 개인 목적지가 남지 않게 한다. */
    @Modifying
    @Query(value = "UPDATE groups SET status = 'ENDED', deleted_at = now() "
            + "WHERE id IN (SELECT island_id FROM onboarding_islands WHERE user_id = :userId)", nativeQuery = true)
    int closePendingOfUser(@Param("userId") UUID userId);

    @Modifying
    @Query("DELETE FROM OnboardingIsland r WHERE r.userId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);
}
