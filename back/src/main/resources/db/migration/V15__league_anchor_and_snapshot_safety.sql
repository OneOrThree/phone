-- GROMO-817: 기존 티어별 arena를 주차별 전역 anchor 한 행으로 축소한다.
-- ACTIVE를 우선하고 동률이면 먼저 생성된 행을 보존해 결과를 결정적으로 만든다.
WITH ranked_anchors AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY started_at
               ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END,
                        created_at ASC,
                        id ASC
           ) AS row_number
    FROM league_arenas
)
DELETE FROM league_arenas AS arena
USING ranked_anchors AS ranked
WHERE arena.id = ranked.id
  AND ranked.row_number > 1;

-- 빈 사용자 정산에서도 동시 배치가 같은 주차 anchor를 중복 생성하지 못하게 한다.
ALTER TABLE league_arenas
    ADD CONSTRAINT uq_league_arenas_started_at UNIQUE (started_at);
