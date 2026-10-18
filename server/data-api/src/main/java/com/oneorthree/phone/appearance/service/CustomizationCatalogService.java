package com.oneorthree.phone.appearance.service;

import com.oneorthree.phone.appearance.dto.CustomizationCatalogItem;
import com.oneorthree.phone.appearance.repository.CatalogAssetRepository;
import com.oneorthree.phone.appearance.repository.CustomizationAssetMetaRepository;
import com.oneorthree.phone.appearance.repository.domain.CatalogAsset;
import com.oneorthree.phone.appearance.repository.domain.CustomizationAssetMeta;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/** 꾸미기 카탈로그 조회 (GROMO-2331) — 그림 정보가 있는 상품만, 퇴역 표시를 포함해 내린다. 행이 수백 개 이하라 캐시하지 않는다. */
@Service
@RequiredArgsConstructor
public class CustomizationCatalogService {

    private final CustomizationAssetMetaRepository metas;
    private final CatalogAssetRepository catalogAssets;

    @Transactional(readOnly = true)
    public List<CustomizationCatalogItem> catalog() {
        List<CustomizationAssetMeta> rows = metas.findAllByOrderBySortOrderAscProductIdAsc();
        Map<String, CatalogAsset> assets = catalogAssets
                .findAllById(rows.stream().map(CustomizationAssetMeta::getProductId).toList()).stream()
                .collect(Collectors.toMap(CatalogAsset::getProductId, Function.identity()));
        return rows.stream()
                .map(m -> new CustomizationCatalogItem(m.getProductId(), m.getKind(), m.getSlot(),
                        assets.get(m.getProductId()).getTitle(), m.getImagePath(), m.getWidth(), m.getHeight(),
                        m.getAnchorX(), m.getAnchorY(), m.getSortOrder(), m.getRetiredAt()))
                .toList();
    }
}
