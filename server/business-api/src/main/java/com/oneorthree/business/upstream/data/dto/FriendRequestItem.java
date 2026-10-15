package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 받은·보낸 친구 요청 목록의 한 건 (GROMO-1894) — Data 의 {@code FriendRequestResponse} 그대로
 * (friend-letter LLD §1.6). 담기는 유저는 항상 <b>상대</b>다.
 *
 * @param requestId 요청 행 id — 수락·거절·취소가 이 값을 쓴다
 * @param userId    상대 유저 id
 * @param nickname  상대 닉네임 — 탈퇴자는 null 일 수 있다
 * @param tierLevel 상대 티어. 리그 미참여면 null
 * @param createdAt 이번 요청 사이클이 시작된 시각(문자열 그대로 전달)
 */
public record FriendRequestItem(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID requestId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID userId,
        String nickname,
        Integer tierLevel,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String createdAt) {
}
