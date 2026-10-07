-- 최초 낚시 1마리: 사용자당 한 번. 세션 삭제가 수령 자격을 되살리지 않도록 session_id는 영수증 값이다.
CREATE TABLE focus_tutorial_rewards (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    session_id uuid NOT NULL,
    claimed_at timestamptz NOT NULL
);

ALTER TABLE focus_reward_accruals ADD COLUMN tutorial_fish integer NOT NULL DEFAULT 0;
ALTER TABLE focus_reward_accruals DROP CONSTRAINT focus_reward_accruals_fish_ck;
ALTER TABLE focus_reward_accruals ADD CONSTRAINT focus_reward_accruals_fish_ck
    CHECK (earned_fish >= 0 AND golden_fish >= 0 AND tutorial_fish BETWEEN 0 AND 1
        AND earned_fish + golden_fish + tutorial_fish > 0);
