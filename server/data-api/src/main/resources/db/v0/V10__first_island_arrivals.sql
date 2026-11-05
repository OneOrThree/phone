-- 계정당 한 번만 기록하는 «첫 섬 도착» 사건과 Meta Conversions API 전송 상태 (GROMO-2741).
-- 첫 항해 체험 도착이 계정의 첫 island_arrivals 를 만들 때만 행이 생긴다.
CREATE TABLE first_island_arrivals (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    event_id uuid NOT NULL UNIQUE,
    island_id uuid NOT NULL,
    occurred_at timestamptz NOT NULL,
    anon_id varchar(128),
    advertiser_tracking_enabled boolean,
    extinfo jsonb,
    client_ip varchar(45),
    send_status varchar(16) NOT NULL CHECK (send_status IN ('PENDING', 'SENT', 'FAILED', 'EXPIRED', 'SKIPPED')),
    attempts int NOT NULL DEFAULT 0,
    next_attempt_at timestamptz,
    sent_at timestamptz,
    last_error varchar(200)
);
CREATE INDEX first_island_arrivals_due_idx ON first_island_arrivals(next_attempt_at) WHERE send_status = 'PENDING';
COMMENT ON TABLE first_island_arrivals IS '계정의 첫 섬 도착 사건 — 첫 항해 체험(intro-arrivals)이 island_arrivals 행이 하나도 없는 계정에 처음 도착을 만들 때 1회 기록하고 Meta Conversions API 로 보낸다. anon_id·extinfo·client_ip 는 종료 상태(SENT·FAILED·EXPIRED·SKIPPED)가 되면 지운다. GROMO-2741, V10';
