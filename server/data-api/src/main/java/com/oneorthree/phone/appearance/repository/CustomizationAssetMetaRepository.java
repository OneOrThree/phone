package com.oneorthree.phone.appearance.repository;

import com.oneorthree.phone.appearance.repository.domain.CustomizationAssetMeta;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

/** 개인 꾸미기 상품의 그림 정보 (GROMO-2331) — 읽기 전용. */
public interface CustomizationAssetMetaRepository extends JpaRepository<CustomizationAssetMeta, String> {

    List<CustomizationAssetMeta> findAllByOrderBySortOrderAscProductIdAsc();

    /**
     * 집중 보상 머리·목의 그림 자료 (GROMO-2382) — 상품마다 가장 큰 revision 한 행, 보상 정렬 순서대로.
     * 추첨 대상에서 빠진 옛 revision 상품도 가진 사람이 있으니 그린다. 신발(보상에서 제외)과 뗏목 6분류(kind=decor)는 뺀다.
     * render_data 는 jsonb 원문(text)으로 읽는다.
     */
    @Query(value = "SELECT * FROM (SELECT DISTINCT ON (r.product_id) r.product_id AS \"productId\", "
            + "c.kind AS \"kind\", c.title AS \"title\", r.render_data #>> '{source,path}' AS \"imagePath\", "
            + "CAST(r.render_data AS text) AS \"renderData\", r.sort_order AS \"sortOrder\" "
            + "FROM customization_reward_items r JOIN catalog_assets c ON c.product_id = r.product_id "
            + "WHERE r.category IN ('head', 'neck') ORDER BY r.product_id, r.revision DESC) latest "
            + "ORDER BY \"sortOrder\", \"productId\"", nativeQuery = true)
    List<RewardRender> findCatRewardRenders();

    interface RewardRender {

        String getProductId();

        String getKind();

        String getTitle();

        String getImagePath();

        String getRenderData();

        int getSortOrder();
    }
}
