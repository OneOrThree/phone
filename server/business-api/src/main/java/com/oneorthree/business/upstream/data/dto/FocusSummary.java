package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * 홈 요약 (GROMO-1764, focus-rest-session LLD §2 home-summary). 공개 계약과 같은 필드라 그대로
 * 내보낸다. KST 날짜·서버 시각은 Data 가 계산한 문자열을 그대로 전달한다.
 *
 * @param date                       조회한 KST 날짜({@code yyyy-MM-dd})
 * @param completedSeconds           그 날짜에 귀속된 완료 세션의 순수 집중 초 합
 * @param currentSessionSecondsToday 진행 중 세션의 ACTIVE 구간과 그 날짜의 교집합
 * @param totalSeconds               두 값의 합
 * @param serverNow                  같은 읽기 snapshot 의 서버 시각
 */
public record FocusSummary(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String date,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long completedSeconds,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long currentSessionSecondsToday,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long totalSeconds,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String serverNow) {
}
