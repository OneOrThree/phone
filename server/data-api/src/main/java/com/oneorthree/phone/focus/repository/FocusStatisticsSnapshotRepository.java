package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusStatisticsSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** 회관 집중 기록 조회 스냅샷 (GROMO-1769). 조회는 늘 소유자와 함께 — 남의 스냅샷 id 로는 읽지 못한다. */
public interface FocusStatisticsSnapshotRepository extends JpaRepository<FocusStatisticsSnapshot, UUID> {

    Optional<FocusStatisticsSnapshot> findByIdAndUserIdAndExpiresAtAfter(UUID id, UUID userId, Instant now);

    /** 만료 정리 — 새 스냅샷을 만들 때 그 사용자 몫만 지운다. */
    @Modifying
    @Query("DELETE FROM FocusStatisticsSnapshot s WHERE s.userId = :userId AND s.expiresAt <= :now")
    int deleteExpiredOf(@Param("userId") UUID userId, @Param("now") Instant now);

    /** 탈퇴 — 본인 기록 사본이라 같은 TX 에서 지운다(LLD §3 탈퇴 경계). */
    @Modifying
    @Query("DELETE FROM FocusStatisticsSnapshot s WHERE s.userId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);
}
