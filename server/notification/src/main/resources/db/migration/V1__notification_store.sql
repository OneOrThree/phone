-- 이관 경로(import·verify·open)가 «전부» 먼저 잠그는 공통 행. 잠금 순서를 한 줄로 못 박는다.
-- active_migration_id 는 «전역으로 활성인 이관 하나»를 묶어 둔다 — settings·device_tokens·deliveries 는
-- 이관들 사이에 공유되므로, 서로 다른 id 의 적재가 섞이면 한쪽의 최종 검사가 다른 쪽의 미검증 쓰기를
-- 포함한 채 통과한다. 같은 id 의 재개는 그대로 이어진다.
CREATE TABLE dispatch_control (
    id integer PRIMARY KEY CHECK(id=1),
    enabled boolean NOT NULL DEFAULT false,
    ever_opened boolean NOT NULL DEFAULT false,
    active_migration_id text,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO dispatch_control(id) VALUES(1);
CREATE TABLE commands (
    scope text NOT NULL, command_key text NOT NULL, request_hash text NOT NULL, response jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scope,command_key)
);
CREATE TABLE inbound_events (
    event_id text PRIMARY KEY, envelope jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_fences (
    user_id uuid PRIMARY KEY, auth_generation bigint NOT NULL DEFAULT 0, withdrawn boolean NOT NULL DEFAULT false
);
CREATE TABLE session_fences (
    bootstrap_hash text PRIMARY KEY, user_id uuid NOT NULL, epoch bigint NOT NULL, revoked boolean NOT NULL DEFAULT false,
    used boolean NOT NULL DEFAULT false
);
CREATE TABLE device_tokens (
    device_token text PRIMARY KEY, user_id uuid NOT NULL, ownership_token uuid NOT NULL UNIQUE,
    ownership_version bigint NOT NULL DEFAULT 1, auth_generation bigint, bootstrap_hash text,
    session_epoch bigint, active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_user ON device_tokens(user_id) WHERE active;
CREATE TABLE settings (
    user_id uuid PRIMARY KEY, version bigint NOT NULL DEFAULT 0, notification_enabled boolean NOT NULL DEFAULT true,
    sound_enabled boolean NOT NULL DEFAULT true, night_mode_enabled boolean NOT NULL DEFAULT false,
    night_start_time time, night_end_time time
);
CREATE TABLE projections (
    projection_type text NOT NULL, user_id uuid NOT NULL, subject_id text NOT NULL DEFAULT '',
    version bigint NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(projection_type,user_id,subject_id)
);
CREATE TABLE kinds (
    id text PRIMARY KEY, enabled boolean NOT NULL DEFAULT true, silent boolean NOT NULL DEFAULT false,
    quiet_policy text NOT NULL DEFAULT 'DROP' CHECK(quiet_policy IN ('DROP','DEFER','BYPASS')),
    eligibility_required boolean NOT NULL DEFAULT false, cooldown_seconds integer NOT NULL DEFAULT 0
);
CREATE TABLE templates (
    id text PRIMARY KEY, kind text NOT NULL REFERENCES kinds(id), locale text NOT NULL,
    title text, body text NOT NULL, enabled boolean NOT NULL DEFAULT true, version bigint NOT NULL DEFAULT 1,
    UNIQUE(kind,locale)
);
CREATE TABLE deeplinks (
    id text PRIMARY KEY REFERENCES kinds(id), url_template text, data_template jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE deliveries (
    id uuid PRIMARY KEY, event_id text NOT NULL UNIQUE, user_id uuid NOT NULL, kind text NOT NULL REFERENCES kinds(id),
    subject_id text, admin_actor text, replay_of uuid REFERENCES deliveries(id), group_id uuid, slot_at timestamptz, payload jsonb NOT NULL, locale text,
    status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DEFERRED','SENT','SUPPRESSED','FAILED')),
    next_attempt_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0,
    lease_token uuid, lease_expires_at timestamptz, sent_at timestamptz, last_error text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_due ON deliveries(next_attempt_at) WHERE status IN ('PENDING','DEFERRED');
CREATE UNIQUE INDEX deliveries_subject ON deliveries(user_id,kind,subject_id) WHERE subject_id IS NOT NULL AND admin_actor IS NULL
    AND kind IN ('BET_RESULT','BET_VOID_REFUND','BET_WON','BET_SILENT_FLUSH',
                 'CHALLENGE_SESSION_OPEN','CHALLENGE_CREATED');
CREATE TABLE delivery_devices (
    delivery_id uuid NOT NULL REFERENCES deliveries(id), ownership_token uuid NOT NULL,
    sent_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(delivery_id,ownership_token)
);
CREATE TABLE result_ack (
    user_id uuid NOT NULL, session_id uuid NOT NULL,
    state text NOT NULL CHECK(state IN ('HELD','NEEDS_CONFIRM','CONFIRMED','RELEASED')),
    held_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,session_id)
);
CREATE TABLE jobs (
    id text PRIMARY KEY, owner text NOT NULL CHECK(owner IN ('DATA','NOTIFICATION')), cron text NOT NULL,
    enabled boolean NOT NULL DEFAULT false, config jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job_runs (
    job_id text NOT NULL REFERENCES jobs(id), scheduled_at timestamptz NOT NULL,
    completed_at timestamptz, lease_expires_at timestamptz, error text, PRIMARY KEY(job_id,scheduled_at)
);
CREATE TABLE admin_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL, action text NOT NULL,
    resource_id text, request jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE imports (
    migration_id text NOT NULL, record_key text NOT NULL, checksum text NOT NULL,
    record jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'IMPORTED' CHECK(status IN ('IMPORTED','SUPERSEDED','SKIPPED')),
    imported_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(migration_id,record_key)
);
CREATE TABLE migration_state (
    id text PRIMARY KEY, version bigint NOT NULL DEFAULT 0, manifest jsonb NOT NULL, verified_at timestamptz, opened_at timestamptz
);
