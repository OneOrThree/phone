-- 신고자의 진술을 내구 접수한다. target_* 는 검증된 위반/소유권 증명이 아니다.
CREATE TABLE safety_reports (
    id uuid PRIMARY KEY,
    reporter_id uuid NOT NULL,
    request_id uuid NOT NULL,
    target_type varchar(32) NOT NULL,
    target_id uuid,
    target_user_id uuid,
    reason varchar(32) NOT NULL,
    details varchar(2000) NOT NULL,
    submitted_text varchar(5000),
    received_at timestamptz NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEWING','RESOLVED','DISMISSED')),
    resolution varchar(2000),
    resolved_by varchar(64),
    closed_at timestamptz,
    legal_hold boolean NOT NULL DEFAULT false,
    hold_reason varchar(1000),
    CONSTRAINT safety_reports_hold_reason CHECK (NOT legal_hold OR (hold_reason IS NOT NULL AND length(trim(hold_reason)) > 0)),
    CONSTRAINT safety_reports_request UNIQUE (reporter_id, request_id)
);
CREATE INDEX ix_safety_reports_queue ON safety_reports (status, id);
CREATE INDEX ix_safety_reports_reporter_time ON safety_reports (reporter_id, received_at);
