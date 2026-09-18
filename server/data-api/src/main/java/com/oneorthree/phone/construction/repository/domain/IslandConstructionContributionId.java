package com.oneorthree.phone.construction.repository.domain;

import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.UUID;

/** 목표 epoch 주민별 기여 행의 복합 PK — (islandId, epoch, userId). */
@Getter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class IslandConstructionContributionId implements Serializable {

    private UUID islandId;
    private long epoch;
    private UUID userId;
}
