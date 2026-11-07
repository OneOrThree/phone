package com.oneorthree.phone.internal.dto;

import java.util.List;
import java.util.UUID;

/**
 * {@code POST /internal/admin/hall-less-islands/cleanup} 응답 (GROMO-2763).
 *
 * <p>{@code summary} 는 실행 «직전» 대상과 영향이다 — dry-run 이면 그것이 전부고, 실행이면 {@code outcomes} 에 섬마다
 * 결과가 붙는다({@code CLOSED} 정리함 · {@code SKIPPED} 그사이 회관이 생겼거나 닫혀 대상이 아님 · {@code FAILED} 그 섬만
 * 롤백됨, {@code error} 에 예외 종류 — 문구는 Data 로그에만 남긴다).
 */
public record HallLessIslandCleanupView(boolean dryRun, Summary summary, List<Outcome> outcomes) {

    /**
     * 대상과 영향.
     *
     * @param islandCount               대상 섬 수
     * @param islandIds                 대상 섬 — 살아 있고({@code deleted_at IS NULL}, {@code status <> 'ENDED'}) 회관 행이 없다
     * @param residents                 대상 섬의 활성 주민(사람 수, 중복 제거)
     * @param residentsWithAnotherIsland 그중 대상이 아닌 살아 있는 섬에도 소속된 사람 — 소속이 남는다. 현재 섬은 그중
     *                                  «가 본 섬» 이 있을 때만 옮겨지고, 없으면 먼바다다(나가기와 같은 규칙)
     * @param residentsGoingToSea       남는 소속이 없어 먼바다(LEFT)로 가는 사람
     * @param activeIslandFocusSessions 대상 섬의 진행 중(ACTIVE·PAUSED) 섬 집중 — 미정산으로 끝낸다
     * @param activeSeaVoyages          대상 섬을 목적지로 항해 중인 바다 집중 — 끝내지 않는다(섬이 닫힐 때의 기존 동작)
     * @param walletFish                대상 섬 공동 지갑 잔액 합 — 섬과 함께 사라진다
     * @param pendingJoinRequests       대기 중 가입 신청 — {@code ISLAND_CLOSED} 로 닫는다
     * @param upcomingPromotions        오늘(KST) 이후 호의 잡지 홍보 칸 — 지운다
     * @param onboardingReservations    옛 무인도 예약({@code onboarding_islands}) — 지운다
     */
    public record Summary(int islandCount, List<UUID> islandIds, long residents, long residentsWithAnotherIsland,
                          long residentsGoingToSea, long activeIslandFocusSessions, long activeSeaVoyages,
                          long walletFish, long pendingJoinRequests, long upcomingPromotions,
                          long onboardingReservations) {
    }

    /** 섬 하나의 실행 결과. */
    public record Outcome(UUID islandId, String result, String error) {
    }
}
