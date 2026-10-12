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
 * @param seaReward      바다 집중을 방금 정산한 응답에서만 값이 있다(GROMO-2274) — 이번에 받은 상품과 다음 단계까지 남은
 *                       분. 바다 세션은 아무것도 못 받았어도 객체다(키는 늘 있다). <b>{@code null} 은 «받은 것 없음» 이
 *                       아니라 «모름»</b> 이다: 섬 세션이거나, 바다 세션이라도 이 응답이 정산 직후가 아닌 경우(새 키로
 *                       다시 끝낸 요청·{@code pending-result}·휴식 자동 종료 뒤 조회 — 정산 행에서 응답을 다시 만들 뿐
 *                       받은 상품은 저장하지 않는다). 지급 여부의 정본은 인벤토리({@code owned_products})다
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
        SeaReward seaReward) {

    /** @param personalFishAdded 개인 지갑 반영 @param constructionFishAdded 섬 통장(섬 물고기) 반영 — 이름은 LLD 계약 그대로 */
    public record Allocation(int personalFishAdded, int constructionFishAdded) {
    }

    /** @param id 퀘스트/회차 id @param myRate 이 세션이 기여한 내 진행률 */
    public record QuestProgress(UUID id, double myRate) {
    }

    /**
     * 바다 집중 보상 (GROMO-2274).
     *
     * @param grantedProductIds 이번에 새로 개인 인벤토리에 들어간 상품 id. 없으면 빈 목록
     * @param minutesToNextTier 다음 단계(상시·이번 달 시즌 중 가장 가까운 것)까지 남은 분. 더 받을 단계가 없으면 null
     */
    public record SeaReward(List<String> grantedProductIds, Integer minutesToNextTier) {
    }
}
