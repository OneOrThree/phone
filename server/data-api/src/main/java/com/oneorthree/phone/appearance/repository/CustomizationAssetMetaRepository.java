package com.oneorthree.phone.appearance.repository;

import com.oneorthree.phone.appearance.repository.domain.CustomizationAssetMeta;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

/** 개인 꾸미기 상품의 그림 정보 (GROMO-2331) — 읽기 전용. */
public interface CustomizationAssetMetaRepository extends JpaRepository<CustomizationAssetMeta, String> {

    List<CustomizationAssetMeta> findAllByOrderBySortOrderAscProductIdAsc();
}
