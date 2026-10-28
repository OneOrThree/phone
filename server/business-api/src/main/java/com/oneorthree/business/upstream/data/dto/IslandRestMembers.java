package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;

/**
 * 휴식 주민 스냅샷 (GROMO-1765, focus-rest-session LLD §2 rest-members). 공개 GET 의 {@code data} 와 같은
 * 필드를 내부에서 읽으며, 공개 응답은 유스케이스가 별도 DTO로 조립한다.
 * {@code catColor} 는 {@link IslandFocusMembers} 와 같은 이유로 없고, 원본에 없는 {@code sessionId} 는 싣지 않는다.
 */
public record IslandRestMembers(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Item> items,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String serverNow,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<MemberWatermark> watermarks) {

    /** {@code name} 만 null 허용 — 키는 항상 실린다. */
    public record Item(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String userId,
            @JsonProperty(required = true) @JsonInclude(JsonInclude.Include.ALWAYS) String name,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int restSeat,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String restStartedAt) {
    }
}
