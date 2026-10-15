package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 본인이 넣어 둔 가입 신청 한 페이지 (GROMO-2047, 섬 소속 LLD §3.12). 경계는
 * {@link IslandJoinRequestsPage} 와 같이 Business 가 서명 커서로 감싼다.
 *
 * <p>{@link IslandJoinRequestsPage}(방장이 보는 신청자 목록)와 <b>방향이 반대</b>다 — 여기 실리는
 * 것은 신청한 섬이지 신청한 사람이 아니다. 그래서 타인 식별자·표시 이름이 들어올 자리가 없다.
 */
public record MyJoinRequestsPage(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Item> items,
        Instant nextCreatedAt,
        UUID nextRequestId) {

    /** 신청 한 건 — 섬 요약(이름·주민 수·정원)과 신청 상태·신청 시각이다. */
    public record Item(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID islandId,
            String islandName,
            @JsonProperty(required = true) int memberCount,
            @JsonProperty(required = true) int maxMembers,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String status,
            @JsonProperty(required = true) long version,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant createdAt) {
    }
}
