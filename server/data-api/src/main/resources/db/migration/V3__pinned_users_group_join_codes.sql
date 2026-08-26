-- V3 — pinned_friends→pinned_users 리네임 + group_join_codes 1:1 추출 (GROMO-672)
-- 방향: dbml 정합. group_invites(유저간 초대)는 별개 기능이라 유지(건드리지 않음).
-- ※ enum 은 프로젝트 컨벤션(@Enumerated STRING → varchar + CHECK) 따름 — 네이티브 CREATE TYPE 미사용.

-- ── pinned_friends → pinned_users (리네임, 데이터 보존) ──────────────────────
ALTER TABLE pinned_friends RENAME TO pinned_users;
ALTER TABLE pinned_users RENAME COLUMN friend_user_id TO pinned_user_id;

-- ── group_join_codes 신설 (groups.code / code_expires_at 를 1:1 테이블로 추출) ──
CREATE TABLE group_join_codes (
    group_id   uuid        PRIMARY KEY REFERENCES groups (id),
    code       varchar(8)  NOT NULL UNIQUE,
    status     varchar(255) NOT NULL DEFAULT 'ACTIVE'
                   CONSTRAINT group_join_codes_status_check CHECK (status IN ('ACTIVE', 'ENDED')),
    expires_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
    updated_at timestamp(6) with time zone
);

-- 기존 코드 이관(code 있는 그룹만). 만료된 코드는 ENDED 로 산정.
INSERT INTO group_join_codes (group_id, code, status, expires_at, created_at)
SELECT id,
       code,
       CASE WHEN code_expires_at IS NOT NULL AND code_expires_at < now() THEN 'ENDED' ELSE 'ACTIVE' END,
       code_expires_at,
       COALESCE(created_at, now())
FROM groups
WHERE code IS NOT NULL;

-- groups 인라인 코드 컬럼 제거
ALTER TABLE groups DROP COLUMN code;
ALTER TABLE groups DROP COLUMN code_expires_at;
