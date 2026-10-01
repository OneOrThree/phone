-- 실제 집중 없이 주는 체험 보상도 기존 계정별 영수증과 같은 1회 한도를 사용한다.
ALTER TABLE focus_tutorial_rewards ALTER COLUMN session_id DROP NOT NULL;
ALTER TABLE focus_tutorial_rewards ADD COLUMN island_id uuid REFERENCES groups(id) ON DELETE SET NULL;
-- 섬 삭제는 귀속만 지운다. 계정의 수령 이력을 지워 다시 지급하지 않는다.
CREATE INDEX ix_focus_tutorial_rewards_island ON focus_tutorial_rewards(island_id)
    WHERE session_id IS NULL;
