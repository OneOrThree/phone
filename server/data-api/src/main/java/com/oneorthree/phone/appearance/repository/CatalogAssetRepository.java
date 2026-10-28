package com.oneorthree.phone.appearance.repository;

import com.oneorthree.phone.appearance.repository.domain.CatalogAsset;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 불변 자산 정의 조회 — 외양 적용의 kind·ownerType·대상 판정 정본.
 * 등록 writer 는 카탈로그 담당이며 이 도메인은 읽기만 한다.
 */
public interface CatalogAssetRepository extends JpaRepository<CatalogAsset, String> {
}
