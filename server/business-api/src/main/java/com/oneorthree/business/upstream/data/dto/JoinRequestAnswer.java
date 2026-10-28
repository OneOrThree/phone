package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 가입 요청 승인·거절 결과 (GROMO-1802, 섬 관리 LLD §3.4). 거절의 {@code memberId} 는 계약상 명시 null 이라
 * 공개 응답에서 키를 빼지 않는다.
 */
public record JoinRequestAnswer(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String status,
        @JsonInclude(JsonInclude.Include.ALWAYS) UUID memberId,
        @JsonProperty(required = true) long version) {
}
