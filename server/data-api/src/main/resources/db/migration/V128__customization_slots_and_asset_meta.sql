-- GROMO-2331 개인 꾸미기 슬롯 3종(head · neck · shoes)과 카탈로그 이미지 메타 (바다 항해 후속 계약 §3, 결정 ④).
--
-- 1) catalog_assets 종류에 head·neck·shoes 를 더하고 셋 다 개인(user) 소유로 묶는다. 바다 보상(SeaFocusRewardService)이
--    개인 인벤토리에 넣고, 개인 외양(personal_appearances)의 새 슬롯에 장착한다.
-- 2) personal_appearances 에 head·neck·shoes 열 — 상품 FK, NULL = 미장착. hull 은 'raft' 고정 그대로다(뗏목 파츠는 GROMO-1851 뒤).
-- 3) customization_asset_meta: 앱이 그림을 그리는 데 필요한 부가 정보. catalog_assets 와 1:1 이고(magazine_asset_meta 선례)
--    카탈로그 행이 불변이라 이미지·크기·고정점·정렬·퇴역은 옆 표에 둔다.
--    kind: 카탈로그 종류의 사본(복합 FK 로 어긋나지 못한다) · slot: 앱 렌더 슬롯(지금은 kind 와 같다).
--    image_path: /static/customization/<kind>/<이름>.<sha8>.png (예 head/duck.9572baaf.png, product_id 는 cust.<kind>.<이름>) — 내용 해시가 파일명에 들어간 불변 URL 이다
--    (맵 에셋 정적 서빙 규칙 — 파일이 바뀌면 경로가 바뀐다, Cache-Control immutable).
--    anchor_x·anchor_y: 고양이 기준 정규화 좌표(0~1). retired_at: 서랍에서 내린 시각 — 이미 가진 사람은 계속 그린다.
--    시드 없음 — 운영 카탈로그 행은 운영 SQL 로 넣는다. 로컬 확인용 시드는 server/scripts/local/seed-customization.sql.
ALTER TABLE catalog_assets DROP CONSTRAINT catalog_assets_kind_check;
ALTER TABLE catalog_assets ADD CONSTRAINT catalog_assets_kind_check
    CHECK (kind IN ('clothes', 'decor', 'island_theme', 'building_theme', 'audio',
                    'ad_frame', 'ad_sticker', 'ad_tape', 'head', 'neck', 'shoes'));
ALTER TABLE catalog_assets DROP CONSTRAINT catalog_assets_kind_owner_check;
ALTER TABLE catalog_assets ADD CONSTRAINT catalog_assets_kind_owner_check
    CHECK ((kind IN ('clothes', 'decor', 'ad_frame', 'ad_sticker', 'ad_tape', 'head', 'neck', 'shoes')
            AND owner_type = 'user')
        OR (kind IN ('island_theme', 'building_theme', 'audio') AND owner_type = 'island'));

ALTER TABLE personal_appearances
    ADD COLUMN head  varchar(80) REFERENCES catalog_assets (product_id) ON DELETE RESTRICT,
    ADD COLUMN neck  varchar(80) REFERENCES catalog_assets (product_id) ON DELETE RESTRICT,
    ADD COLUMN shoes varchar(80) REFERENCES catalog_assets (product_id) ON DELETE RESTRICT;

CREATE TABLE customization_asset_meta (
    product_id varchar(80)   PRIMARY KEY,
    kind       varchar(20)   NOT NULL CHECK (kind IN ('clothes', 'decor', 'head', 'neck', 'shoes')),
    slot       varchar(10)   NOT NULL CHECK (slot IN ('clothes', 'decor', 'head', 'neck', 'shoes')),
    image_path varchar(200)  NOT NULL,
    width      integer       NOT NULL CHECK (width > 0),
    height     integer       NOT NULL CHECK (height > 0),
    anchor_x   numeric(5, 4) NOT NULL,
    anchor_y   numeric(5, 4) NOT NULL,
    sort_order integer       NOT NULL,
    retired_at timestamptz,
    CONSTRAINT customization_asset_meta_catalog_fk FOREIGN KEY (product_id, kind)
        REFERENCES catalog_assets (product_id, kind) ON DELETE RESTRICT
);
