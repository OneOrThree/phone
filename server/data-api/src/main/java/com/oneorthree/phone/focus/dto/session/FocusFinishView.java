package com.oneorthree.phone.focus.dto.session;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * finish 성공 응답 (GROMO-1764, LLD §1·§2). GROMO-1924 부터 finish 가 세션을 정산하고 이 값을 만든다 —
 * 산식·귀속은 2026-09-18 결정 D5 · 2026-09-19 D5-귀속-개정(섬 통장 100%), 값의 정본은 {@code focus_settlements} 행이다.
 *
 * @param recordId       완료 기록 id(={@code sessionId})
 * @param islandId       소속 섬
 * @param subject        집중 주제
 * @param targetMinutes  목표 시간(분). 선택이라 없을 수 있다(GROMO-1990)
 * @param activeSeconds  세션 전체의 순수 집중 초 합
 * @param goalAchieved   activeSeconds가 목표 시간(초) 이상인가 — 목표가 없으면 늘 false
 * @param earnedFish     총 지급량 — E=P+C(personalFishAdded+constructionFishAdded) 보존식
 * @param allocation     개인 지갑/섬 통장 분배(D5-귀속-개정 — 현재 개인 0 · 섬 통장 전부)
 * @param completedAt    정산을 확정한 서버 시각
 * @param questProgress  이 세션이 기여한 퀘스트 진행률(1772/1773 계약). 퀘스트 계약이 아직 없어 늘 빈 목록이다
 * @param activeIntervals ACTIVE 구간 실제 시간(GROMO-2131, LLD §1) — finish 시점엔 전부 닫혀 있다. 없으면 빈 목록
 * @param seaReward      집중 꾸미기 보상(GROMO-2301) — 섬·바다 모두 늘 객체다. 이름은 GROMO-2274 계약 그대로 둔다.
 *                       값은 정산 행({@code focus_settlements})에 남긴 추첨 결과라 방금 정산한 응답·새 키로 다시 끝낸
 *                       요청·{@code pending-result}(휴식 자동 종료)가 같은 값이다. 15분 미만이면 빈 목록이다
 * @param kind           {@code "island"} 또는 {@code "sea"}(GROMO-2299)
 * @param arrived        바다 세션의 도착 여부({@code activeSeconds >= 항해 분*60}). 섬 세션은 null
 * @param createdIsland  이번 정산이 무인도 항해 성공으로 새 섬(방장=본인)을 만들었는가(GROMO-2650). 일반 섬 도착·
 *                       섬 세션은 {@code false} 다. 앱은 이 값이 참일 때만 섬 이름 짓기 팝업을 띄운다 — 앱과의 계약명이다
 */
public record FocusFinishView(
        UUID recordId,
        UUID islandId,
        String subject,
        Integer targetMinutes,
        long activeSeconds,
        boolean goalAchieved,
        int earnedFish,
        Allocation allocation,
        Instant completedAt,
        List<QuestProgress> questProgress,
        List<ActiveInterval> activeIntervals,
        SeaReward seaReward,
        String kind,
        Boolean arrived,
        boolean createdIsland) {

    /** @param personalFishAdded 개인 지갑 반영 @param constructionFishAdded 섬 통장(섬 물고기) 반영 — 이름은 LLD 계약 그대로 */
    public record Allocation(int personalFishAdded, int constructionFishAdded) {
    }

    /** @param id 퀘스트/회차 id @param myRate 이 세션이 기여한 내 진행률 */
    public record QuestProgress(UUID id, double myRate) {
    }

    /**
     * 집중 꾸미기 보상 (GROMO-2274 모양, GROMO-2301 의미).
     *
     * @param grantedProductIds 이 세션이 뽑은 상품 id — 0~1개. 이미 가진 상품이어도 들어간다(중복 획득 — 보유 행은
     *                          처음 한 번만 생긴다). 휴식 제외 집중 15분 미만이면 빈 목록
     * @param minutesToNextTier 옛 누적 단계표의 남은 분 — 단계표가 없어져 늘 null 이다(앱·business-api 계약이라 키는 남긴다)
     * @param newProductIds     {@code grantedProductIds} 중 이번 지급으로 처음 가진 것(결과창 NEW!) — 이미 가진 상품을 또
     *                          뽑았으면 빈 목록. 정산 행에 남긴 값이라 재시도·새 키·{@code pending-result} 도 같다
     */
    public record SeaReward(List<String> grantedProductIds, Integer minutesToNextTier, List<String> newProductIds) {
    }
}
