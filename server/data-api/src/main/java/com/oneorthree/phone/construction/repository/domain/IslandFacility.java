package com.oneorthree.phone.construction.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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
import java.util.UUID;

/**
 * 섬 시설 하나 — (섬, buildingId) 유일(LLD §4). 완료한 시설의 재건설은 이 유일성이 막는다
 * (정책 C06: 새 키면 409 STATE_CONFLICT, 같은 키면 원 성공 재생 — 멱등이 먼저 잡는다).
 *
 * <p>{@code cost}·{@code costRevision} 은 건설이 확정될 때 함께 저장하는 동의 스냅샷이다 —
 * 이후 가격 정책이 바뀌어도 이 행의 차감 근거는 변하지 않는다.
 */
@Entity
@Table(name = "island_facilities")
@IdClass(IslandFacilityId.class)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class IslandFacility {

    @Id
    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    @Id
    @Column(name = "building_id", nullable = false, length = 30)
    private String buildingId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private FacilityStatus status;

    @Column(nullable = false)
    private int cost;

    @Column(name = "cost_revision", nullable = false)
    private int costRevision;

    /** 건설을 확정한 주민 — 스케줄러의 완공 island.updated 봉투가 주체로 쓴다. */
    @Column(name = "started_by")
    private UUID startedBy;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "completes_at")
    private Instant completesAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @CreationTimestamp
    @Column(name = "created_at")
    private Instant createdAt;

    /** 건설 확정 — BUILDING 행을 만든다. */
    public static IslandFacility started(UUID islandId, String buildingId, int cost, int costRevision,
                                         UUID startedBy, Instant startedAt, Instant completesAt) {
        return IslandFacility.builder()
                .islandId(islandId)
                .buildingId(buildingId)
                .status(FacilityStatus.BUILDING)
                .cost(cost)
                .costRevision(costRevision)
                .startedBy(startedBy)
                .startedAt(startedAt)
                .completesAt(completesAt)
                .build();
    }

    /** 공사 완료 — 스케줄러가 completes_at 경과를 확인한 뒤 부른다. */
    public void complete(Instant completedAt) {
        this.status = FacilityStatus.COMPLETED;
        this.completedAt = completedAt;
    }
}
