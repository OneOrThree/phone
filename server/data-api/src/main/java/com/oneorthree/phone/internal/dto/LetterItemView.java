package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.UUID;

/**
 * 편지함 목록의 한 건 (GROMO-1933, friend-letter LLD §1.13).
 *
 * @param counterpartUserId     상대 — {@code type=received} 면 발신자, {@code type=sent} 면 수신자
 * @param counterpartNickname   상대 닉네임. 탈퇴자는 null(LLD §3)
 * @param isRead                {@code type=sent} 일 때는 <b>항상 false</b> — 내가 보낸 편지를 상대가 읽었는지는
 *     이 계약에서 노출하지 않는다. 키 이름을 애노테이션으로 고정한다({@code FriendResponse.isPinned} 와 같은 이유)
 */
public record LetterItemView(
        UUID id,
        UUID counterpartUserId,
        String counterpartNickname,
        String content,
        @JsonProperty("isRead") boolean isRead,
        Instant createdAt) {
}
