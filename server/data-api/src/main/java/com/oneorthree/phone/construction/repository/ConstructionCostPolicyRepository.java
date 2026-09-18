package com.oneorthree.phone.construction.repository;

import com.oneorthree.phone.construction.repository.domain.ConstructionCostPolicy;
import com.oneorthree.phone.construction.repository.domain.ConstructionCostPolicyId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ConstructionCostPolicyRepository
        extends JpaRepository<ConstructionCostPolicy, ConstructionCostPolicyId> {

    /** 한 revision 의 전 건물 가격표 — 조회·실행 모두 이 스냅샷 한 벌을 쓴다. */
    List<ConstructionCostPolicy> findByRevision(int revision);
}
