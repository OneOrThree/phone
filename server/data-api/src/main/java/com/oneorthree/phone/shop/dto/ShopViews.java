package com.oneorthree.phone.shop.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 섬 상점 내부 응답 (GROMO-1781, island-shop LLD §2.1~§2.5). Business 가 서명 커서를 붙여 공개 DTO 로 옮긴다 —
 * 그래서 목록은 공개 {@code nextCursor} 대신 다음 페이지 경계를 싣는다.
 */
public final class ShopViews {

    private ShopViews() {
    }

    /**
     * 지갑(LLD §2.1). {@code villagePoints} 는 섬 통장이다. {@code fish} 는 개인 물고기 지갑의 호환 필드로
     * <b>항상 0</b> 이다(2026-09-21 재화-단일 — 상점은 {@code user_fish_wallets} 를 읽지 않는다, GROMO-2052).
     * {@code fishVersion} 도 null 고정이다 — 개인 지갑에는 사건·버전 축이 없다.
     */
    public record Wallets(int fish, int villagePoints, Long fishVersion, long villagePointsVersion) {
    }

    /** 목록 항목(LLD §2.2). price 는 승인 가격이 없으면 null 이고 그때 available=false 다(정책 S03). */
    public record Item(String id, String title, String kind, Integer price, String currency, String ownerType,
                       boolean owned, boolean available, String reason, int productVersion) {
    }

    /**
     * 목록 한 쪽 — {@code publicationVersion} 은 커서가 고정할 발행본(활성 카탈로그가 없으면 null),
     * {@code hasMore} 면 마지막 항목의 {@code (displayOrder, productId)} 가 다음 경계다.
     */
    public record ProductPage(List<Item> items, Long publicationVersion, boolean hasMore,
                              Integer lastDisplayOrder, String lastProductId) {
    }

    /** 선행 상품 안내(LLD §2.3 확장) — 불변 자산 정의의 제목을 쓴다. */
    public record RequiredProduct(String id, String title) {
    }

    /** 상품 상세(LLD §2.3). previewUrl 은 서버 등록 media 만 — media 호스트가 아직 없어 지금은 항상 null 이다. */
    public record Product(String id, String kind, String title, Integer price, String currency, String ownerType,
                          int productVersion, String previewUrl, boolean owned, boolean available,
                          String blockedReason, String requiredBuilding, RequiredProduct requiredProduct,
                          String targetBuilding) {
    }

    /** 구매 결과(LLD §2.4) — receipt 에 그대로 저장돼 같은 키 재생이 돌려준다. */
    public record Order(UUID id, String productId, int spent, String currency, String ownerType, boolean owned,
                        long walletVersion) {
    }

    /** 내역 항목(LLD §2.5) — 결제 당시 snapshot 이다. */
    public record OrderItem(UUID id, String productId, int price, String currency, Instant createdAt) {
    }

    public record OrderPage(List<OrderItem> items, boolean hasMore) {
    }
}
