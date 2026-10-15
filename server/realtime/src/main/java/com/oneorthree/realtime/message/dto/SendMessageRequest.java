package com.oneorthree.realtime.message.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * STOMP 발신 프레임의 본문.
 *
 * <p>{@code groupId} 와 {@code senderId} 가 여기 없는 것이 중요하다 — 목적지 경로와 인증 세션에서
 * 나온다. 본문으로 받으면 남의 섬에 남의 이름으로 보내는 요청이 «형식상 정상»이 되고, 그걸 막는 건
 * 검사 코드 한 줄뿐이라 언젠가 빠진다.
 *
 * @param content 본문. 공백·길이 검사는 {@code ChatMessageService} 가 도메인 규칙으로 한다 —
 *                {@code @Size} 로 붙이면 STOMP 경로에서 봉투가 달라진다
 * @param clientMessageId 재전송을 알아보기 위한 클라이언트 생성 키. <b>같은 말을 다시 보낼 때는 반드시
 *                        같은 값</b>이어야 하고, 새 말은 반드시 새 값이어야 한다. 매번 새로 만들면
 *                        재전송이 중복 저장되고, 재사용하면 다른 말이 조용히 삼켜진다
 */
public record SendMessageRequest(
        String content,
        @NotNull UUID clientMessageId
) {
}
