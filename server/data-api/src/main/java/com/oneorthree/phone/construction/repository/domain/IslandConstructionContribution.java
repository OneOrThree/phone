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

import java.time.Instant;
import java.util.UUID;

/**
 * 목표 epoch 아래의 주민별 누적 기여 (정책 P-D04) — 「물고기 잔액과 주민별 누적 획득 기록은
 * 구분한다」. 잔액은 {@code island_wallets} 에, 이 행은 「누가 얼마를 채웠는가」만 기록한다.
 * 목표가 바뀌면 epoch 도 올라가 이전 epoch 의 기여는 새 목표의 몫 계산에 들어가지 않는다.
 */
@Entity
@Table(name = "island_construction_contributions")
@IdClass(IslandConstructionContributionId.class)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class IslandConstructionContribution {

    @Id
    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    @Id
    @Column(name = "epoch", nullable = false)
    private long epoch;

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false)
    @Builder.Default
    private int amount = 0;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
