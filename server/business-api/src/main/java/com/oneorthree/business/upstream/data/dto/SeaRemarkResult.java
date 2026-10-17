package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * 바다 한마디 변경 결과 (GROMO-2299).
 *
 * <p>시각은 문자열로 전달만 한다({@link FocusSessionState} 와 같은 취급).
 *
 * @param remark      바뀐 한마디. 지웠으면 {@code null}
 * @param changedAt   변경 시각
 * @param lockedUntil 이 시각 전에는 다시 바꿀 수 없다
 */
public record SeaRemarkResult(
        String remark,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String changedAt,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String lockedUntil) {
}
