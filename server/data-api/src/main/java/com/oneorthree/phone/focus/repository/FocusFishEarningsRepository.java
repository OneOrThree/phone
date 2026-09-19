package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusSettlement;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 섬별 주민 누적 획득 물고기 (GROMO-1895, 회관 기록 LLD §7) — 정산 원장 {@code focus_settlements} 의 읽기 전용 합산.
 *
 * <p>획득의 정본은 세션당 정산 행의 {@code earnedFish}(E=P+C)다. 섬 통장 잔액이나 목표 epoch 기여
 * ({@code island_construction_contributions})는 지출·목표 변경으로 줄거나 잘리므로 「누적 획득」이 아니다.
 * 섬 귀속은 세션 상세의 {@code islandId} 로 가른다 — 하루 상한 합산(GROMO-1924)과 같은 조인이다.
 */
public interface FocusFishEarningsRepository extends Repository<FocusSettlement, UUID> {

    /** 주어진 사용자들이 이 섬에서 정산받은 물고기 합 — 정산 행이 없는 사용자는 결과에 없다. */
    @Query("SELECT d.userId AS userId, SUM(s.earnedFish) AS earnedFish FROM FocusSettlement s, "
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionDetail d "
            + "WHERE d.sessionId = s.sessionId AND d.islandId = :islandId AND d.userId IN :userIds "
            + "GROUP BY d.userId")
    List<UserEarnings> sumEarnedFishByUser(@Param("islandId") UUID islandId,
                                           @Param("userIds") Collection<UUID> userIds);

    /** 사용자별 합 투영. */
    interface UserEarnings {

        UUID getUserId();

        Long getEarnedFish();
    }
}
