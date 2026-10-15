package com.oneorthree.phone.construction.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * 현재 비용 정책 포인터 (정책 C10) — 항상 행 하나뿐인 싱글톤이다.
 * POST 건설 명령은 이 행을 잠근 채 {@code expectedCostPolicyVersion} 과 비교한다 —
 * 검증 직후 가격만 교체되는 경합을 막는다(LLD §2).
 */
@Entity
@Table(name = "construction_cost_policy_publication")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class CostPolicyPublication {

    @Id
    @Column(nullable = false)
    private boolean singleton;

    @Column(nullable = false)
    private int revision;

    @Column(name = "published_at", nullable = false)
    private Instant publishedAt;
}
