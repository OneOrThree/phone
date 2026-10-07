package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/** 실제 집중 세션을 만들지 않는 최초 체험 보상. */
public record TutorialExperienceReward(
        @JsonProperty(required = true) UUID islandId,
        @JsonProperty(required = true) String status) {
}
