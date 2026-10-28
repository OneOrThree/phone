package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 친구 삭제 뒤의 상태 (GROMO-1894) — 소프트 삭제된 관계 행 id. {@link FriendRequestState} 와 같은 이유로
 * 공개 응답에는 싣지 않는다.
 *
 * @param friendshipId 소프트 삭제된 {@code friendships} 행 id
 */
public record FriendshipDeleted(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID friendshipId) {
}
