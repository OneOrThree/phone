package com.oneorthree.realtime.focus.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * 응원 SEND 프레임의 본문 — 원본 계약 그대로 {@code {sessionId, type}} 둘뿐이다
 * (focus-rest-session LLD §2 emote).
 *
 * <p>{@code userId}·{@code islandId}·{@code expiresAt}·{@code destination} 이 <b>여기 없는 것이
 * 이 record 의 요점</b>이다. 주체는 인증 세션에서, 섬은 목적지 경로에서, 만료와 목적지는 서버에서
 * 나온다({@code SendMessageRequest} 가 발신자를 본문으로 받지 않는 것과 같은 이유다).
 *
 * <p>바다 이모트({@code SeaEmoteStompController})도 이 DTO 를 쓴다 — {@code sessionId} 에 제약을 걸면 바다가 조용히
 * 깨진다. 걸어야 하면 전용 DTO 로 분리한다.
 *
 * @param sessionId 본인이 그 섬에서 진행 중이라고 주장하는 집중 세션. Data 정본과 대조한다 —
 *                  남의 세션이나 이미 끝난 세션이면 거절된다. <b>방문자는 비워 보낸다</b>(GROMO-2258) —
 *                  비어 있으면 멤버십으로 갈라, 주민이면 {@code NOT_FOCUSING} 으로 거절하고 비주민이면
 *                  방문자 응원으로 처리한다
 * @param type      5종 중 하나. 문자열로 받는 이유는 계약 밖의 값을 <b>도메인 코드
 *                  ({@code INVALID_EMOTE_TYPE})로</b> 거절하기 위해서다. enum 으로 받으면 메시징
 *                  계층의 변환 실패가 되어 봉투가 달라진다
 */
public record FocusEmoteRequest(
        UUID sessionId,
        @NotNull String type
) {
}
