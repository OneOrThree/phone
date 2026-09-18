package com.oneorthree.phone.construction.dto;

import java.time.Instant;

/**
 * {@code POST /internal/islands/{islandId}/constructions} 응답 (LLD §2, BUILDING 개정).
 *
 * <p>원본 계약의 {@code status=completed} 즉시 완공은 <b>폐기</b>됐다 — 공사 시간(1분~4시간)이
 * 있는 건설은 {@code BUILDING} 으로 접수되고, 완공은 스케줄러가 {@code completesAt} 경과를
 * 쓸어 확정한다. {@code version}·{@code walletVersion}·{@code villagePoints} 는 이번 커밋이
 * 만든 각 축의 새 값이다.
 */
public record ConstructionStartedView(
        String buildingId,
        String status,
        Spent spent,
        long version,
        int villagePoints,
        long walletVersion,
        Instant startedAt,
        Instant completesAt) {

    /** 실제로 섬 통장에서 나간 금액 — 통화는 항상 {@code village_points} 다. */
    public record Spent(String currency, int amount) {
    }
}
