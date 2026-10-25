package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * 집중섬에서 앉은 자리 (GROMO-2477) — Data 와 주고받는 지도 % 좌표(0~100). 집중 시작 본문과 focus-members 항목이 같이 쓴다.
 * 범위는 공개 경계({@code FocusSessionController})와 Data 가 본다. 자리가 있으면 두 값이 다 있어야 한다.
 */
public record FocusSeat(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) double x,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) double y) {
}
