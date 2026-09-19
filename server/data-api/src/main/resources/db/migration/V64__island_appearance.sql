-- ════════════════════════════════════════════════════════════════════
-- V64 — 보유품·외양 Data API (GROMO-1783 · island-appearance LLD §2)
-- ════════════════════════════════════════════════════════════════════
-- 개인 외양과 섬 공동 외양·인벤토리·버전은 서로 다른 축이다. 레거시 item/
-- character_equipment 자산은 이관하지 않고, raft 에는 소유·지급·주문 행을
-- 만들지 않는다(예약 표현).

-- 1) 카탈로그 불변 자산 정의 — 상점(1781)의 asset definition 정본. 외양 적용은
--    활성 판매 publication이 아니라 이 불변 의미로 해석한다 — 퇴역해도 보유품
--    해석이 유지된다. kind·ownerType·targetBuilding 은 productId 수명 동안 불변이라
--    갱신 경로가 없고, 조합 제약은 CHECK 가 상주 감시한다.
CREATE TABLE catalog_assets (
    product_id      varchar(80) PRIMARY KEY,
    title           varchar(120) NOT NULL,
    kind            varchar(20) NOT NULL,
    owner_type      varchar(10) NOT NULL,
    target_building varchar(30),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT catalog_assets_kind_check
        CHECK (kind IN ('clothes', 'decor', 'island_theme', 'building_theme', 'audio')),
    CONSTRAINT catalog_assets_owner_type_check
        CHECK (owner_type IN ('user', 'island')),
    CONSTRAINT catalog_assets_kind_owner_check
        CHECK ((kind IN ('clothes', 'decor') AND owner_type = 'user')
            OR (kind IN ('island_theme', 'building_theme', 'audio') AND owner_type = 'island')),
    -- building_theme 만 대상 건물을 갖는다 — 그 외 kind 의 target_building 은 NULL.
    CONSTRAINT catalog_assets_target_building_check
        CHECK ((kind = 'building_theme') = (target_building IS NOT NULL))
);

-- 2) 보유 상품 — (주인, 상품) 유일. 주인은 user 또는 island(groups) 정확히 하나다.
--    granted_ref 는 주문 ID 또는 명시 지급 근거다 — 구매 writer(1781)가 채운다.
CREATE TABLE owned_products (
    id          uuid PRIMARY KEY,
    owner_type  varchar(10) NOT NULL,
    user_id     uuid REFERENCES users (id) ON DELETE RESTRICT,
    group_id    uuid REFERENCES groups (id) ON DELETE RESTRICT,
    product_id  varchar(80) NOT NULL REFERENCES catalog_assets (product_id) ON DELETE RESTRICT,
    granted_ref varchar(120),
    granted_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT owned_products_owner_type_check
        CHECK (owner_type IN ('user', 'island')),
    CONSTRAINT owned_products_owner_check
        CHECK ((owner_type = 'user' AND user_id IS NOT NULL AND group_id IS NULL)
            OR (owner_type = 'island' AND group_id IS NOT NULL AND user_id IS NULL))
);

-- (주인, 상품) 유일 — 부분 유일 인덱스로 owner 축을 정확히 하나만 잠근다.
CREATE UNIQUE INDEX uq_owned_products_user ON owned_products (user_id, product_id)
    WHERE owner_type = 'user';
CREATE UNIQUE INDEX uq_owned_products_island ON owned_products (group_id, product_id)
    WHERE owner_type = 'island';
CREATE INDEX idx_owned_products_user ON owned_products (user_id)
    WHERE owner_type = 'user';
CREATE INDEX idx_owned_products_island ON owned_products (group_id)
    WHERE owner_type = 'island';

-- 3) 개인 외양 — 유저당 한 행의 전체 상태. version 은 행 배타 잠금 아래에서만
--    올라가며, member.appearance.updated 의 aggregateVersion 이다.
--    hull 은 배 종류 폐지(GROMO-1851)로 'raft' 하나다 — 상품이 아니라 예약 표현.
CREATE TABLE personal_appearances (
    user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE RESTRICT,
    clothes    varchar(80) REFERENCES catalog_assets (product_id) ON DELETE RESTRICT,
    decor      varchar(80) REFERENCES catalog_assets (product_id) ON DELETE RESTRICT,
    hull       varchar(20) NOT NULL DEFAULT 'raft' CHECK (hull = 'raft'),
    position   varchar(10) NOT NULL DEFAULT 'front' CHECK (position IN ('front', 'back')),
    version    bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4) 섬 외양 — 섬(groups)당 한 행. building_themes 는 「완공 건물 → ThemeId|default」의
--    <b>전체 맵</b>이다 — key 집합은 외양 대상 완공 건물 집합과 같아야 하므로 writer
--    (테마 PATCH·시설 완공)만 이 맵을 갱신하고 GET 은 즉석에서 채우지 않는다(LLD §2).
CREATE TABLE island_appearances (
    island_id       uuid PRIMARY KEY REFERENCES groups (id) ON DELETE RESTRICT,
    island_theme_id varchar(80) NOT NULL DEFAULT 'default',
    building_themes jsonb NOT NULL DEFAULT '{}'::jsonb,
    version         bigint NOT NULL DEFAULT 0,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 5) 기존 섬·완공 시설 백필 — 「key 집합 = 완공 건물 집합」불변식을 배포 전 데이터에도
--    적용해, 완공 건물이 이미 있는 섬도 GET 이 같은 전체 맵을 보게 한다. BUILDING 행은
--    완공 전이라 key 를 만들지 않는다. 기존 행이 있으면 그 key 는 보존하고 누락 key 만
--    'default' 로 채운다 — jsonb || 는 우측이 이기므로 기존 맵을 우측에 둔다.
--    ON CONFLICT 로 재실행해도 멱등이다(지갑·건설 상태의 V62 백필과 같은 방식).
--    이 INSERT 는 파일의 마지막 문장이어야 한다 — V64 테스트가 이 문장만 떼어 재실행한다.
INSERT INTO island_appearances (island_id, building_themes)
SELECT g.id, COALESCE(t.themes, '{}'::jsonb)
FROM groups g
LEFT JOIN (
    SELECT island_id, jsonb_object_agg(building_id, 'default') AS themes
    FROM island_facilities
    WHERE status = 'COMPLETED'
    GROUP BY island_id
) t ON t.island_id = g.id
ON CONFLICT (island_id) DO UPDATE
SET building_themes = EXCLUDED.building_themes || island_appearances.building_themes;
