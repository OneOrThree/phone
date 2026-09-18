-- ════════════════════════════════════════════════════════════════════
-- V62 — 섬 건설 1단계 Data API (GROMO-1767 · island-construction LLD §4)
-- ════════════════════════════════════════════════════════════════════
-- 「섬」은 groups 다 — 별도 섬 테이블을 만들지 않는다(island-membership 선례).
-- enum 은 프로젝트 컨벤션(@Enumerated STRING → varchar + CHECK)을 따른다.

-- 1) 섬 물고기 지출 권한(건설 실행·공동 구매) — 섬 설정, 방장 토글 (정책 C13, 2026-09-18 D2).
--    판정 이름은 SHARED_PURCHASE 다. 토글 기본값은 D2 결정에 없지만 P-D01 잔여가 "기본값을
--    발명하지 않는다"고 했으므로 보존적 기본값 OWNER_ONLY 로 둔다 — 토글 API 는 이번 범위 밖.
ALTER TABLE groups
    ADD COLUMN shared_purchase_permission varchar(20) NOT NULL DEFAULT 'OWNER_ONLY',
    ADD CONSTRAINT groups_shared_purchase_permission_check
        CHECK (shared_purchase_permission IN ('OWNER_ONLY', 'ALL_MEMBERS'));

-- 2) 섬 공동 지갑 (정책 C05, D1) — 서버 통화 식별자 village_points. 개인 fish 지갑
--    (user_wallets)과 다른 축이다. 잔액 변경은 행 배타락 아래에서만 한다.
CREATE TABLE island_wallets (
    island_id  uuid PRIMARY KEY REFERENCES groups (id) ON DELETE RESTRICT,
    balance    integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
    version    bigint NOT NULL DEFAULT 0,  -- JPA @Version 낙관락 (user_wallets 와 같은 방식)
    updated_at timestamptz
);

-- 기존 섬 전부 0원 지갑 backfill — 지갑 부재로 건설 조회가 깨지지 않게 한다.
INSERT INTO island_wallets (island_id, balance, version)
SELECT id, 0, 0 FROM groups;

-- 3) 섬 공동 원장 — user 지갑의 currency_transactions 와 같은 책임의 섬 축 원장.
--    amount 는 항상 양수, 방향은 type 이 표현한다. idempotency_key 는 중복 기입의 최후 방어선 —
--    멱등 scope 는 LLD 와 같은 (섬, operation=type, 키)라 유일키도 그 세 축의 복합이다.
CREATE TABLE island_wallet_transactions (
    id              uuid PRIMARY KEY,
    island_id       uuid NOT NULL REFERENCES island_wallets (island_id) ON DELETE RESTRICT,
    amount          integer NOT NULL CHECK (amount > 0),
    type            varchar(40) NOT NULL,
    idempotency_key varchar(200),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_island_wallet_tx_idem UNIQUE (island_id, type, idempotency_key)
);

-- 4) 불변 비용 정책 revision + 현재 publication (정책 C10). revision 은 한 번 쓰면
--    바꾸지 않고, 현재 번호는 publication 포인터가 가리킨다. POST 는 이 포인터 행을 잠그고
--    expectedCostPolicyVersion 을 비교한다 — 검증 직후 가격만 교체되는 경합을 막는다(LLD §2).
CREATE TABLE construction_cost_policies (
    revision      integer NOT NULL,
    building_id   varchar(30) NOT NULL,
    cost          integer NOT NULL CHECK (cost >= 0),
    build_seconds integer NOT NULL CHECK (build_seconds >= 0),
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (revision, building_id)
);

CREATE TABLE construction_cost_policy_publication (
    singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    revision     integer NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now()
);

-- 첫 publication (정책 P-D03 잔여) — 「건설 가격·공사 시간」 표(1829 코멘트 #11077, D4 확정).
-- 회관→게시판→축음기(방송기 gram)→도서관→우체통→전망대→상점, 선형 7단계.
INSERT INTO construction_cost_policies (revision, building_id, cost, build_seconds) VALUES
    (1, 'hall',    60,    60),   -- 회관    60마리  · 1분
    (1, 'board',  240,   900),   -- 게시판  240마리 · 15분
    (1, 'gram',  1360,  1800),   -- 축음기 1360마리 · 30분 (기획명 축음기 = 서버명 방송기 gram, C14)
    (1, 'library', 2720, 3600),  -- 도서관 2720마리 · 1시간 (기능 GROMO-1822 미확정, C14)
    (1, 'mail',  4080,  5400),   -- 우체통 4080마리 · 1시간 30분
    (1, 'tower', 5440,  9000),   -- 전망대 5440마리 · 2시간 30분
    (1, 'shop',  6800, 14400);   -- 상점   6800마리 · 4시간

INSERT INTO construction_cost_policy_publication (singleton, revision) VALUES (true, 1);

-- 5) 섬 건설 상태/목표 — target 은 차감 없는 선택(C03)이라 지갑과 다른 테이블에 둔다.
--    target_epoch 는 목표가 바뀔 때마다 +1 — 「각자 몫 n빵」은 목표를 고른 뒤부터 모은
--    물고기로 판단하므로(정책 P-D04) epoch 으로 기여 집계 범위를 자른다.
CREATE TABLE island_construction_states (
    island_id           uuid PRIMARY KEY REFERENCES groups (id) ON DELETE RESTRICT,
    target_building_id  varchar(30),
    target_epoch        bigint NOT NULL DEFAULT 0,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz
);

INSERT INTO island_construction_states (island_id) SELECT id FROM groups;

-- 6) 목표 epoch 주민별 기여 (P-D04) — 「물고기 잔액과 주민별 누적 획득 기록은 구분한다」.
--    같은 epoch 안에서는 사용자당 한 행에 amount 를 누적한다.
CREATE TABLE island_construction_contributions (
    island_id  uuid NOT NULL REFERENCES island_construction_states (island_id) ON DELETE RESTRICT,
    epoch      bigint NOT NULL,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    amount     integer NOT NULL DEFAULT 0 CHECK (amount >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (island_id, epoch, user_id)
);

-- 7) 섬 시설 — (섬, buildingId) 유일(LLD §4). status 는 BUILDING → COMPLETED 단방향이며
--    완료한 시설의 재건설은 유일성이 막는다(정책 C06). 공사 완료는 스케줄러가
--    completes_at <= now() 인 BUILDING 행을 쓸어 COMPLETED 로 전이한다.
CREATE TABLE island_facilities (
    island_id      uuid NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
    building_id    varchar(30) NOT NULL,
    status         varchar(20) NOT NULL CHECK (status IN ('BUILDING', 'COMPLETED')),
    cost           integer NOT NULL CHECK (cost >= 0),
    cost_revision  integer NOT NULL,
    -- 건설을 확정한 주민 — 스케줄러가 발행하는 완공 island.updated 봉투의 주체 참조다.
    started_by     uuid,
    started_at     timestamptz,
    completes_at   timestamptz,
    completed_at   timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (island_id, building_id)
);

-- 완공 스윕은 status='BUILDING' 인 행을 completes_at 순으로만 훑는다 — 부분 인덱스.
CREATE INDEX idx_island_facilities_due ON island_facilities (completes_at) WHERE status = 'BUILDING';

COMMENT ON TABLE island_wallets IS
    '섬 공동 지갑 (village_points) — GROMO-1767, island-construction 정책 C05/D1. 개인 user_wallets 와 다른 축';
COMMENT ON TABLE construction_cost_policies IS
    '불변 건설 비용 revision — 정책 C10. 「건설 가격·공사 시간」표(D4)가 revision 1';
COMMENT ON TABLE island_facilities IS
    '섬 시설 (섬+buildingId 유일) — BUILDING 은 스케줄러가 completes_at 경과 시 COMPLETED 로 전이';
