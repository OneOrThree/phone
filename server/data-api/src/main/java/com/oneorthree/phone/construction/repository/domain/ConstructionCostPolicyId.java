package com.oneorthree.phone.construction.repository.domain;

import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/** 불변 비용 정책 행의 복합 PK — (revision, buildingId). */
@Getter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class ConstructionCostPolicyId implements Serializable {

    private int revision;
    private String buildingId;
}
