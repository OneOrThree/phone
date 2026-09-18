package com.oneorthree.phone.construction.repository.domain;

import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.UUID;

/** 섬 시설 행의 복합 PK — (islandId, buildingId). */
@Getter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class IslandFacilityId implements Serializable {

    private UUID islandId;
    private String buildingId;
}
