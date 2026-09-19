package com.oneorthree.phone.focus.dto.session;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * finish 성공 응답 (GROMO-1764, LLD §1·§2). GROMO-1924 부터 finish 가 세션을 정산하고 이 값을 만든다 —
 * 산식·귀속은 2026-09-18 결정 D5·D5-귀속, 값의 정본은 {@code focus_settlements} 행이다.
 *
 * @param recordId       완료 기록 id(={@code sessionId})
 * @param islandId       소속 섬
 * @param subject        집중 주제
 * @param targetMinutes  목표 시간(분)
 * @param activeSeconds  세션 전체의 순수 집중 초 합
 * @param goalAchieved   activeSeconds가 목표 시간(초) 이상인가
 * @param earnedFish     총 지급량 — E=P+C(personalFishAdded+constructionFishAdded) 보존식
 * @param allocation     개인 지갑/섬 통장 분배(D5-귀속)
 * @param completedAt    정산을 확정한 서버 시각
 * @param questProgress  이 세션이 기여한 퀘스트 진행률(1772/1773 계약). 퀘스트 계약이 아직 없어 늘 빈 목록이다
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

    /** @param personalFishAdded 개인 지갑 반영 @param constructionFishAdded 섬 통장(섬 물고기) 반영 — 이름은 LLD 계약 그대로 */
    public record Allocation(int personalFishAdded, int constructionFishAdded) {
    }

    /** @param id 퀘스트/회차 id @param myRate 이 세션이 기여한 내 진행률 */
    public record QuestProgress(UUID id, double myRate) {
    }
}
