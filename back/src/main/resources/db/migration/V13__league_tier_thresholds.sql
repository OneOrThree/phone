-- GROMO-815: 리그 승강 기준을 아레나 순위 인원 수에서 주간 집중 시간 임계값으로 전환한다.
-- 구 아레나 배치가 제거되는 GROMO-817 전까지 기존 NOT NULL 컬럼과 시드 값도 함께 유지한다.
ALTER TABLE league_tier_configs ADD COLUMN promotion_time integer;
ALTER TABLE league_tier_configs ADD COLUMN relegation_time integer;

INSERT INTO league_tier_configs
    (tier_level, arena_size, promote_count, relegate_count, relegate_warning_count,
     badge_id, promotion_time, relegation_time, created_at)
VALUES
    (1, 30, 10, 5, 3, 'bbosirae',    50400,      0, CURRENT_TIMESTAMP),
    (2, 30, 10, 5, 3, 'preheat',    100800,  50400, CURRENT_TIMESTAMP),
    (3, 30, 10, 5, 3, 'hyperfocus', 151200, 100800, CURRENT_TIMESTAMP),
    (4, 30, 10, 5, 3, 'gatsaeng',   201600, 151200, CURRENT_TIMESTAMP),
    (5, 30, 10, 5, 3, 'conqueror',  252000, 201600, CURRENT_TIMESTAMP)
ON CONFLICT (tier_level) DO UPDATE SET
    badge_id = EXCLUDED.badge_id,
    promotion_time = EXCLUDED.promotion_time,
    relegation_time = EXCLUDED.relegation_time;

ALTER TABLE league_tier_configs ALTER COLUMN promotion_time SET NOT NULL;
ALTER TABLE league_tier_configs ALTER COLUMN relegation_time SET NOT NULL;

-- 설정은 1~5티어가 정확히 한 행씩 존재해야 한다.
DO $$
BEGIN
    IF (SELECT COUNT(*) FROM league_tier_configs) <> 5
        OR EXISTS (
            SELECT 1
            FROM generate_series(1, 5) AS expected(tier_level)
            LEFT JOIN league_tier_configs AS actual USING (tier_level)
            WHERE actual.tier_level IS NULL
        ) THEN
        RAISE EXCEPTION 'league_tier_configs must contain exactly one row for each tier from 1 to 5';
    END IF;
END
$$;

-- 각 티어의 승격선은 바로 다음 티어의 강등선과 이어져야 한다.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM league_tier_configs AS current_tier
        JOIN league_tier_configs AS next_tier
            ON next_tier.tier_level = current_tier.tier_level + 1
        WHERE current_tier.tier_level < 5
          AND current_tier.promotion_time <> next_tier.relegation_time
    ) THEN
        RAISE EXCEPTION 'league tier promotion and relegation thresholds must be continuous';
    END IF;
END
$$;
