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

ALTER TABLE league_rank_snapshots
    DROP CONSTRAINT uq_league_rank_snapshots_arena_user_day,
    DROP COLUMN arena_id,
    ADD CONSTRAINT uq_league_rank_snapshots_user_day UNIQUE (user_id, created_at);
