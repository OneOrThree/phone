-- GROMO-2045: 개인 물고기 적립을 «DB 제약»으로 막는다.
--
-- 2026-09-19 결정 D5-귀속-개정(집중 보상을 포함한 모든 재화는 섬 통장 100%)과 GROMO-1989 의 결정
-- 「개인적립-차단」(조정 주체 없음 · Flyway 에 0 초과 revision 을 넣지 않는다 · 정기 재검토 없음)은
-- 지금까지 «사람이 지키는 규칙»이었다. V67 의 CHECK 가 0..100 을 허용하므로, 마이그레이션 한 줄로
-- personal_share_percent > 0 인 revision 이 들어가는 순간 폐기하기로 한 개인 재화가 되살아날 자리가 있다.
-- (오늘의 코드에는 그 자리를 읽는 경로가 없다 — FocusRewardAccrualService 는 섬 통장에만 넣고
--  FishWalletService.credit 은 호출자가 없다. 이 제약은 그 열이 «다시 배선될» 때 조용히 열리지 않게
--  하는 최후 방어선이다.)
--
-- V67 의 바이트는 계약이라 고치지 않는다 — 제약을 앞으로 굴린다(V91 이 focus_reward_accruals 에 쓴 것과
-- 같은 결). V67 의 인라인 CHECK 는 PostgreSQL 기본 이름(<table>_<column>_check)으로 만들어졌다.

-- 1) 먼저 기존 행을 본다. 0 초과 값이 이미 있으면 «조용히 0 으로 고치지 않고» 배포를 세운다 —
--    그 값은 누군가 의도해 넣은 운영값이고, 0 으로 덮으면 진행 중 세션의 지급률이 말없이 바뀐다.
--    정책 revision 은 고치지도 지우지도 않는 표라(FocusRewardPolicy javadoc) 백필 자체가 금지다.
DO $$
DECLARE
    nonzero bigint;
BEGIN
    SELECT count(*) INTO nonzero FROM focus_reward_policies WHERE personal_share_percent <> 0;
    IF nonzero > 0 THEN
        RAISE EXCEPTION 'V97: personal_share_percent 가 0 이 아닌 정책 revision 이 % 건 있습니다 — 개인 지갑 적립은 폐기된 경로입니다(D5-귀속-개정). 값을 지우지 말고 그 revision 을 넣은 경위부터 확인하세요', nonzero;
    END IF;
END $$;

-- 2) 0 만 허용하도록 좁힌다. 「개인 몫을 다시 열겠다」는 결정이 서면 그때 이 제약을 앞으로 굴려 푼다.
ALTER TABLE focus_reward_policies
    DROP CONSTRAINT focus_reward_policies_personal_share_percent_check;
ALTER TABLE focus_reward_policies
    ADD CONSTRAINT focus_reward_policies_personal_share_percent_check
        CHECK (personal_share_percent = 0);

COMMENT ON COLUMN focus_reward_policies.personal_share_percent IS
    'GROMO-2045: 0 고정(CHECK) — D5-귀속-개정으로 개인 지갑 적립은 폐기됐다. 열을 지우지 않는 것은 E=P+C 보존식의 P 자리를 응답 계약이 아직 쓰기 때문이다.';
