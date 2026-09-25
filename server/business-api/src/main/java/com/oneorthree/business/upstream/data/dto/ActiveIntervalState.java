package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * ACTIVE 구간 하나 (GROMO-2131) — {@link FocusSessionState}·{@link FocusFinish} 가 공유한다. 시각은
 * 문자열로 받는다 — 이 서비스는 계산하지 않고 전달만 한다({@link FocusSessionState} 와 같은 이유).
 *
 * @param startedAt 구간 시작
 * @param endedAt   구간 끝
 */
public record ActiveIntervalState(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String startedAt,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String endedAt) {
}
