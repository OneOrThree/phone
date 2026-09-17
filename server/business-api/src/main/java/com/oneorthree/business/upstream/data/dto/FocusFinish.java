package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;
import java.util.UUID;

/**
 * finish 정산 결과 (GROMO-1764, focus-rest-session LLD §1 {@code FocusFinishView}).
 *
 * <p>보상 정책(FR-D01~06)이 미확정인 동안 Data 의 지급 게이트가 finish 를 항상
 * {@code REWARD_POLICY_UNAVAILABLE}(503) 로 막으므로 <b>이 타입이 실제로 만들어지는 경로는 아직
 * 없다</b>. 계약 타입만 고정해 둔다 — 값을 지어내지 않는다.
 *
 * @param recordId      완료 기록 id(= sessionId)
 * @param islandId      소속 섬
 * @param subject       집중 주제
 * @param targetMinutes 목표 시간(분)
 * @param activeSeconds 세션 전체의 순수 집중 초 합
 * @param goalAchieved  목표 달성 여부
 * @param earnedFish    총 지급량 — E=P+C 보존식
 * @param allocation    개인/건설 기여 분배
 * @param completedAt   정산을 확정한 서버 시각
 * @param questProgress 이 세션이 기여한 퀘스트 진행률
 */
public record FocusFinish(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID recordId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID islandId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String subject,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int targetMinutes,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long activeSeconds,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean goalAchieved,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int earnedFish,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Allocation allocation,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String completedAt,
        @JsonSetter(nulls = Nulls.AS_EMPTY) List<QuestProgress> questProgress) {

    /**
     * @param personalFishAdded     개인 지갑 반영
     * @param constructionFishAdded 초기 건설 기여 반영
     */
    public record Allocation(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int personalFishAdded,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int constructionFishAdded) {
    }

    /**
     * @param id     퀘스트/회차 id
     * @param myRate 이 세션이 기여한 내 진행률
     */
    public record QuestProgress(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) double myRate) {
    }
}
