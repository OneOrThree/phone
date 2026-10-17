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
 * @param seaReward     바다 집중 보상(GROMO-2274) — 이번에 받은 상품과 다음 단계까지 남은 분. {@code null} 은 «받은 것
 *                      없음» 이 아니라 «모름» 이다: 섬 세션이거나, 바다 세션이라도 정산 직후 응답이 아닌 경우(새 키
 *                      재종료·pending-result·휴식 자동 종료 뒤 조회)이며, 이 필드를 모르는 구버전 Data 도 안 보내
 *                      {@code null} 이다(필수가 아니다). 지급 여부의 정본은 인벤토리다
 * @param kind          {@code "island"} 또는 {@code "sea"}(GROMO-2299) — 선택이다(구버전 Data 는 안 보낸다)
 * @param arrived       바다 세션의 도착 여부(항해 시간을 채웠는가). 섬 세션이거나 구버전 Data 면 {@code null}
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
        List<ActiveIntervalState> activeIntervals,
        SeaReward seaReward,
        String kind,
        Boolean arrived) {

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

    /**
     * @param grantedProductIds 이번에 새로 개인 인벤토리에 들어간 상품 id — 없으면 빈 목록
     * @param minutesToNextTier 다음 단계까지 남은 분 — 더 받을 단계가 없으면 {@code null}
     */
    public record SeaReward(
            @JsonSetter(nulls = Nulls.AS_EMPTY) List<String> grantedProductIds,
            Integer minutesToNextTier) {
    }
}
