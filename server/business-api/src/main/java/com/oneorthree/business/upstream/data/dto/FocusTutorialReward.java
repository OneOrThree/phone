package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/** 최초 낚시 보상의 서버 확정 상태. */
public record FocusTutorialReward(
        @JsonProperty(required = true) UUID sessionId,
        @JsonProperty(required = true) String status) {
}
