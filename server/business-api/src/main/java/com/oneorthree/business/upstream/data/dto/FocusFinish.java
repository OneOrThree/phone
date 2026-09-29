package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;
import java.util.UUID;

/**
 * finish 정산 결과 (GROMO-1764, focus-rest-session LLD §1 {@code FocusFinishView}).
 *
 * <p>GROMO-1990 부터 finish 는 <b>지급하지 않는다</b> — 물고기는 진행 중에 매분 적립 틱이 섬 통장에
 * 넣고, 이 응답의 {@code earnedFish}·{@code allocation} 은 그 세션이 지금까지 적립한 합의 «확정 기록»이다
 * (개인 몫은 언제나 0 — D5-귀속-개정). 종전 주석의 「지급 게이트가 finish 를 항상 503 으로 막는다」는
 * GROMO-1924 이전 상태라 사실이 아니다.
 *
 * @param recordId      완료 기록 id(= sessionId)
 * @param islandId      소속 섬
 * @param subject       집중 주제
 * @param targetMinutes 목표 시간(분) — 선택이라 없을 수 있다(GROMO-1990)
 * @param activeSeconds 세션 전체의 순수 집중 초 합
 * @param goalAchieved  목표 달성 여부
 * @param earnedFish    총 지급량 — E=P+C 보존식
 * @param allocation    개인/건설 기여 분배
 * @param completedAt   정산을 확정한 서버 시각
 * @param questProgress 이 세션이 기여한 퀘스트 진행률
 * @param activeIntervals ACTIVE 구간 실제 시간(GROMO-2131) — finish 시점엔 전부 닫혀 있다.
 *                      구버전 Data 가 안 보내면 {@code null} 로 두어 공개 응답에서도 빠지게 한다 —
 *                      빈 목록으로 채우면 앱이 «구간 0건»으로 읽어 같은 날 집중이 사라진다
 */
public record FocusFinish(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID recordId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID islandId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String subject,
        Integer targetMinutes,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long activeSeconds,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean goalAchieved,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int earnedFish,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Allocation allocation,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String completedAt,
        @JsonSetter(nulls = Nulls.AS_EMPTY) List<QuestProgress> questProgress,
        List<ActiveIntervalState> activeIntervals) {

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
