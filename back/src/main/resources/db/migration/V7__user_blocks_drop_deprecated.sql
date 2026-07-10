-- V7 — user_blocks 신설 + 폐기 테이블 드롭 + group 잔여 dbml 정합 (GROMO-676, 시리즈 마지막)
-- 방향: dbml 정합. 데이터: 폐기 대상은 드롭(확정), 공지 권한은 초기화(DISALLOW) — grant 이관 안 함(결정).

-- ── 1) user_blocks 신설 (유저 차단 — 스키마+매핑 선반영, 기능 로직은 별도 티켓) ──
CREATE TABLE user_blocks (
    id         uuid PRIMARY KEY,
    blocker_id uuid NOT NULL REFERENCES users (id),
    blocked_id uuid NOT NULL REFERENCES users (id),
    created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
    CONSTRAINT uk_user_blocks_blocker_blocked UNIQUE (blocker_id, blocked_id)
);

-- ── 2) group_members 에 멤버 단위 공지 권한 (grant 테이블 인라인화) ─────────────
-- 기존 group_notice_grants 는 이관하지 않고 전원 DISALLOW 로 초기화(결정 — DB 초기화 예정).
ALTER TABLE group_members ADD COLUMN announcement_permission varchar(255) NOT NULL DEFAULT 'DISALLOW';
ALTER TABLE group_members
    ADD CONSTRAINT group_members_announcement_permission_check
    CHECK ((announcement_permission)::text = ANY
        ((ARRAY['DISALLOW'::character varying, 'ALLOW'::character varying])::text[]));

-- ── 3) groups 잔여 컬럼 드롭 (dbml 최종형: 미션/코드/호스트/공지스코프/생명주기 컬럼 없음) ──
-- notice_permission: 그룹 단위 공지 스코프 폐기 → 멤버 단위 announcement_permission 로 대체.
-- host_id: 방장 = group_members.role=OWNER 단일 원천. bet_type: dbml 미사용. started/ended_at: 챌린지 소유.
ALTER TABLE groups DROP COLUMN notice_permission;
ALTER TABLE groups DROP COLUMN host_id;
ALTER TABLE groups DROP COLUMN bet_type;
ALTER TABLE groups DROP COLUMN started_at;
ALTER TABLE groups DROP COLUMN ended_at;

-- ── 4) 폐기 테이블 드롭 (인바운드 FK 없음 확인 — 나가는 FK 만 보유) ─────────────
DROP TABLE group_notice_grants;
DROP TABLE share_cards;
DROP TABLE weekly_feedbacks;
