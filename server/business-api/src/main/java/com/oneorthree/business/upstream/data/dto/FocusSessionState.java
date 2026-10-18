package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;
import java.util.UUID;

/**
 * 진행 중 집중 세션 (GROMO-1764) — start · current · pause · resume 가 공유하는 Data 응답이다.
 * 공개 계약은 UseCase의 별도 DTO로 명시적으로 매핑한다.
 *
 * <p>시각을 {@code Instant} 가 아니라 문자열로 받는 이유: 이 서비스는 시각을 계산하지 않고 전달만
 * 한다. 파싱해 다시 직렬화하면 두 서비스의 Jackson 설정 차이가 wire 포맷을 조용히 바꾼다
 * ({@code ResultAckPrepareResult.ackDeadlineAt} 과 같은 취급).
 *
 * @param id            세션 id
 * @param islandId      소속 섬
 * @param subject       집중 주제
 * @param targetMinutes 목표 시간(분) — 선택이라 없을 수 있다(GROMO-1990)
 * @param status        {@code "active"} 또는 {@code "paused"}
 * @param activeSeconds serverNow 까지의 순수 집중 초(휴식 제외)
 * @param serverNow     응답을 만든 서버 시각 — activeSeconds 의 anchor
 * @param startedAt     세션 최초 시작 시각
 * @param restStartedAt paused 일 때만 값이 있다. active 면 {@code null}
 * @param version       낙관 버전 — 다음 pause/resume/finish 의 expectedVersion
 * @param activeIntervals ACTIVE 구간 실제 시간(GROMO-2131).
 *                      구버전 Data 가 안 보내면 {@code null} 로 두어 공개 응답에서도 빠지게 한다 —
 *                      빈 목록으로 채우면 앱이 «구간 0건»으로 읽어 같은 날 집중이 사라진다
 * @param kind          {@code "island"} 또는 {@code "sea"}(GROMO-2299). <b>선택</b>이다 — 이 필드를 모르는 구버전
 *                      Data 는 안 보내고(그러면 공개 응답에서도 빠진다), 필수로 받으면 롤링 배포 중 전 요청이 502 가 된다.
 *                      바다 세션이면 {@code islandId} 는 목적지이고 {@code targetMinutes} 는 항해 분이다
 * @param destinationIslandName 바다 세션의 목적지 섬 이름(GROMO-2330). <b>선택</b> — 구버전 Data·섬 세션·섬 행 없음은 안 보내고,
 *                      그러면 공개 응답에서도 키가 빠진다
 */
public record FocusSessionState(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID islandId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String subject,
        Integer targetMinutes,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String status,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long activeSeconds,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String serverNow,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String startedAt,
        String restStartedAt,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long version,
        List<ActiveIntervalState> activeIntervals,
        String kind,
        String destinationIslandName) {
}
