package com.oneorthree.phone.appearance.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 꾸미기 카탈로그 조회 (GROMO-2331) — 그림 정보가 있는 상품만, 퇴역 표시를 포함해 내린다. 행이 수백 개 이하라 캐시하지 않는다.
 * 정적 오버레이 뒤에 집중 보상 머리·목(GROMO-2382)을 붙인다 — 같은 상품에 정적 오버레이가 있으면 그쪽이 이긴다.
 */
@Service
@RequiredArgsConstructor
public class CustomizationCatalogService {

    // 저장소 JSON 은 Jackson 2 로 읽는다 — 컨텍스트의 Jackson 3 빈을 주입받지 않는다(NotificationMigrationCliRunner 와 같은 이유).
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final TypeReference<Map<String, Object>> OBJECT = new TypeReference<>() { };

    private final CustomizationAssetMetaRepository metas;
    private final CatalogAssetRepository catalogAssets;

    @Transactional(readOnly = true)
    public List<CustomizationCatalogItem> catalog() {
        List<CustomizationAssetMeta> rows = metas.findAllByOrderBySortOrderAscProductIdAsc();
        Map<String, CatalogAsset> assets = catalogAssets
                .findAllById(rows.stream().map(CustomizationAssetMeta::getProductId).toList()).stream()
                .collect(Collectors.toMap(CatalogAsset::getProductId, Function.identity()));
        Set<String> overlays = assets.keySet();
        Stream<CustomizationCatalogItem> statics = rows.stream()
                .map(m -> new CustomizationCatalogItem(m.getProductId(), m.getKind(), m.getSlot(),
                        assets.get(m.getProductId()).getTitle(), m.getImagePath(), m.getWidth(), m.getHeight(),
                        m.getAnchorX(), m.getAnchorY(), m.getSortOrder(), m.getRetiredAt(), null));
        Stream<CustomizationCatalogItem> rewards = metas.findCatRewardRenders().stream()
                .filter(r -> !overlays.contains(r.getProductId()))
                .map(r -> new CustomizationCatalogItem(r.getProductId(), r.getKind(), r.getKind(), r.getTitle(),
                        r.getImagePath(), null, null, null, null, r.getSortOrder(), null,
                        renderData(r.getRenderData())));
        return Stream.concat(statics, rewards).toList();
    }

    private static Map<String, Object> renderData(String json) {
        try {
            return JSON.readValue(json, OBJECT);
        } catch (JsonProcessingException e) {
            // jsonb CHECK 가 객체만 받으므로 여기 오면 DB 가 깨진 것이다
            throw new IllegalStateException("render_data 를 읽지 못했습니다", e);
        }
    }
}
