package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 방장의 신청자 목록 한 페이지 (GROMO-1802, 섬 관리 LLD §3.3). 경계는 {@link IslandMembersPage} 와 같이
 * Business 가 서명 커서로 감싼다.
 */
public record IslandJoinRequestsPage(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Item> items,
        Instant nextCreatedAt,
        UUID nextRequestId) {

    /** 신청 한 건 — {@code version} 은 그 요청 자원 축이다. */
    public record Item(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID applicantId,
            String name,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String status,
            @JsonProperty(required = true) long version) {
    }
}
