package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.usecase.CustomizationCatalogUseCase;
import com.oneorthree.business.usecase.CustomizationCatalogUseCase.ItemView;
import com.oneorthree.business.usecase.SettingsSessionGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 꾸미기 카탈로그의 공개 표면 (GROMO-2331) — 이미지 메타가 있는 상품 목록. 응답은 작아 전역 no-store 를 그대로 받는다. */
@RestController
@RequiredArgsConstructor
public class CustomizationCatalogController {

    private final CustomizationCatalogUseCase catalog;
    private final SettingsSessionGuard sessions;
    private final UpstreamConfigProperties properties;

    @GetMapping("/customization/catalog")
    public List<ItemView> catalog(HttpServletRequest request) {
        AccessTokenClaims claims = sessions.requireSession(request);
        return catalog.catalog(claims, properties.deadline());
    }
}
