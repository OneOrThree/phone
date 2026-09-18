package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * 개인 외양 스냅샷 (GROMO-1783) — GET /me/inventory 의 equipped 와 PATCH 의 data 가 공유한다.
 * clothes·decor 은 미착용이 null 이라 required 만 걸고 Nulls.FAIL 은 걸지 않는다.
 */
public record PersonalAppearanceState(
        @JsonProperty(required = true) String clothes,
        @JsonProperty(required = true) String decor,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String hull,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String position,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long version) {
}
