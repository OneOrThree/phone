-- GROMO-1764: 집중 세션 수명주기(v0.3) 상세·구간·정산.
-- focus_sessions(레거시)의 PK를 그대로 공유하는 1:1 상세다 — 새 프로토콜 여부는 이 행의 존재로 가른다.
-- 레거시 enum(focus_session_status)은 건드리지 않는다 — 새 lifecycle은 이 테이블의 컬럼으로 별도 해석한다.

CREATE TABLE focus_session_details (
    session_id                  uuid PRIMARY KEY REFERENCES focus_sessions(id) ON DELETE CASCADE,
    user_id                     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    island_id                   uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    membership_epoch_at_start   bigint NOT NULL,
    subject                     varchar(200) NOT NULL,
    target_minutes              integer NOT NULL,
    lifecycle                   varchar(10) NOT NULL CHECK (lifecycle IN ('ACTIVE', 'PAUSED', 'COMPLETED')),
    version                     bigint NOT NULL DEFAULT 1,
    last_transition_at          timestamptz NOT NULL,
    policy_revision             integer,
    rest_seat                   integer,
    created_at                  timestamptz NOT NULL DEFAULT now()
);

-- 사용자당 진행 세션(active/paused) 하나 — FR-P02. 완료 행은 이 제약 밖이라 여러 건 쌓여도 된다.
CREATE UNIQUE INDEX focus_session_details_user_progressing_uk
    ON focus_session_details (user_id)
    WHERE lifecycle IN ('ACTIVE', 'PAUSED');

-- 같은 섬의 두 paused 사용자에게 같은 휴식 자리를 주지 않는다 (LLD §2 pause).
CREATE UNIQUE INDEX focus_session_details_rest_seat_uk
    ON focus_session_details (island_id, rest_seat)
    WHERE lifecycle = 'PAUSED';

CREATE INDEX focus_session_details_user_id_idx ON focus_session_details (user_id);

COMMENT ON TABLE focus_session_details IS
    'GROMO-1764: v0.3 집중 세션 상세(섬 귀속·subject·목표·lifecycle·낙관 버전). focus_sessions 1:1.';

-- ACTIVE/REST 구간 — [started_at, ended_at) 반열림, 열린 구간은 세션당 최대 1개.
CREATE TABLE focus_session_intervals (
    id          bigserial PRIMARY KEY,
    session_id  uuid NOT NULL REFERENCES focus_session_details(session_id) ON DELETE CASCADE,
    ordinal     integer NOT NULL,
    kind        varchar(10) NOT NULL CHECK (kind IN ('ACTIVE', 'REST')),
    started_at  timestamptz NOT NULL,
    ended_at    timestamptz,
    CONSTRAINT focus_session_intervals_order_ck CHECK (ended_at IS NULL OR ended_at >= started_at),
    CONSTRAINT focus_session_intervals_ordinal_uk UNIQUE (session_id, ordinal)
);

-- 세션당 열린 구간(진행 중) 최대 1개 — pause/resume가 원자적으로 하나를 닫고 다음을 열지 않으면 위반된다.
CREATE UNIQUE INDEX focus_session_intervals_open_uk
    ON focus_session_intervals (session_id)
    WHERE ended_at IS NULL;

COMMENT ON TABLE focus_session_intervals IS
    'GROMO-1764: v0.3 세션의 ACTIVE/REST 실제 서버 시간 구간. ordinal 유일, 열린 구간 최대 1개.';

-- 세션당 정산 결과 1건 — 다른 idempotency-key로의 완료 재생·중복 지급 방어의 정본.
-- 2026-09: 보상 정책(FR-D01~06)이 미확정이라 지급 경로가 비활성이고, 이 표는 아직 쓰는 코드가 없다
-- (server/data-api FocusSessionLifecycleService.finish가 정책 게이트에서 항상 막는다). 활성화 시
-- 이 표에 실제로 쓰기 시작한다 — 스키마를 지금 고정해 그때 새 마이그레이션 없이 붙을 수 있게 한다.
CREATE TABLE focus_settlements (
    session_id                uuid PRIMARY KEY REFERENCES focus_session_details(session_id) ON DELETE RESTRICT,
    contract_version          integer NOT NULL DEFAULT 1,
    policy_revision           integer,
    active_seconds            bigint NOT NULL,
    goal_achieved             boolean NOT NULL,
    earned_fish               integer NOT NULL DEFAULT 0,
    personal_fish_added       integer NOT NULL DEFAULT 0,
    construction_fish_added   integer NOT NULL DEFAULT 0,
    quest_progress            jsonb,
    events                    jsonb,
    completed_at              timestamptz NOT NULL,
    created_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE focus_settlements IS
    'GROMO-1764: v0.3 세션당 정산 결과(금액 보존식 E=P+C). 보상 정책 확정 전까지 미사용 — 스키마만 선반영.';
