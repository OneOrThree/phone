package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 주민 목록 한 페이지 (GROMO-1802, 섬 관리 LLD §3.2). {@code nextJoinedAt}·{@code nextMembershipId} 는 평문
 * keyset 경계라 앱에 그대로 내보내지 않는다 — Business 가 서명 커서로 감싼다. 둘 다 null 이면 마지막 페이지다.
 */
public record IslandMembersPage(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Item> items,
        Instant nextJoinedAt,
        UUID nextMembershipId,
        @JsonProperty(required = true) long version) {

    /**
     * 주민 한 명 — 공개 응답의 항목과 같은 모양이다. 고양이 외형은 {@code appearance}(착용 외양, GROMO-1937)이고
     * {@code catColor} 는 고양이 색(계정 Q03, GROMO-1945 — 미선택 null)이다.
     */
    public record Item(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
            String name,
            String catColor,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String role,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) PersonalAppearanceState appearance) {
    }
}
