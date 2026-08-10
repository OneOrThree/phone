-- ════════════════════════════════════════════════════════════════════
-- V40 — 참가비 상한 3,000 을 DB 가 강제 (GROMO-1264 · N30)
-- ════════════════════════════════════════════════════════════════════
-- CHECK (stake BETWEEN 1 AND 3000) 을 설정(group_challenge_bets)과 회차(박제값,
-- group_challenge_bet_sessions) 양쪽에 건다 — 서비스 상수만으로는 우회 경로(배치·수동 SQL)에서
-- 범위 밖 값이 저장될 수 있고, 회차 stake 는 박제라 되돌릴 수 없다. 앱 프리셋(300/900/1,500/3,000)
-- 은 상한의 10·30·50·100% 로 앱 몫이다 — 서버·DB 는 범위만 본다(policy §C1).
--
-- CHECK 추가 전에 범위 밖 기존 행을 상한으로 클램프한다(V28 관행) — plain CHECK 는 기존 행을 즉시
-- 검증하므로 위반 행이 하나라도 있으면 배포(부팅)가 막힌다. 종전 서비스 상한이 1,000 이라 실데이터
-- 위반은 없어야 하지만, 방어적으로 둔다.
UPDATE public.group_challenge_bets SET stake = 3000 WHERE stake > 3000;
UPDATE public.group_challenge_bet_sessions SET stake = 3000 WHERE stake > 3000;

-- 설정 쪽 구 CHECK(V19 인라인 stake > 0)는 제약명이 마이그레이션에 명시돼 있지 않다 — stake 컬럼을
-- 참조하는 CHECK 를 찾아 이름-무관으로 드롭한다(V20 관행).
DO $$
DECLARE
    con record;
BEGIN
    FOR con IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'public.group_challenge_bets'::regclass
          AND c.contype = 'c'
          AND EXISTS (SELECT 1
                      FROM pg_attribute a
                      WHERE a.attrelid = c.conrelid
                        AND a.attname = 'stake'
                        AND a.attnum = ANY (c.conkey))
    LOOP
        EXECUTE format('ALTER TABLE public.group_challenge_bets DROP CONSTRAINT %I', con.conname);
    END LOOP;
END $$;

ALTER TABLE public.group_challenge_bets
    ADD CONSTRAINT group_challenge_bets_stake_check CHECK (stake BETWEEN 1 AND 3000);

-- 회차 쪽은 V39 가 제약명을 명시해 만들었다 — 이름으로 바로 교체한다.
ALTER TABLE public.group_challenge_bet_sessions
    DROP CONSTRAINT group_challenge_bet_sessions_stake_check;
ALTER TABLE public.group_challenge_bet_sessions
    ADD CONSTRAINT group_challenge_bet_sessions_stake_check CHECK (stake BETWEEN 1 AND 3000);
