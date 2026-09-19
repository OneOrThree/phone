-- ════════════════════════════════════════════════════════════════════
-- V71 — 섬 퀘스트 Data API (GROMO-1773 · island-quests LLD §3)
-- ════════════════════════════════════════════════════════════════════
-- 정의 · 회차(정의 스냅샷) · 회차 시작 cohort · 섬 단위 정산 네 단위다. 날짜·창 축은
-- UTC 다(2026-09-19 결정 Q-6). 보상은 전부 섬 통장(island_wallets)으로 가므로 개인 지갑
-- 참조가 없다(결정 Q-1). 기존 챌린지·내기 테이블은 건드리지 않는다(LLD §3).
-- 번호 V66~V70 은 먼저 열린 PR(#814 V66 · #815 V67 · 후속)이 쓰도록 비워 둔다.

-- 1) 퀘스트 정의 — 방장이 만들고 고친다(D3). focus 만 UTC 창을 갖고, 창은 자정을
--    넘지 않는다(회차가 UTC 하루라서). PATCH 는 revision 을 올리고 다음 회차부터 적용된다.
CREATE TABLE island_quests (
    id             uuid PRIMARY KEY,
    island_id      uuid NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
    type           varchar(10) NOT NULL,
    title          varchar(40) NOT NULL,
    target_minutes integer NOT NULL,
    window_start   time,
    window_end     time,
    revision       integer NOT NULL DEFAULT 1,
    created_by     uuid NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT island_quests_type_check CHECK (type IN ('FOCUS', 'SCREEN')),
    CONSTRAINT island_quests_target_check CHECK (target_minutes BETWEEN 1 AND 1440),
    CONSTRAINT island_quests_window_check
        CHECK ((type = 'FOCUS' AND window_start IS NOT NULL AND window_end IS NOT NULL
                    AND window_start < window_end)
            OR (type = 'SCREEN' AND window_start IS NULL AND window_end IS NULL))
);

CREATE INDEX idx_island_quests_island ON island_quests (island_id);

-- 2) 회차 — (퀘스트, UTC 날짜) 유일. 여는 순간 정의와 보상 설정을 복사한다(정의 PATCH 가
--    열린 회차를 바꾸지 않는 근거). version 은 quest.progress 축의 마지막 발급값이다.
CREATE TABLE island_quest_occurrences (
    id                      uuid PRIMARY KEY,
    quest_id                uuid NOT NULL REFERENCES island_quests (id) ON DELETE RESTRICT,
    island_id               uuid NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
    occurrence_date         date NOT NULL,
    definition_revision     integer NOT NULL,
    type                    varchar(10) NOT NULL,
    title                   varchar(40) NOT NULL,
    target_minutes          integer NOT NULL,
    window_start            time,
    window_end              time,
    reward_per_achiever     integer NOT NULL CHECK (reward_per_achiever >= 0),
    reward_bonus_per_member integer NOT NULL CHECK (reward_bonus_per_member >= 0),
    version                 bigint NOT NULL,
    claimed_at              timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_island_quest_occurrence UNIQUE (quest_id, occurrence_date),
    CONSTRAINT island_quest_occurrences_type_check CHECK (type IN ('FOCUS', 'SCREEN'))
);

CREATE INDEX idx_island_quest_occurrences_island_date
    ON island_quest_occurrences (island_id, occurrence_date);

-- 3) 회차 시작 cohort — 여는 순간의 활성 주민(결정 Q-3). 이후 가입자는 없고, 탈퇴·강퇴·
--    계정 탈퇴자는 판정 때 현재 활성 멤버와의 교집합에서 빠진다. user_id 는 FK 없이
--    둔다 — 탈퇴 뒤에도 회차 정산 근거(누가 대상이었나)의 행 수가 바뀌지 않게 한다.
CREATE TABLE island_quest_cohort_members (
    occurrence_id uuid NOT NULL REFERENCES island_quest_occurrences (id) ON DELETE RESTRICT,
    user_id       uuid NOT NULL,
    PRIMARY KEY (occurrence_id, user_id)
);

-- 4) 정산 — 도메인 유일 (섬, 회차, kind). 요청 키 멱등과 별개로 다른 키의 동시 수령을
--    지급 1회로 묶는다(Q06). 원장 기입은 island_wallet_transactions(QUEST_SETTLEMENT)이다.
CREATE TABLE island_quest_claims (
    id                     uuid PRIMARY KEY,
    island_id              uuid NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
    occurrence_id          uuid NOT NULL REFERENCES island_quest_occurrences (id) ON DELETE RESTRICT,
    kind                   varchar(20) NOT NULL,
    amount                 integer NOT NULL CHECK (amount > 0),
    claimed_by             uuid NOT NULL,
    wallet_idempotency_key varchar(200) NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_island_quest_claim UNIQUE (island_id, occurrence_id, kind),
    CONSTRAINT island_quest_claims_kind_check CHECK (kind IN ('SETTLEMENT'))
);
