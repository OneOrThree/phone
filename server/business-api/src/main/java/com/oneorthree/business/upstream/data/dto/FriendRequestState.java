package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 친구 요청 명령(생성·수락·거절·취소) 뒤의 상태 (GROMO-1894). 공개 응답에는 싣지 않고({@code data:null})
 * 「상류가 그 명령을 실제로 처리했는가」를 확인하는 데만 쓴다 — 빈 2xx 를 성공으로 읽지 않기 위해서다.
 *
 * @param requestId 명령이 다룬 요청 행 id
 * @param status    명령 뒤 상태 — {@code PENDING}·{@code ACCEPTED}·{@code REJECTED}·{@code CANCELED}
 */
public record FriendRequestState(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID requestId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String status) {
}
