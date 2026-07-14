-- GROMO-817: 전역 주간 리그 전환 후 아레나 멤버십과 순위 기반 설정을 제거한다.
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
