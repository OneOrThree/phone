package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusSettlement;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

/**
 * v0.3 세션 정산 (GROMO-1924). finish 가 세션당 한 행을 남긴다.
 *
 * <p>GROMO-1990 부터 이 행은 <b>지급의 근거가 아니라 확정 기록</b>이다 — 물고기는 매분 적립 틱이
 * 이미 넣었고({@code focus_reward_accruals}), finish 는 그 합을 옮겨 적을 뿐이다. 하루 상한 합산도
 * {@link FocusRewardAccrualRepository#sumEarnedFishOnDay} 로 옮겼다: 정산 행의 {@code completedAt} 을
 * 축으로 쓰면 진행 중 적립분이 상한에 잡히지 않는다.
 */
public interface FocusSettlementRepository extends JpaRepository<FocusSettlement, UUID> {
}
