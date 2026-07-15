-- GROMO-817: 전역 주간 리그 전환 후 아레나 멤버십과 순위 기반 설정을 제거한다.
-- 티어 SoT 이전: 활성 티어는 league_arena_users.tier_level → users.tier_level(V12, 기본 1)로 옮겼다.
-- 이 DROP 전에 users.tier_level 로의 백필은 하지 않는다 — 리그/아레나는 아직 실서비스 티어 데이터로
-- 운영된 적이 없고, dev DB 리셋(forward-only)으로 컷오버하므로 유실할 티어가 없다.
-- (향후 프로덕션에 실 티어가 쌓인 뒤 컷오버한다면, DROP 직전
--  UPDATE users u SET tier_level = lau.tier_level FROM league_arena_users lau
--  JOIN league_arenas a ON a.id = lau.league_arena_id
--  WHERE lau.user_id = u.id AND a.status = 'ACTIVE'; 백필을 선행해야 한다.)
DROP TABLE league_arena_users;

ALTER TABLE league_tier_configs
    DROP COLUMN arena_size,
    DROP COLUMN promote_count,
    DROP COLUMN relegate_count,
    DROP COLUMN relegate_warning_count;

ALTER TABLE league_arenas
    DROP CONSTRAINT fk3de78wwwltoqep2obk7i44olx,
    DROP COLUMN tier_level;

-- 기존 snapshot은 arena 내 순위라 전역 순위로 재해석할 수 없다.
-- 같은 user·날짜가 arena별로 여러 행일 수도 있으므로 cutover 시 전량 비우고,
-- 다음 추월 알림 실행이 오늘 전역 snapshot을 seed하게 한다.
TRUNCATE TABLE league_rank_snapshots;

ALTER TABLE league_rank_snapshots
    DROP CONSTRAINT uq_league_rank_snapshots_arena_user_day,
    DROP COLUMN arena_id,
    ADD CONSTRAINT uq_league_rank_snapshots_user_day UNIQUE (user_id, created_at);

-- 일간 순위 비교 잡은 created_at(날짜)만으로 조회(findMaximumRankByCreatedAt/findByCreatedAtAndUserIdIn)하는데
-- 유니크 인덱스는 user_id 선두라 날짜 단일 조회에 seek가 안 된다 → 테이블 전량 스캔.
-- created_at 선두 보조 인덱스로 하루치만 탐색하도록 한다.
CREATE INDEX idx_league_rank_snapshots_created_at
    ON league_rank_snapshots (created_at);
