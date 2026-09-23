package com.oneorthree.business.usecase;

import com.oneorthree.business.api.dto.ShopResponses.ShopCatalogItem;
import com.oneorthree.business.api.dto.ShopResponses.ShopOrder;
import com.oneorthree.business.api.dto.ShopResponses.ShopOrderItem;
import com.oneorthree.business.api.dto.ShopResponses.ShopProduct;
import com.oneorthree.business.api.dto.ShopResponses.ShopWallets;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.api.PublicCurrentState;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CursorBoundary;
import com.oneorthree.business.common.request.CursorScope;
import com.oneorthree.business.common.request.SignedCursorCodec;
import com.oneorthree.business.upstream.data.DataShopClient;
import com.oneorthree.business.upstream.data.dto.ShopViews;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 섬 상점 5종의 공개 유스케이스 (GROMO-1781, island-shop LLD §2).
 *
 * <p>권한(SHARED_PURCHASE)·시설·소유·가격·잔액·버전·멱등은 전부 Data TX 가 판정한다. Business 는 strict 세션의
 * 주체만 넘기고, 서명 커서를 풀고 만들며, 도메인 실패를 공개 오류 표로 옮긴다.
 *
 * <h2>커서</h2>
 * 카탈로그는 {@code (displayOrder ASC, productId ASC)} + <b>첫 발행본 고정</b>이라 경계의 sortKey 에
 * {@code <publicationVersion>:<displayOrder>} 를, tieBreaker 에 productId 를 싣는다. 내역은
 * {@code (createdAt DESC, id DESC)} 다. scope 에 사용자·섬·category/scope·limit 가 묶여 다른 조건의 커서는 400 이다.
 */
@Service
@RequiredArgsConstructor
public class ShopUseCase {

    /** 목록 기본 크기 — 화면 조회도 같은 값을 써야 화면이 발행한 커서를 도메인 GET 이 이어받는다(B10). */
    public static final int DEFAULT_LIMIT = 30;

    private static final String FIELD_CURSOR = "cursor";
    private static final String FIELD_PRODUCT = "productId";
    private static final String FIELD_PRODUCT_VERSION = "expectedProductVersion";
    private static final String FIELD_WALLET_VERSION = "expectedWalletVersion";

    /**
     * 상류 (status, code) → 공개 코드·필드. 여기 없는 코드는 그대로 올려 전역 핸들러가 동명 공개 코드로 옮기거나
     * (IDEMPOTENCY_KEY_CONFLICT·REQUEST_IN_PROGRESS 등) 502 로 접는다. 상태까지 대조한다.
     */
    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.ofEntries(
            Map.entry("USER_NOT_FOUND", new PublicFailure(404, ApiErrorCode.USER_NOT_FOUND, null)),
            Map.entry("GROUP_NOT_FOUND", new PublicFailure(404, ApiErrorCode.GROUP_NOT_FOUND, "islandId")),
            // 비주민 — 모든 상점 API 공통 소속 게이트.
            Map.entry("MEMBER_ONLY", new PublicFailure(403, ApiErrorCode.FORBIDDEN, "islandId")),
            // 섬 물고기 지출 권한(SHARED_PURCHASE) 없음 — 지금은 비주민만 해당한다(GROMO-2000).
            Map.entry("SHOP_FORBIDDEN", new PublicFailure(403, ApiErrorCode.FORBIDDEN, null)),
            Map.entry("FACILITY_LOCKED", new PublicFailure(403, ApiErrorCode.FACILITY_LOCKED, null)),
            Map.entry("PRODUCT_NOT_FOUND", new PublicFailure(404, ApiErrorCode.PRODUCT_NOT_FOUND, FIELD_PRODUCT)),
            Map.entry("OUT_OF_RANGE", new PublicFailure(422, ApiErrorCode.OUT_OF_RANGE, null)),
            // 이미 소유·가격 미승인(S03)·선행 상품 미보유 — 차감 0.
            Map.entry("STATE_CONFLICT", new PublicFailure(409, ApiErrorCode.STATE_CONFLICT, FIELD_PRODUCT)),
            Map.entry("INSUFFICIENT_FUNDS", new PublicFailure(409, ApiErrorCode.INSUFFICIENT_FUNDS, FIELD_PRODUCT)),
            Map.entry("CURSOR_EXPIRED", new PublicFailure(409, ApiErrorCode.CURSOR_EXPIRED, FIELD_CURSOR)),
            Map.entry("INVALID_REQUEST", new PublicFailure(400, ApiErrorCode.INVALID_REQUEST, null)));

    private final DataShopClient data;
    private final ObjectProvider<SignedCursorCodec> cursorCodecs;

    /** 공개 카탈로그 한 쪽. */
    public record Products(List<ShopCatalogItem> items, String nextCursor) {
    }

    /** 공개 내역 한 쪽. */
    public record Orders(List<ShopOrderItem> items, String nextCursor) {
    }

    public ShopWallets wallets(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        return ShopWallets.from(required(relay(() -> data.fetchShopWallets(claims.userId(), islandId, deadline))));
    }

    /** 카탈로그 — 커서를 먼저 푸는 것은 위조·만료 커서로 상류를 두드리지 않기 위해서다. */
    public Products products(AccessTokenClaims claims, UUID islandId, String category, String cursor, int limit,
            Deadline deadline) {
        CursorScope scope = new CursorScope(claims.userId(), "islands/shop/products",
                Map.of("islandId", islandId.toString(), "category", category), "display-asc", limit);
        CatalogAnchor anchor = cursor == null ? null
                : CatalogAnchor.of(codec().decode(cursor, scope, FIELD_CURSOR));
        ShopViews.ProductPage page = required(relay(() -> data.fetchShopProducts(claims.userId(), islandId,
                category, anchor == null ? null : anchor.publicationVersion(),
                anchor == null ? null : anchor.displayOrder(), anchor == null ? null : anchor.productId(), limit,
                deadline)));
        String next = null;
        if (page.hasMore()) {
            if (page.publicationVersion() == null || page.lastDisplayOrder() == null || page.lastProductId() == null) {
                throw new UpstreamContractMismatchException("다음 쪽이 있다면서 경계가 없습니다");
            }
            next = codec().encode(scope, new CursorBoundary(
                    page.publicationVersion() + ":" + page.lastDisplayOrder(), page.lastProductId()));
        }
        return new Products(page.items().stream().map(ShopCatalogItem::from).toList(), next);
    }

    public ShopProduct product(AccessTokenClaims claims, UUID islandId, String productId, Deadline deadline) {
        return ShopProduct.from(required(relay(() -> data.fetchShopProduct(claims.userId(), islandId, productId,
            deadline))));
    }

    /**
     * 구매. 같은 키·같은 본문은 Data 의 원 201 재생이다. 버전 충돌이면 상세·지갑을 같은 주체로 다시 읽어
     * 어긋난 축을 field 로 지목하고 최신 공개 상태를 {@code current} 에 싣는다(LLD §2.4).
     */
    public ShopOrder purchase(AccessTokenClaims claims, UUID islandId, String productId,
            long expectedWalletVersion, long expectedProductVersion, UUID key, Deadline deadline) {
        try {
            return ShopOrder.from(required(data.purchaseShopProduct(claims.userId(), islandId, productId,
                expectedWalletVersion,
                    expectedProductVersion, key, deadline)));
        } catch (UpstreamDomainException e) {
            if (e.getStatus() == 409 && "VERSION_CONFLICT".equals(e.getCode())) {
                throw versionConflict(claims, islandId, productId, expectedProductVersion, deadline);
            }
            throw mapped(e);
        }
    }

    /** 섬 귀속 내역 — personal 은 그 섬의 내 주문, shared 는 그 섬의 공동 주문. */
    public Orders orders(AccessTokenClaims claims, UUID islandId, String scopeName, String cursor, int limit,
            Deadline deadline) {
        CursorScope scope = new CursorScope(claims.userId(), "islands/shop/orders",
                Map.of("islandId", islandId.toString(), "scope", scopeName), "created-desc", limit);
        OrderAnchor anchor = cursor == null ? null
                : OrderAnchor.of(codec().decode(cursor, scope, FIELD_CURSOR));
        ShopViews.OrderPage page = required(relay(() -> data.fetchShopOrders(claims.userId(), islandId, scopeName,
                anchor == null ? null : anchor.createdAt(), anchor == null ? null : anchor.id(), limit, deadline)));
        String next = null;
        if (page.hasMore()) {
            if (page.items().isEmpty()) {
                throw new UpstreamContractMismatchException("다음 쪽이 있다면서 행이 없습니다");
            }
            ShopViews.OrderItem last = page.items().get(page.items().size() - 1);
            next = codec().encode(scope,
                    new CursorBoundary(last.createdAt().toString(), last.id().toString()));
        }
        return new Orders(page.items().stream().map(ShopOrderItem::from).toList(), next);
    }

    // ---------------------------------------------------------------- 도구

    private RuntimeException versionConflict(AccessTokenClaims claims, UUID islandId, String productId,
            long expectedProductVersion, Deadline deadline) {
        try {
            ShopViews.Product product = data.fetchShopProduct(claims.userId(), islandId, productId, deadline);
            if (product != null && product.productVersion() != expectedProductVersion) {
                return new PublicApiException(ApiErrorCode.VERSION_CONFLICT, FIELD_PRODUCT_VERSION,
                        new PublicCurrentState(product.productVersion(), ShopProduct.from(product)));
            }
            ShopViews.Wallets wallets = data.fetchShopWallets(claims.userId(), islandId, deadline);
            if (wallets != null) {
                return new PublicApiException(ApiErrorCode.VERSION_CONFLICT, FIELD_WALLET_VERSION,
                        new PublicCurrentState(wallets.villagePointsVersion(), ShopWallets.from(wallets)));
            }
        } catch (RuntimeException e) {
            // 재조회 실패 — 지목 근거가 없으므로 current 없이 충돌만 남긴다. 앱은 정본 GET 으로 다시 읽는다.
        }
        return new PublicApiException(ApiErrorCode.VERSION_CONFLICT, FIELD_PRODUCT_VERSION);
    }

    private static <T> T relay(Supplier<T> upstream) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            throw mapped(e);
        }
    }

    private static RuntimeException mapped(UpstreamDomainException error) {
        PublicFailure failure = DOMAIN_FAILURES.get(error.getCode());
        if (failure == null || failure.upstreamStatus() != error.getStatus()) {
            return error;
        }
        return new PublicApiException(failure.code(), failure.field());
    }

    private static <T> T required(T value) {
        if (value == null) {
            throw new UpstreamContractMismatchException("상점 응답이 없습니다");
        }
        return value;
    }

    /**
     * 서명기는 {@code business.cursor.enabled=true} 일 때만 있다. 커서 없는 첫 쪽은 서명기 없이도 읽되, 다음 쪽을
     * 만들거나 받은 커서를 풀어야 할 때 없으면 «없는 셈» 치지 않고 503 이다({@code IslandNoticeUseCase} 와 같은 결).
     */
    private SignedCursorCodec codec() {
        SignedCursorCodec codec = cursorCodecs.getIfAvailable();
        if (codec == null) {
            throw new PublicApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null);
        }
        return codec;
    }

    /** 카탈로그 경계 — 서명은 통과했는데 값이 형식에 맞지 않으면 위조·손상이다(같은 400). */
    private record CatalogAnchor(long publicationVersion, int displayOrder, String productId) {

        static CatalogAnchor of(CursorBoundary boundary) {
            if (boundary == null) {
                return null;
            }
            try {
                String[] parts = boundary.sortKey().split(":", -1);
                if (parts.length != 2 || boundary.tieBreaker().isEmpty()) {
                    throw new IllegalArgumentException("경계 형식");
                }
                return new CatalogAnchor(Long.parseLong(parts[0]), Integer.parseInt(parts[1]),
                        boundary.tieBreaker());
            } catch (IllegalArgumentException e) {
                throw new PublicApiException(ApiErrorCode.INVALID_CURSOR, FIELD_CURSOR);
            }
        }
    }

    private record OrderAnchor(Instant createdAt, UUID id) {

        static OrderAnchor of(CursorBoundary boundary) {
            if (boundary == null) {
                return null;
            }
            try {
                return new OrderAnchor(Instant.parse(boundary.sortKey()), UUID.fromString(boundary.tieBreaker()));
            } catch (DateTimeParseException | IllegalArgumentException e) {
                throw new PublicApiException(ApiErrorCode.INVALID_CURSOR, FIELD_CURSOR);
            }
        }
    }

    /** 공개 오류 한 줄 — 상류 상태, 공개 코드, 사용자에게 알려 줄 입력 필드. */
    private record PublicFailure(int upstreamStatus, ApiErrorCode code, String field) {
    }
}
