package com.oneorthree.phone.internal;

import com.oneorthree.phone.appearance.dto.CustomizationCatalogItem;
import com.oneorthree.phone.appearance.service.CustomizationCatalogService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 꾸미기 카탈로그의 내부 표면 (GROMO-2331) — 공개 {@code GET /customization/catalog} 의 상류다. 사용자 축이 아니다. */
@RestController
@RequiredArgsConstructor
public class InternalCustomizationController {

    private final CustomizationCatalogService catalog;

    @GetMapping("/internal/customization/catalog")
    public List<CustomizationCatalogItem> catalog() {
        return catalog.catalog();
    }
}
