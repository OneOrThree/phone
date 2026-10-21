package com.oneorthree.phone.appearance.repository;

import com.oneorthree.phone.appearance.repository.domain.SeaFocusTotal;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.UUID;

/** 옛 바다 집중 누적 (GROMO-2274) — 표가 남아 있는 동안 계정 탈퇴 파기만 한다(GROMO-2301 에서 엔진을 지웠다). */
public interface SeaFocusTotalRepository extends JpaRepository<SeaFocusTotal, UUID> {

    /**
     * 계정 탈퇴 파기 (GROMO-2274 × 계정 LLD §4) — 개인 누적 이력이라 남길 이유가 없다. 사용자 행은 익명화만 되고
     * 삭제되지 않아 V117 의 {@code ON DELETE CASCADE} 가 돌지 않는다. 호출측이 users 배타 잠금을 쥔 탈퇴 TX 에서만 부른다.
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM SeaFocusTotal t WHERE t.userId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);
}
