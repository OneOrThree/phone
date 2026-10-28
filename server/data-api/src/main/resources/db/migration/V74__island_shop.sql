-- ════════════════════════════════════════════════════════════════════
-- V74 — 섬 상점 테이블 선구축 (GROMO-1781 · island-shop LLD §3)
-- ════════════════════════════════════════════════════════════════════
-- 2026-09-19 재영님 결정: 테이블만 먼저 만든다 — 엔드포인트·구매 로직·가격 데이터는 없다.
-- 가격은 추후 확정(S03·S04) 뒤 채운다. 그래서 이 파일은 행을 하나도 심지 않는다 —
-- 활성 publication 이 없으면 판매 상품도 없다(구매 비활성). 가격을 0 으로 위장하지 않는다.
--
-- 자산 정의는 V64 catalog_assets, 소유는 V64 owned_products(granted_ref = 주문 ID)를 그대로 쓴다.
-- 결제 지갑은 V62 island_wallets(village_points) 하나다 — 모든 재화는 섬 귀속(2026-09-19 결정).
-- island_wallet_transactions.type 은 DB CHECK 가 없어 상점 차감 값을 여기서 더하지 않는다.

-- 1) 판매 revision — (productId, revision) 유일, 발행 후 불변. 제목·kind·ownerType 은
--    catalog_assets 가 정본이라 여기 중복하지 않는다. price NULL = 승인 가격 없음 → 구매 불가.
CREATE TABLE shop_product_revisions (
    product_id          varchar(80) NOT NULL REFERENCES catalog_assets (product_id) ON DELETE RESTRICT,
    revision            integer NOT NULL CHECK (revision >= 1),
    currency            varchar(20) NOT NULL DEFAULT 'village_points',
    price               integer,
    required_building   varchar(30),
    required_product_id varchar(80) REFERENCES catalog_assets (product_id) ON DELETE RESTRICT,
    preview_media_key   varchar(200),
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, revision),
    -- 모든 재화는 섬 통장(섬 물고기) — 개인 fish 통화는 결정 전까지 받지 않는다.
    CONSTRAINT shop_product_revisions_currency_check CHECK (currency IN ('village_points')),
    -- 0원 판매는 없다 — 미승인은 NULL 로만 표현한다(정책 S03).
    CONSTRAINT shop_product_revisions_price_check CHECK (price IS NULL OR price > 0),
    CONSTRAINT shop_product_revisions_required_self_check CHECK (required_product_id <> product_id)
);

-- 2) 컬렉션 발행본 — catalogPublicationVersion 유일. 퇴역·폐기 시각만 나중에 채운다.
CREATE TABLE shop_catalog_publications (
    version        bigint PRIMARY KEY CHECK (version >= 1),
    published_at   timestamptz NOT NULL DEFAULT now(),
    retired_at     timestamptz,
    invalidated_at timestamptz
);

-- 3) 발행본 항목 — 한 발행본의 상품 집합·정렬을 복원한다(cursor 는 발행본을 고정).
CREATE TABLE shop_catalog_publication_entries (
    publication_version bigint NOT NULL REFERENCES shop_catalog_publications (version) ON DELETE RESTRICT,
    product_id          varchar(80) NOT NULL,
    product_revision    integer NOT NULL,
    category            varchar(20) NOT NULL,
    display_order       integer NOT NULL,
    PRIMARY KEY (publication_version, product_id),
    FOREIGN KEY (product_id, product_revision)
        REFERENCES shop_product_revisions (product_id, revision) ON DELETE RESTRICT,
    CONSTRAINT shop_catalog_publication_entries_category_check
        CHECK (category IN ('personal', 'island', 'sound'))
);

-- catalog 목록 keyset — (displayOrder ASC, productId ASC), category 필터.
CREATE INDEX idx_shop_catalog_entries_page
    ON shop_catalog_publication_entries (publication_version, category, display_order, product_id);

-- 4) 활성 포인터 — 싱글톤. 행이 없으면 활성 카탈로그가 없다(현재 상태).
CREATE TABLE shop_catalog_active_publication (
    singleton           boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    publication_version bigint NOT NULL REFERENCES shop_catalog_publications (version) ON DELETE RESTRICT,
    activated_at        timestamptz NOT NULL DEFAULT now()
);

-- 5) 주문 — 섬 하나에 귀속(BG18, 2026-09-19 결정). 결제 당시 revision·가격·통화를 불변 snapshot 으로.
--    payer 는 지금 섬 통장뿐이다. 개인 지갑 결제가 생기면 CHECK 를 넓혀 payer_type='user' +
--    payer_user_id 를 받는다 — 기존 행은 그대로 유효하다.
--    balance_after·analytics_delivered_at 은 currency_spent 내구 전달 의도(LLD §5) — 주문 id 가 분석 사건 id.
CREATE TABLE shop_orders (
    id                     uuid PRIMARY KEY,
    island_id              uuid NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
    requester_id           uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    owner_type             varchar(10) NOT NULL,
    product_id             varchar(80) NOT NULL,
    product_revision       integer NOT NULL,
    paid_price             integer NOT NULL CHECK (paid_price > 0),
    currency               varchar(20) NOT NULL,
    payer_type             varchar(10) NOT NULL DEFAULT 'island',
    payer_user_id          uuid REFERENCES users (id) ON DELETE RESTRICT,
    wallet_version_after   bigint NOT NULL CHECK (wallet_version_after >= 0),
    balance_after          integer NOT NULL CHECK (balance_after >= 0),
    analytics_delivered_at timestamptz,
    created_at             timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (product_id, product_revision)
        REFERENCES shop_product_revisions (product_id, revision) ON DELETE RESTRICT,
    -- owner 는 상품의 불변 ownerType — user 면 requester 본인, island 면 island_id 다.
    CONSTRAINT shop_orders_owner_type_check CHECK (owner_type IN ('user', 'island')),
    CONSTRAINT shop_orders_currency_check CHECK (currency IN ('village_points')),
    CONSTRAINT shop_orders_payer_check CHECK (payer_type = 'island' AND payer_user_id IS NULL)
);

-- 내역 keyset (createdAt DESC, id DESC) — shared 는 섬 전체, personal 은 섬 안의 본인.
CREATE INDEX idx_shop_orders_island ON shop_orders (island_id, created_at DESC, id DESC);
CREATE INDEX idx_shop_orders_island_requester
    ON shop_orders (island_id, requester_id, created_at DESC, id DESC);

COMMENT ON TABLE shop_product_revisions IS
    '상점 판매 revision — GROMO-1781, island-shop LLD §3. 발행 후 불변. price NULL = 승인 가격 없음(구매 불가, 정책 S03)';
COMMENT ON TABLE shop_orders IS
    '상점 주문 — GROMO-1781. 섬 귀속(BG18), 결제 snapshot 불변. 결제자는 섬 통장뿐(2026-09-19 결정)';
