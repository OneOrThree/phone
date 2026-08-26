-- GROMO-814: 사용자 티어 단일 원천과 주간 정산 결과 로그를 추가한다.
ALTER TABLE users ADD COLUMN tier_level integer NOT NULL DEFAULT 1;
ALTER TABLE users ADD CONSTRAINT ck_users_tier_level CHECK (tier_level BETWEEN 1 AND 5);

CREATE TABLE league_weekly_results (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    week_start_at timestamptz NOT NULL,
    previous_tier_level integer NOT NULL CHECK (previous_tier_level BETWEEN 1 AND 5),
    new_tier_level integer NOT NULL CHECK (new_tier_level BETWEEN 1 AND 5),
    result varchar(16) NOT NULL CHECK (result IN ('PROMOTED', 'STAY', 'RELEGATED')),
    focus_seconds integer NOT NULL CHECK (focus_seconds >= 0),
    acknowledged_at timestamptz,
    created_at timestamptz NOT NULL,
    CONSTRAINT uq_league_weekly_results_user_week UNIQUE (user_id, week_start_at)
);

CREATE INDEX idx_league_weekly_results_user_created
    ON league_weekly_results (user_id, created_at DESC);
CREATE INDEX idx_league_weekly_results_week_result
    ON league_weekly_results (week_start_at, result);
