package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * 편지 발송 본문 (GROMO-1933, friend-letter LLD §1.12). 보내는 쪽은 경로의 {@code userId} 로 오므로
 * 받는 쪽과 내용만 담는다 — {@code FriendRequestCreateRequest} 와 같은 관례다.
 *
 * <p>{@code content} 에 길이·공백 제약을 애노테이션으로 걸지 않는다. 빈 본문과 길이 초과는 사유가
 * 다른 도메인 코드 두 개라({@code LetterErrorCode} 참고) bean validation 의 한 400 으로 합치지 않는다.
 * 판정은 서비스가 도메인 코드로 한다.
 *
 * @param receiverId 편지를 받는 유저
 * @param content    편지 본문. strip 후 빈 값·상한 초과는 서비스가 각각 다른 코드로 거절한다
 */
public record LetterSendRequest(@NotNull UUID receiverId, String content) {
}
