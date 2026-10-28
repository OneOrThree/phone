-- 집중 꾸미기 보상 데이터 계약 (GROMO-2313).
-- 기존 sea_reward_tiers 와 분리한다. 정산 시 추첨·중복 획득 기록은 2301이 이 데이터를 소비한다.
-- 이 마이그레이션은 지급이나 장착 API를 활성화하지 않는다.
CREATE TABLE customization_reward_policies (
    revision integer PRIMARY KEY CHECK (revision > 0),
    minimum_active_seconds integer NOT NULL CHECK (minimum_active_seconds > 0),
    rare_unlock_seconds integer NOT NULL,
    legendary_unlock_seconds integer NOT NULL,
    time_half_seconds integer NOT NULL CHECK (time_half_seconds > 0),
    rare_max_bonus_ppm integer NOT NULL CHECK (rare_max_bonus_ppm BETWEEN 0 AND 1000000),
    legendary_max_bonus_ppm integer NOT NULL CHECK (legendary_max_bonus_ppm BETWEEN 0 AND 1000000),
    rewards_per_eligible_session integer NOT NULL CHECK (rewards_per_eligible_session = 1),
    duplicates_allowed boolean NOT NULL CHECK (duplicates_allowed),
    location_weights jsonb NOT NULL CHECK (jsonb_typeof(location_weights) = 'object'),
    category_weights jsonb NOT NULL CHECK (jsonb_typeof(category_weights) = 'object'),
    source_workbook_sha256 char(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customization_reward_unlock_order CHECK (
        minimum_active_seconds <= rare_unlock_seconds
        AND rare_unlock_seconds <= legendary_unlock_seconds
    )
);

-- category 는 장착 슬롯과 다르다: 뗏목 6개 분류는 catalog_assets.kind='decor'인 개인 장식이다.
-- render_data 는 버전 있는 원본·크롭·자세 보정 자료다. 기존 정적 오버레이 meta 에 시트를 그대로 넣지 않는다.
CREATE TABLE customization_reward_items (
    revision integer NOT NULL REFERENCES customization_reward_policies (revision) ON DELETE RESTRICT,
    product_id varchar(80) NOT NULL REFERENCES catalog_assets (product_id) ON DELETE RESTRICT,
    source_asset_id varchar(80) NOT NULL,
    category varchar(10) NOT NULL CHECK (
        category IN ('head', 'neck', 'shoes', 'flag', 'mat', 'oar', 'cargo', 'lantern', 'canopy')
    ),
    rarity varchar(10) NOT NULL CHECK (rarity IN ('common', 'uncommon', 'rare', 'legendary')),
    rarity_reason varchar(200) NOT NULL,
    render_data jsonb NOT NULL CHECK (jsonb_typeof(render_data) = 'object'),
    sort_order integer NOT NULL CHECK (sort_order >= 0),
    PRIMARY KEY (revision, product_id),
    UNIQUE (revision, source_asset_id)
);
CREATE INDEX idx_customization_reward_items_draw
    ON customization_reward_items (revision, category, rarity);
