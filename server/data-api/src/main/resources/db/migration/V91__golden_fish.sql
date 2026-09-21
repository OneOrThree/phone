-- GROMO-1956: 같이 집중 보너스 「황금 물고기」 (정책 정본 policy-2026-09-14.md 「물고기 재화와 기록」).
-- 섬마다 1분에 한 번 추첨해, 당첨되면 섬 잔액에 50마리를 «한 번» 더하고 함께 낚은 주민의 누적 획득
-- 기록·건설 각자 몫에 50 ÷ 인원(내림)씩 나눠 더한다. 나머지는 섬 잔액에만 남는다.

-- 1) 적립 원장에 «황금» 축을 더한다.
--    earned_fish 와 «같은 열에 섞지 않는» 것이 이 마이그레이션의 핵심이다: 하루 480마리 상한은
--    earned_fish 만 합산하는데(FocusRewardAccrualRepository.sumEarnedFishOnDay), 황금 몫을 그 열에
--    넣으면 「황금 물고기는 480마리 상한과 별도로 지급하며 자체 상한은 두지 않는다」가 깨져
--    당첨된 주민이 그날 기본 보상을 그만큼 덜 받는다.
--    주민 누적 획득 기록(FocusFishEarningsRepository)만 두 열의 합을 읽는다.
ALTER TABLE focus_reward_accruals
    ADD COLUMN golden_fish integer NOT NULL DEFAULT 0;

-- 기본 적립이 아직 한 마리도 없는 주민이 당첨될 수 있다(집중 시작 59초 뒤 추첨). 그 행은
-- earned_fish = 0 · golden_fish > 0 이라 V82 의 CHECK(earned_fish > 0) 에 걸린다. V82 의 바이트는
-- 계약이므로 고치지 않고, 여기서 제약을 앞으로 굴려 두 열의 «합» 이 양수임을 요구한다.
ALTER TABLE focus_reward_accruals
    DROP CONSTRAINT focus_reward_accruals_fish_ck;
ALTER TABLE focus_reward_accruals
    ADD CONSTRAINT focus_reward_accruals_fish_ck
        CHECK (earned_fish >= 0 AND golden_fish >= 0 AND earned_fish + golden_fish > 0);

-- 2) 황금 물고기 운영값 — 「확률표·50마리·최대 인원 5명을 서버 정책 설정값으로 읽는다」(GROMO-1956).
--    집중 보상 정책 revision 표에 얹는다: 황금 물고기도 «집중 보상» 이고, 값을 바꾸려면 기존 행을
--    고치는 대신 새 revision 을 넣는 규율(FocusRewardPolicy javadoc)을 그대로 쓴다.
--    기존 revision 에 기본값을 채워 넣는 것은 안전하다 — 이 마이그레이션 전에는 황금 물고기가 아예
--    없었으므로 과거 동작이 바뀌지 않는다.
--    golden_chance_ppm 은 ACTIVE 인원 2명부터의 1분당 확률(ppm)을 쉼표로 이은 표다:
--      2명 0.4% = 4000 · 3명 1.2% = 12000 · 4명 2.4% = 24000 · 5명 이상 4% = 40000.
--    표를 열 네 개로 펼치지 않는 이유는 인원 상한(golden_max_members)이 운영값이기 때문이다 —
--    상한을 6으로 올리려면 열을 또 추가해야 한다.
ALTER TABLE focus_reward_policies
    ADD COLUMN golden_fish_reward   integer NOT NULL DEFAULT 50,
    ADD COLUMN golden_max_members   integer NOT NULL DEFAULT 5,
    ADD COLUMN golden_chance_ppm    text    NOT NULL DEFAULT '4000,12000,24000,40000';
