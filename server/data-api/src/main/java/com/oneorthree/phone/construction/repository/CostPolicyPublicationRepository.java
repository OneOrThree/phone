package com.oneorthree.phone.construction.repository;

import com.oneorthree.phone.construction.repository.domain.CostPolicyPublication;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;

public interface CostPolicyPublicationRepository extends JpaRepository<CostPolicyPublication, Boolean> {

    /**
     * 현재 publication 포인터를 배타 잠금으로 읽는다 — POST 건설 명령이
     * {@code expectedCostPolicyVersion} 검증과 가격 확정을 같은 잠금 아래에서 하게 한다
     * (LLD §2 「가격 publication과 명령이 같은 정책 잠금 경계를 사용」).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM CostPolicyPublication p WHERE p.singleton = true")
    Optional<CostPolicyPublication> findCurrentForUpdate();
}
