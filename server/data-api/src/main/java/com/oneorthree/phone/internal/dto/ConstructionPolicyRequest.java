package com.oneorthree.phone.internal.dto;

import java.math.BigDecimal;
import java.util.List;

/** 소수를 정수로 잘라 받지 않고 서비스에서 정확한 정수 범위를 검사한다. */
public record ConstructionPolicyRequest(BigDecimal expectedCostPolicyVersion, List<Item> items) {
    public record Item(String buildingId, BigDecimal cost, BigDecimal buildSeconds) { }
}
