package com.oneorthree.phone.focus.dto.session;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * finish 성공 응답 (GROMO-1764, LLD §1·§2). 보상 정책(FR-D01~06)이 확정되기 전까지는
 * {@link com.oneorthree.phone.focus.support.FocusRewardPolicyGate}가 항상 막아 이 타입이
 * 실제로 만들어지는 경로가 없다 — 계약 타입만 미리 고정해 둔다.
 *
 * @param recordId       완료 기록 id(={@code sessionId})
 * @param islandId       소속 섬
 * @param subject        집중 주제
 * @param targetMinutes  목표 시간(분)
 * @param activeSeconds  세션 전체의 순수 집중 초 합
 * @param goalAchieved   activeSeconds가 목표 시간(초) 이상인가
 * @param earnedFish     총 지급량 — E=P+C(personalFishAdded+constructionFishAdded) 보존식
 * @param allocation     개인/건설 기여 분배
 * @param completedAt    정산을 확정한 서버 시각
 * @param questProgress  이 세션이 기여한 퀘스트 진행률(1772/1773 계약)
 */
public record FocusFinishView(
        UUID recordId,
        UUID islandId,
        String subject,
        int targetMinutes,
        long activeSeconds,
        boolean goalAchieved,
        int earnedFish,
        Allocation allocation,
        Instant completedAt,
        List<QuestProgress> questProgress) {

    /** @param personalFishAdded 개인 지갑 반영 @param constructionFishAdded 초기 건설 기여 반영 */
    public record Allocation(int personalFishAdded, int constructionFishAdded) {
    }

    /** @param id 퀘스트/회차 id @param myRate 이 세션이 기여한 내 진행률 */
    public record QuestProgress(UUID id, double myRate) {
    }
}
