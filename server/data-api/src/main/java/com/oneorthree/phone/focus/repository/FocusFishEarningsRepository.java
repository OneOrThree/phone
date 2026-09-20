package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusRewardAccrual;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 섬별 주민 누적 획득 물고기 (GROMO-1895, 회관 기록 LLD §7) — 적립 원장 {@code focus_reward_accruals} 의
 * 읽기 전용 합산이다.
 *
 * <p>획득의 정본은 <b>적립 원장</b>이다(GROMO-1990 에서 세션당 1행인 {@code focus_settlements} 에서 옮겼다):
 * 보상이 종료 정산이 아니라 매분 적립으로 바뀌어, 진행 중인 세션도 이미 획득한 몫이 있고 강퇴·포기로
 * 정산 행이 끝내 생기지 않는 세션도 적립한 몫은 남는다. 정산 행만 세면 그 둘이 통째로 빠진다.
 * 섬 통장 잔액이나 목표 epoch 기여({@code island_construction_contributions})는 지출·목표 변경으로 줄거나
 * 잘리므로 「누적 획득」이 아니다. 섬 귀속은 세션 상세의 {@code islandId} 로 가른다.
 */
public interface FocusFishEarningsRepository extends Repository<FocusRewardAccrual, UUID> {

    /** 주어진 사용자들이 이 섬에서 적립한 물고기 합 — 적립이 없는 사용자는 결과에 없다. */
    @Query("SELECT d.userId AS userId, SUM(a.earnedFish) AS earnedFish FROM FocusRewardAccrual a, "
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionDetail d "
            + "WHERE d.sessionId = a.sessionId AND d.islandId = :islandId AND d.userId IN :userIds "
            + "GROUP BY d.userId")
    List<UserEarnings> sumEarnedFishByUser(@Param("islandId") UUID islandId,
                                           @Param("userIds") Collection<UUID> userIds);

    /** 사용자별 합 투영. */
    interface UserEarnings {

        UUID getUserId();

        Long getEarnedFish();
    }
}
