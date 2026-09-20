-- GROMO-1990: 집중 보상을 종료 정산에서 «유효 집중 60초마다 섬 적립» 으로 전환한다.
-- finish 는 더 이상 지급하지 않는다 — 매분 적립 틱(FocusRewardScheduler)이 그때그때 확정한다.

-- 1) 적립 워터마크 — 이미 «판정을 마친» 순수 집중 초. 상한에 걸려 못 받은 몫도 판정 완료로 민다
--    (다음 날 상한이 풀렸다고 어제 몫을 소급 지급하지 않는다).
ALTER TABLE focus_session_details
    ADD COLUMN rewarded_seconds bigint NOT NULL DEFAULT 0;

-- 2) 목표 시간 선택화 — 보상이 목표가 아니라 시간에만 걸리므로 목표 없이도 시작할 수 있다.
ALTER TABLE focus_session_details
    ALTER COLUMN target_minutes DROP NOT NULL;

-- 3) 적립 원장 — (세션, 적립일) 당 한 행. 하루 상한과 「주민 누적 획득」의 합산 축이 둘 다 이 표다.
--    user_id·island_id 를 복제하지 않는다: 상세와 조인하면 탈퇴 익명화(user_id 절단)가 그대로 따라온다.
--    적립일은 UTC 날짜다(결정 D8 — 모든 시간 UTC · 하루 리셋 UTC 00:00).
CREATE TABLE focus_reward_accruals (
    id          uuid        PRIMARY KEY,
    session_id  uuid        NOT NULL REFERENCES focus_session_details (session_id) ON DELETE CASCADE,
    accrued_on  date        NOT NULL,
    earned_fish integer     NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT focus_reward_accruals_session_day_uk UNIQUE (session_id, accrued_on),
    CONSTRAINT focus_reward_accruals_fish_ck CHECK (earned_fish > 0)
);

-- 하루 상한 합산은 (사용자, 섬) 으로 상세를 좁힌 뒤 날짜로 자른다 — 날짜 단독 인덱스면 충분하다.
CREATE INDEX focus_reward_accruals_accrued_on_idx ON focus_reward_accruals (accrued_on);
