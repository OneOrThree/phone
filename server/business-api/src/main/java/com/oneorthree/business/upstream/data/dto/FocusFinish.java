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
 * @param seaReward     집중 꾸미기 보상(모양은 GROMO-2274, 의미는 GROMO-2301) — 섬·바다 세션 모두 Data 가 정산 행에
 *                      남긴 추첨 결과로 늘 객체를 보낸다(방금 정산·새 키 재종료·pending-result 가 같은 값). 15분 미만이면
 *                      빈 목록이다. {@code null} 은 «받은 것 없음» 이 아니라 «모름» 이고, 이 필드를 모르거나 정산 행에
 *                      결과를 남기기 전의 구버전 Data 만 그렇다(필수가 아니다)
 * @param kind          {@code "island"} 또는 {@code "sea"}(GROMO-2299) — 선택이다(구버전 Data 는 안 보낸다)
 * @param arrived       바다 세션의 도착 여부(항해 시간을 채웠는가). 섬 세션이거나 구버전 Data 면 {@code null}
 * @param createdIsland 이번 정산으로 무인도에 새 섬을 세웠는지(GROMO-2650) — 앱 이름 짓기 팝업 트리거. 일반 섬
 *                      도착은 {@code false}, 이 필드를 모르는 구버전 Data 는 안 보내 {@code null}
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
        Boolean arrived,
        Boolean createdIsland) {

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
     * @param grantedProductIds 이 세션이 뽑은 꾸미기 상품 id(0~1개) — 이미 가진 상품이어도 들어간다. 없으면 빈 목록
     * @param minutesToNextTier 옛 누적 단계표의 남은 분 — 단계표가 없어져 지금 Data 는 늘 {@code null} 이다
     * @param newProductIds     {@code grantedProductIds} 중 이번 지급으로 처음 가진 것(결과창 NEW!) — 이미 가진 상품이면
     *                          빈 목록. 이 필드를 모르는 구버전 Data 는 안 보내 빈 목록으로 받는다
     */
    public record SeaReward(
            @JsonSetter(nulls = Nulls.AS_EMPTY) List<String> grantedProductIds,
            Integer minutesToNextTier,
            @JsonSetter(nulls = Nulls.AS_EMPTY) List<String> newProductIds) {
    }
}
