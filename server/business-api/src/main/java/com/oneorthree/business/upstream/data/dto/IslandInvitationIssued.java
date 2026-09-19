package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.time.Instant;

/**
 * 섬 초대 발급 결과 (GROMO-1760, 섬 소속 LLD §3.11).
 *
 * <p>같은 발급자의 활성 초대는 재사용되고, 발급자의 멤버십 세대가 바뀌면 Data 가 재발급한다.
 * {@code expiresAt} 은 만료 정책이 없으면 null 이다.
 */
public record IslandInvitationIssued(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String code,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String url,
        @JsonProperty(required = true) Instant expiresAt) {
}
