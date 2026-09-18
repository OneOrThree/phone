package com.oneorthree.phone.construction.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

/**
 * 불변 건설 비용 정책의 한 행 (정책 C10) — (revision, buildingId) 당 가격·공사 시간 하나.
 * 한 번 등록한 revision 은 바꾸지 않는다. 현재 적용 revision 은
 * {@code construction_cost_policy_publication} 포인터가 가리킨다.
 */
@Entity
@Table(name = "construction_cost_policies")
@IdClass(ConstructionCostPolicyId.class)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class ConstructionCostPolicy {

    @Id
    @Column(nullable = false)
    private int revision;

    @Id
    @Column(name = "building_id", nullable = false, length = 30)
    private String buildingId;

    @Column(nullable = false)
    private int cost;

    @Column(name = "build_seconds", nullable = false)
    private int buildSeconds;

    @CreationTimestamp
    @Column(name = "created_at")
    private Instant createdAt;
}
