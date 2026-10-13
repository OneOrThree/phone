package com.oneorthree.phone.internal.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 잡지 홍보 신청·섬 소식 응답 (GROMO-2267, 섬 외부 계약 §7).
 *
 * @param feeFish 이번에 낸 홍보비 — 고정 60마리
 * @param balanceAfter 차감 뒤 섬 통장 잔액
 * @param newsId 주민 전원에게 생긴 섬 소식 한 건의 id
 */
public final class IslandPromotionViews {

    private IslandPromotionViews() {
    }

    public record Created(int feeFish, int balanceAfter, UUID newsId) {
    }

    /** 최신순 소식 목록. */
    public record NewsPage(List<NewsItem> items) {
    }

    /** @param kind 소식의 종류 — 지금은 {@code PROMOTION} 하나이고, 모르는 종류도 그대로 내려간다 */
    public record NewsItem(UUID id, String kind, String body, Instant createdAt) {
    }
}
