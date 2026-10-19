package com.oneorthree.phone.appearance.repository;

import com.oneorthree.phone.appearance.repository.domain.SeaFocusTotal;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** 바다 집중 누적 (GROMO-2274) — 쓰는 곳은 {@code SeaFocusRewardService} 하나다. */
public interface SeaFocusTotalRepository extends JpaRepository<SeaFocusTotal, UUID> {

    /**
     * 행이 없을 때만 0 누적으로 만든다. {@code save()} 가 아니라 {@code ON CONFLICT DO NOTHING} 인 이유: 첫 정산 둘이
     * 겹치면 뒤의 {@code INSERT} 가 PK 위반으로 정산 트랜잭션(= 집중 종료) 전체를 되돌린다. 있으면 아무것도 하지 않는다.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = "INSERT INTO sea_focus_totals (user_id, lifetime_seconds, month_key, month_seconds, updated_at) "
            + "VALUES (:userId, 0, :monthKey, 0, :now) ON CONFLICT (user_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId, @Param("monthKey") String monthKey,
                       @Param("now") Instant now);

    /** 가산용 배타 잠금 — 같은 유저의 정산끼리 줄을 세운다. 호출측이 트랜잭션 안에 있어야 한다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT t FROM SeaFocusTotal t WHERE t.userId = :userId")
    Optional<SeaFocusTotal> findForUpdate(@Param("userId") UUID userId);

    /**
     * 계정 탈퇴 파기 (GROMO-2274 × 계정 LLD §4) — 개인 누적 이력이라 남길 이유가 없다. 사용자 행은 익명화만 되고
     * 삭제되지 않아 V117 의 {@code ON DELETE CASCADE} 가 돌지 않는다. 호출측이 users 배타 잠금을 쥔 탈퇴 TX 에서만 부른다.
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM SeaFocusTotal t WHERE t.userId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);
}
