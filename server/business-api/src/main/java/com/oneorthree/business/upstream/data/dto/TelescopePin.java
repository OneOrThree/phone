package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 망원경에 섬을 넣은 결과 (GROMO-2268, 섬 외부 계약 §6) — Data {@code TelescopePinView} 와 같은 필드다.
 *
 * <p>{@code evicted} 는 키는 필수지만 값은 null 일 수 있다 — 5번째가 아니면 밀려난 핀이 없다. {@code created} 는 Data
 * 의 HTTP 상태(201 새 핀 / 200 이미 있던 핀)를 본문에 실어 온 것이다 — 이 서비스의 상류 클라이언트는 응답 본문만 돌려주기
 * 때문이다. 공개 응답에는 싣지 않고 공개 상태 코드를 고르는 데만 쓴다.
 */
public record TelescopePin(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Telescope.Item item,
        @JsonProperty(required = true) Evicted evicted,
        @JsonProperty(required = true) boolean created) {

    /** 5번째라 밀려난 가장 오래된 핀의 섬. */
    public record Evicted(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID islandId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String name) {
    }
}
