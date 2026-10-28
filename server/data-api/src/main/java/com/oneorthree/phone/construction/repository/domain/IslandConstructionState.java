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
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 섬의 건설 목표 (정책 C03) — 목표 선택은 차감이 없는 순수 선택이라 지갑과 다른 행에 둔다.
 *
 * <p>{@code targetEpoch} 는 목표가 바뀔 때마다 +1 된다. 「각자 몫 n빵」은 목표를 고른 뒤부터
 * 모은 물고기로 판단하므로(정책 P-D04, 기획 정본 「각자 몫은 목표를 고른 뒤부터 모은 물고기로
 * 판단한다」) 주민별 기여는 이 epoch 으로 잘라 합산한다.
 */
@Entity
@Table(name = "island_construction_states")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class IslandConstructionState {

    @Id
    @Column(name = "island_id")
    private UUID islandId;

    @Column(name = "target_building_id", length = 30)
    private String targetBuildingId;

    @Column(name = "target_epoch", nullable = false)
    @Builder.Default
    private long targetEpoch = 0;

    @CreationTimestamp
    @Column(name = "created_at")
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;

    /** 새 섬의 빈 상태 — 목표 없음, epoch 0. */
    public static IslandConstructionState empty(UUID islandId) {
        return IslandConstructionState.builder().islandId(islandId).build();
    }

    /**
     * 목표를 바꾼다 — epoch 도 함께 올라가 이전 목표 아래 모인 기여는 더 세지 않는다.
     * 「같은 목표로 다시 고른다」도 epoch 가 올라가는지는 호출측이 먼저 가른다
     * (같은 값이면 무변경 200 이라 이 메서드를 부르지 않는다 — 정책 C11).
     */
    public void retarget(String buildingId) {
        this.targetBuildingId = buildingId;
        this.targetEpoch++;
    }

    /** 목표를 해제한다 — 건설 확정으로 목표가 소비됐을 때 쓴다. epoch 도 올라간다. */
    public void clearTarget() {
        this.targetBuildingId = null;
        this.targetEpoch++;
    }
}
