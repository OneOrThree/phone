package com.oneorthree.business.usecase;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataAppearanceClient;
import com.oneorthree.business.upstream.data.dto.CustomizationCatalogItem;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * 꾸미기 카탈로그 (GROMO-2331) — Data 의 이미지 메타 목록에 절대 URL 을 입힌다. {@code app.static-base-url}
 * ({@code STATIC_ASSETS_BASE_URL})이 비어 있으면 {@code imagePath} 를 그대로 내려 상대 경로가 된다(앱이 API
 * base 로 보완). 이미지 바이트는 Business 를 거치지 않고 Nginx 가 직접 준다.
 * renderData(GROMO-2382, 집중 보상 머리·목)는 Data 원문 그대로 넘긴다 — 안의 경로는 상대 경로로 남고, 앱이
 * imageUrl 에서 정적 base 를 되짚어 보완한다. 정적 오버레이 행은 renderData 키를 싣지 않아 이전 응답과 같다.
 */
@Service
public class CustomizationCatalogUseCase {

    private final DataAppearanceClient data;
    private final String baseUrl;

    public CustomizationCatalogUseCase(DataAppearanceClient data,
            @Value("${app.static-base-url:}") String baseUrl) {
        this.data = data;
        // 끝의 슬래시는 imagePath 의 앞 슬래시와 겹치므로 떼어 둔다.
        this.baseUrl = baseUrl.replaceAll("/+$", "");
    }

    public List<ItemView> catalog(AccessTokenClaims claims, Deadline deadline) {
        List<CustomizationCatalogItem> items = data.fetchCustomizationCatalog(claims.userId(), deadline);
        if (items == null) {
            throw new UpstreamContractMismatchException("꾸미기 카탈로그 응답이 없습니다");
        }
        return items.stream().map(i -> new ItemView(i.productId(), i.kind(), i.slot(), i.title(),
                baseUrl + i.imagePath(), i.width(), i.height(), i.anchorX(), i.anchorY(), i.sortOrder(),
                i.retiredAt(), i.renderData())).toList();
    }

    public record ItemView(
            @JsonProperty(required = true) String productId,
            @JsonProperty(required = true) String kind,
            @JsonProperty(required = true) String slot,
            @JsonProperty(required = true) String title,
            @JsonProperty(required = true) String imageUrl,
            @JsonProperty(required = true) Integer width,
            @JsonProperty(required = true) Integer height,
            @JsonProperty(required = true) BigDecimal anchorX,
            @JsonProperty(required = true) BigDecimal anchorY,
            @JsonProperty(required = true) int sortOrder,
            @JsonProperty(required = true) Instant retiredAt,
            @JsonInclude(JsonInclude.Include.NON_NULL) Map<String, Object> renderData) {
    }
}
