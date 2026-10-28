package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 가입 요청 취소 결과 (GROMO-1760, 섬 소속 LLD §3.9).
 *
 * <p>성공 시 {@code status} 는 항상 {@code "cancelled"} — 같은 Idempotency-Key 의 재생도
 * 같은 값이다. 이미 승인된 요청은 취소되지 않는다(terminal 충돌은 409).
 */
public record JoinRequestCancel(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String status) {
}
