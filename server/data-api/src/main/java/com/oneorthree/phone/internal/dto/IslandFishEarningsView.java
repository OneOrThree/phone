package com.oneorthree.phone.internal.dto;

import java.util.List;
import java.util.UUID;

/**
 * {@code GET /islands/{islandId}/statistics/fish-earnings} 응답 (GROMO-1895, 회관 기록 LLD §7) — 도서관 물고기 장.
 *
 * <p>현재 활성 주민 전원이 한 번에 실린다(섬 정원 상한 안이라 페이지가 없다 — 스크린타임 island scope 와 같은 규칙).
 * 정산 기록이 없는 주민은 {@code earnedFish=0} 이다. 정렬은 누적 많은 순, 같으면 {@code userId} 오름차순.
 */
public record IslandFishEarningsView(List<Member> members) {

    /** 주민 한 명의 이 섬 누적 획득 — 떠났다 돌아온 주민은 이전 소속 기간의 획득도 합친다. */
    public record Member(UUID userId, String name, long earnedFish) {
    }
}
