package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.List;

/** 현재 적용 중인 전체 건설 비용·공사 시간. */
public record ConstructionPolicyView(int costPolicyVersion, Instant publishedAt, List<Item> items) {
    public record Item(String buildingId, String displayName, int cost, int buildSeconds) { }
}
