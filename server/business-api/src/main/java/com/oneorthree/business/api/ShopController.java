package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CommandKeys;
import com.oneorthree.business.common.request.ResourceVersions;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.upstream.data.dto.ShopViews;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import com.oneorthree.business.usecase.ShopUseCase;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 섬 상점 5종의 공개 표면 (GROMO-1781, island-shop LLD §2) — 지갑·카탈로그·상품 상세·구매·내역.
 *
 * <p>{@code /islands/**} 는 {@code PublicApiRoutes.ROOTS} 에 있어 봉투가 자동으로 씌워진다. 주체는 strict 세션에서만
 * 오고, 구매 본문은 정확히 {@code {productId, expectedWalletVersion, expectedProductVersion}} 다 — 가격·통화·주인·
 * 수량은 받지 않는다(미등록 필드 400). 판정은 전부 Data TX 가 한다.
 */
@RestController
@RequiredArgsConstructor
public class ShopController {

    /** 카탈로그 문자열 — 경로 세그먼트에 그대로 실리므로 안전 문자만 받는다(DB 열은 80자). */
    private static final Pattern PRODUCT_ID = Pattern.compile("[A-Za-z0-9._-]{1,80}");
    private static final Set<String> CATEGORIES = Set.of("personal", "island", "sound");
    private static final Set<String> SCOPES = Set.of("personal", "shared");
    private static final Set<String> ORDER_FIELDS = Set.of("productId", "expectedWalletVersion",
            "expectedProductVersion");

    private final ShopUseCase shop;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    /** 본인 개인 지갑과 섬 통장 (LLD §2.1). */
    @GetMapping("/islands/{islandId}/shop/wallets")
    public ShopViews.Wallets wallets(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return shop.wallets(claims, uuid(islandId), deadline());
    }

    /** 카탈로그 (LLD §2.2) — {@code category} 필수, {@code cursor}·{@code limit}(기본 30, 1~100) 선택. */
    @GetMapping("/islands/{islandId}/shop/products")
    public ShopUseCase.Products products(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        String category = single(request, "category");
        if (category == null) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "category");
        }
        if (!CATEGORIES.contains(category)) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "category");
        }
        return shop.products(claims, uuid(islandId), category, single(request, "cursor"), limit(request),
                deadline());
    }

    /** 상품 상세 (LLD §2.3). */
    @GetMapping("/islands/{islandId}/shop/products/{productId}")
    public ShopViews.Product product(@PathVariable String islandId, @PathVariable String productId,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID island = uuid(islandId);
        if (!PRODUCT_ID.matcher(productId).matches()) {
            throw new PublicApiException(ApiErrorCode.PRODUCT_NOT_FOUND, "productId");
        }
        return shop.product(claims, island, productId, deadline());
    }

    /** 구매 (LLD §2.4) — {@code Idempotency-Key}(UUID36) 필수, 성공 201. */
    @PostMapping(value = "/islands/{islandId}/shop/orders", consumes = "application/json")
    public ResponseEntity<ShopViews.Order> purchase(@PathVariable String islandId, @RequestBody JsonNode body,
            HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        UUID key = CommandKeys.required(request);
        if (body == null || !body.isObject()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        for (String name : body.propertyNames()) {
            if (!ORDER_FIELDS.contains(name)) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, name);
            }
        }
        JsonNode productId = body.get("productId");
        if (productId == null || !productId.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, "productId");
        }
        if (!PRODUCT_ID.matcher(productId.stringValue()).matches()) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "productId");
        }
        ShopViews.Order order = shop.purchase(claims, uuid(islandId), productId.stringValue(),
                ResourceVersions.fromJson(body.get("expectedWalletVersion"), "expectedWalletVersion"),
                ResourceVersions.fromJson(body.get("expectedProductVersion"), "expectedProductVersion"),
                key, deadline());
        return ResponseEntity.status(HttpStatus.CREATED).body(order);
    }

    /** 섬 귀속 내역 (LLD §2.5) — {@code scope=personal|shared} 필수. */
    @GetMapping("/islands/{islandId}/shop/orders")
    public ShopUseCase.Orders orders(@PathVariable String islandId, HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        String scope = single(request, "scope");
        if (scope == null) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "scope");
        }
        if (!SCOPES.contains(scope)) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, "scope");
        }
        return shop.orders(claims, uuid(islandId), scope, single(request, "cursor"), limit(request), deadline());
    }

    // ---------------------------------------------------------------- 입력 해석

    private static String single(HttpServletRequest request, String name) {
        String[] values = request.getParameterValues(name);
        if (values == null || values.length == 0) {
            return null;
        }
        if (values.length > 1) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, name);
        }
        return values[0];
    }

    /** 범위(1~100)는 {@code CursorScope} 가 422 로 강제한다 — 여기서는 정수인지만 본다. */
    private static int limit(HttpServletRequest request) {
        String raw = single(request, "limit");
        if (raw == null) {
            return ShopUseCase.DEFAULT_LIMIT;
        }
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "limit");
        }
    }

    private static UUID uuid(String value) {
        try {
            UUID parsed = UUID.fromString(value);
            if (value.length() != 36 || !parsed.toString().equalsIgnoreCase(value)) {
                throw new IllegalArgumentException("UUID 형식");
            }
            return parsed;
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_PARAMETER, "islandId");
        }
    }

    private Deadline deadline() {
        return Deadline.startingNow(properties.getComposition().getDeadline());
    }
}
