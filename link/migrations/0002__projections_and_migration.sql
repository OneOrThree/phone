-- 각 표시정보 축은 별도 version으로 비교한다. 사용자 변경이 그룹 변경을 덮지 않는다.
CREATE TABLE group_snapshots (
    group_id uuid PRIMARY KEY,
    name text NOT NULL,
    version bigint NOT NULL,
    closed boolean NOT NULL DEFAULT false
);
CREATE TABLE user_snapshots (
    user_id uuid PRIMARY KEY,
    display_name text,
    version bigint NOT NULL
);
CREATE TABLE joined_events (
    event_id text PRIMARY KEY,
    link_id uuid NOT NULL REFERENCES links(id),
    user_id uuid,
    occurred_at timestamptz NOT NULL,
    anonymized_at timestamptz
);
CREATE TABLE migration_runs (
    id text PRIMARY KEY,
    source_checksum text NOT NULL,
    state text NOT NULL CHECK (state IN ('IMPORTING', 'IMPORT_CLOSED')),
    expected_clicks bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz
);
CREATE TABLE migration_clicks (
    migration_id text NOT NULL REFERENCES migration_runs(id),
    click_id uuid NOT NULL REFERENCES link_clicks(id),
    source_checksum text NOT NULL,
    frozen_source jsonb NOT NULL,
    compat_applied boolean NOT NULL DEFAULT false,
    PRIMARY KEY (migration_id, click_id)
);
CREATE TABLE migration_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    migration_id text NOT NULL,
    click_id uuid NOT NULL,
    action text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (migration_id, click_id) REFERENCES migration_clicks(migration_id, click_id)
);
