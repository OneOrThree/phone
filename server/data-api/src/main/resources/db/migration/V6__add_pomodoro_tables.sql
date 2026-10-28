-- V6 — 포모도로 테이블 2종 선반영 (GROMO-675)
-- 방향: dbml 정합. 스키마+매핑만(기능 로직은 별도 티켓 — GROMO-561 group_challenge_members 선례).
-- 신규 테이블이라 레거시 이관 없음.

-- 뽀모도로 프리셋 (서버 관리 시드, 하드코딩 대체)
CREATE TABLE focus_sessions_pomodoro_setting (
    id            uuid PRIMARY KEY,
    name          varchar(255) NOT NULL,
    focus_minutes integer NOT NULL,
    break_minutes integer NOT NULL,
    is_default    boolean NOT NULL DEFAULT false,
    created_at    timestamp(6) with time zone NOT NULL DEFAULT now(),
    updated_at    timestamp(6) with time zone,
    deleted_at    timestamp(6) with time zone
);

-- POMODORO 세션 상세 (focus_sessions 1:1 — focus_type=POMODORO 세션만 행 존재, CTI)
CREATE TABLE focus_session_pomodoros (
    id                  uuid PRIMARY KEY,
    focus_session_id    uuid NOT NULL UNIQUE REFERENCES focus_sessions (id),
    pomodoro_setting_id uuid REFERENCES focus_sessions_pomodoro_setting (id),
    focus_minutes       integer NOT NULL,
    break_minutes       integer NOT NULL,
    set_count           integer NOT NULL,
    created_at          timestamp(6) with time zone NOT NULL DEFAULT now()
);
