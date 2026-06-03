#!/bin/bash
# 도커 DB 전체 초기화 스크립트
# 사용법: ./reset-db.sh [컨테이너명] [DB명] [유저명]
# 기본값: 0882f88e8f95 / dev / jajo

CONTAINER=${1:-0882f88e8f95}
DB=${2:-dev}
USER=${3:-jajo}

echo "컨테이너: $CONTAINER / DB: $DB / 유저: $USER"
echo "테이블 전체 초기화를 시작합니다..."

docker exec -i "$CONTAINER" psql -U "$USER" -d "$DB" <<'EOF'

-- 외래키 제약으로 인해 의존성 역순으로 DROP
DROP TABLE IF EXISTS room_invites             CASCADE;
DROP TABLE IF EXISTS friendships              CASCADE;
DROP TABLE IF EXISTS weekly_feedbacks         CASCADE;
DROP TABLE IF EXISTS daily_focus_stats        CASCADE;
DROP TABLE IF EXISTS share_cards              CASCADE;
DROP TABLE IF EXISTS currency_transactions    CASCADE;
DROP TABLE IF EXISTS user_streaks             CASCADE;
DROP TABLE IF EXISTS league_group_members     CASCADE;
DROP TABLE IF EXISTS league_groups            CASCADE;
DROP TABLE IF EXISTS league_tier_configs      CASCADE;
DROP TABLE IF EXISTS focus_sessions           CASCADE;
DROP TABLE IF EXISTS focus_tags               CASCADE;
DROP TABLE IF EXISTS room_members             CASCADE;
DROP TABLE IF EXISTS rooms                    CASCADE;
DROP TABLE IF EXISTS character_equipment      CASCADE;
DROP TABLE IF EXISTS user_items               CASCADE;
DROP TABLE IF EXISTS items                    CASCADE;
DROP TABLE IF EXISTS social_accounts          CASCADE;
DROP TABLE IF EXISTS users                    CASCADE;

-- 재생성
CREATE TABLE users (
    id                             BIGSERIAL    PRIMARY KEY,
    nickname                       VARCHAR(255),
    gender                         VARCHAR(20),
    birth_date                     DATE,
    profile_image_url              VARCHAR(255),
    refresh_token                  VARCHAR(512),
    currency                       INTEGER      NOT NULL DEFAULT 0,
    current_tier                   VARCHAR(20),
    daily_screen_time_goal_minutes INTEGER      NOT NULL DEFAULT 0,
    time_zone                      VARCHAR(100),
    day_reset_time                 TIME,
    created_at                     TIMESTAMPTZ
);

CREATE TABLE social_accounts (
    id          BIGSERIAL    PRIMARY KEY,
    user_id     BIGINT       NOT NULL REFERENCES users(id),
    provider    VARCHAR(20)  NOT NULL,
    provider_id VARCHAR(255) NOT NULL
);

CREATE TABLE items (
    id             BIGSERIAL   PRIMARY KEY,
    name           VARCHAR(255),
    item_type      VARCHAR(20) NOT NULL,
    slot_type      VARCHAR(20),
    rarity         VARCHAR(20) NOT NULL,
    asset_address  VARCHAR(255),
    price_type     VARCHAR(20) NOT NULL,
    currency_price INTEGER,
    premium_price  INTEGER
);

CREATE TABLE user_items (
    id          BIGSERIAL   PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users(id),
    item_id     BIGINT      NOT NULL REFERENCES items(id),
    acquired_at TIMESTAMPTZ,
    UNIQUE (user_id, item_id)
);

CREATE TABLE character_equipment (
    id          BIGSERIAL   PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users(id),
    item_id     BIGINT      NOT NULL REFERENCES items(id),
    slot_type   VARCHAR(20) NOT NULL,
    equipped_at TIMESTAMPTZ,
    UNIQUE (user_id, slot_type)
);

CREATE TABLE rooms (
    id               BIGSERIAL   PRIMARY KEY,
    mission_category VARCHAR(20) NOT NULL,
    mission_type     VARCHAR(20) NOT NULL,
    window_start     TIMESTAMPTZ,
    window_end       TIMESTAMPTZ,
    duration_minutes INTEGER,
    bet_type         VARCHAR(20) NOT NULL DEFAULT 'NONE',
    max_members      INTEGER     NOT NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'WAITING',
    created_at       TIMESTAMPTZ,
    started_at       TIMESTAMPTZ,
    ended_at         TIMESTAMPTZ
);

CREATE TABLE room_members (
    id           BIGSERIAL   PRIMARY KEY,
    user_id      BIGINT      NOT NULL REFERENCES users(id),
    room_id      BIGINT      NOT NULL REFERENCES rooms(id),
    joined_at    TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    UNIQUE (user_id, room_id)
);

CREATE TABLE focus_tags (
    id      BIGSERIAL    PRIMARY KEY,
    user_id BIGINT       NOT NULL REFERENCES users(id),
    name    VARCHAR(255) NOT NULL
);

CREATE TABLE focus_sessions (
    id                        BIGSERIAL   PRIMARY KEY,
    user_id                   BIGINT      NOT NULL REFERENCES users(id),
    focus_tag_id              BIGINT      REFERENCES focus_tags(id),
    subject                   VARCHAR(255),
    started_at                TIMESTAMPTZ NOT NULL,
    ended_at                  TIMESTAMPTZ NOT NULL,
    distraction_count         INTEGER     NOT NULL DEFAULT 0,
    total_distraction_seconds INTEGER     NOT NULL DEFAULT 0
);

CREATE TABLE league_tier_configs (
    tier                   VARCHAR(20) PRIMARY KEY,
    group_size             INTEGER     NOT NULL DEFAULT 30,
    promote_count          INTEGER     NOT NULL,
    relegate_count         INTEGER     NOT NULL,
    relegate_warning_count INTEGER     NOT NULL
);

CREATE TABLE league_groups (
    id         BIGSERIAL   PRIMARY KEY,
    tier       VARCHAR(20) NOT NULL REFERENCES league_tier_configs(tier),
    week_start TIMESTAMPTZ NOT NULL,
    status     VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    closed_at  TIMESTAMPTZ
);

CREATE TABLE league_group_members (
    id                  BIGSERIAL PRIMARY KEY,
    league_group_id     BIGINT    NOT NULL REFERENCES league_groups(id),
    user_id             BIGINT    NOT NULL REFERENCES users(id),
    total_focus_minutes INTEGER   NOT NULL DEFAULT 0,
    rank                INTEGER,
    promoted            BOOLEAN   NOT NULL DEFAULT FALSE,
    relegated           BOOLEAN   NOT NULL DEFAULT FALSE,
    relegate_warning    BOOLEAN   NOT NULL DEFAULT FALSE,
    UNIQUE (league_group_id, user_id)
);

CREATE TABLE user_streaks (
    id                BIGSERIAL PRIMARY KEY,
    user_id           BIGINT    NOT NULL UNIQUE REFERENCES users(id),
    streak_count      INTEGER   NOT NULL DEFAULT 0,
    longest_streak    INTEGER   NOT NULL DEFAULT 0,
    last_session_date DATE
);

CREATE TABLE currency_transactions (
    id            BIGSERIAL   PRIMARY KEY,
    user_id       BIGINT      NOT NULL REFERENCES users(id),
    amount        INTEGER     NOT NULL,
    reason        VARCHAR(30) NOT NULL,
    transacted_at TIMESTAMPTZ
);

CREATE TABLE share_cards (
    id         BIGSERIAL    PRIMARY KEY,
    room_id    BIGINT       NOT NULL REFERENCES rooms(id),
    user_id    BIGINT       NOT NULL REFERENCES users(id),
    image_url  VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ,
    shared_at  TIMESTAMPTZ
);

CREATE TABLE daily_focus_stats (
    id                         BIGSERIAL PRIMARY KEY,
    user_id                    BIGINT    NOT NULL REFERENCES users(id),
    date                       DATE      NOT NULL,
    total_focus_minutes        INTEGER   NOT NULL DEFAULT 0,
    session_count              INTEGER   NOT NULL DEFAULT 0,
    distraction_count          INTEGER   NOT NULL DEFAULT 0,
    actual_screen_time_minutes INTEGER   NOT NULL DEFAULT 0,
    focus_goal_achieved        BOOLEAN   NOT NULL DEFAULT FALSE,
    screen_time_goal_achieved  BOOLEAN   NOT NULL DEFAULT FALSE,
    updated_at                 TIMESTAMPTZ,
    UNIQUE (user_id, date)
);

CREATE TABLE weekly_feedbacks (
    id           BIGSERIAL   PRIMARY KEY,
    user_id      BIGINT      NOT NULL REFERENCES users(id),
    week_start   TIMESTAMPTZ NOT NULL,
    content      TEXT        NOT NULL,
    generated_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ
);

CREATE TABLE friendships (
    id           BIGSERIAL   PRIMARY KEY,
    requester_id BIGINT      NOT NULL REFERENCES users(id),
    receiver_id  BIGINT      NOT NULL REFERENCES users(id),
    status       VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    requested_at TIMESTAMPTZ,
    accepted_at  TIMESTAMPTZ,
    UNIQUE (requester_id, receiver_id)
);

CREATE TABLE room_invites (
    id           BIGSERIAL   PRIMARY KEY,
    room_id      BIGINT      NOT NULL REFERENCES rooms(id),
    inviter_id   BIGINT      NOT NULL REFERENCES users(id),
    invitee_id   BIGINT      NOT NULL REFERENCES users(id),
    status       VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    invited_at   TIMESTAMPTZ,
    responded_at TIMESTAMPTZ
);

\echo '✅ DB 초기화 완료'
\dt

EOF
