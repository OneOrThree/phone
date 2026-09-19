package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusRewardPolicy;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

/** 집중 보상 정책 revision (GROMO-1924). 행은 추가만 한다 — {@link FocusRewardPolicy} 참조. */
public interface FocusRewardPolicyRepository extends JpaRepository<FocusRewardPolicy, Integer> {

    /** @return 현재 정책(가장 큰 revision). 하나도 없으면 빈 값 — 그때 start 는 열리지 않는다 */
    Optional<FocusRewardPolicy> findFirstByOrderByRevisionDesc();
}
