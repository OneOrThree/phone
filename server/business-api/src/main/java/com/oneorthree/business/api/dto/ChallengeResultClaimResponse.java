package com.oneorthree.business.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/** 결과 표시 선점의 공개 필드. 검증한 토큰 원문만 반환한다. */
public record ChallengeResultClaimResponse(@JsonProperty(required = true) String claimToken) {
}
