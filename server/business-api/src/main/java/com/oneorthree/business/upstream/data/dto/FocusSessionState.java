package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 진행 중 집중 세션 (GROMO-1764) — start · current · pause · resume 가 공유하는 Data 응답이다.
 * 공개 계약(focus-rest-session LLD §1 {@code FocusSessionView})과 같은 필드라 <b>그대로 내보낸다</b>.
 *
 * <p>시각을 {@code Instant} 가 아니라 문자열로 받는 이유: 이 서비스는 시각을 계산하지 않고 전달만
 * 한다. 파싱해 다시 직렬화하면 두 서비스의 Jackson 설정 차이가 wire 포맷을 조용히 바꾼다
 * ({@code ResultAckPrepareResult.ackDeadlineAt} 과 같은 취급).
 *
 * @param id            세션 id
 * @param islandId      소속 섬
 * @param subject       집중 주제
 * @param targetMinutes 목표 시간(분)
 * @param status        {@code "active"} 또는 {@code "paused"}
 * @param activeSeconds serverNow 까지의 순수 집중 초(휴식 제외)
 * @param serverNow     응답을 만든 서버 시각 — activeSeconds 의 anchor
 * @param startedAt     세션 최초 시작 시각
 * @param restStartedAt paused 일 때만 값이 있다. active 면 {@code null}
 * @param version       낙관 버전 — 다음 pause/resume/finish 의 expectedVersion
 */
public record FocusSessionState(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID islandId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String subject,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int targetMinutes,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String status,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long activeSeconds,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String serverNow,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String startedAt,
        String restStartedAt,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long version) {
}
