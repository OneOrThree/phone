package com.oneorthree.phone.appearance.repository;

import com.oneorthree.phone.appearance.repository.domain.CatalogAsset;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

/**
 * 불변 자산 정의 조회 — 외양 적용의 kind·ownerType·대상 판정 정본.
 * 등록 writer 는 카탈로그 담당이며 이 도메인은 읽기만 한다.
 */
public interface CatalogAssetRepository extends JpaRepository<CatalogAsset, String> {

    /**
     * 주어진 상품 중 바다 보상으로 줄 수 있는 고양이 잡지 재료 — 부가 정보가 {@code season} 이고 퇴역하지 않은 것
     * (GROMO-2289). 무료 재료는 모두가 이미 가진 것이라 «새로 받음» 이 아니고, 부가 정보가 없는 재료는 꾸미기 서랍에
     * 보이지 않는다. 표는 잡지 쪽 것이지만 SQL 은 참조가 아니다 — 레이어 방향(appearance 7 → magazine 8)을 거스르지 않으려고
     * 엔티티 대신 네이티브 문장으로 읽는다.
     *
     * @param productIds 비어 있으면 안 된다
     */
    @Query(value = "SELECT m.product_id FROM magazine_asset_meta m WHERE m.bundle = 'season' "
            + "AND m.retired_at IS NULL AND m.product_id IN (:productIds)", nativeQuery = true)
    List<String> findGrantableMagazineSeasonIds(@Param("productIds") Collection<String> productIds);
}
