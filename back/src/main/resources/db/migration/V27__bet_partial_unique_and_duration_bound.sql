-- ════════════════════════════════════════════════════════════════════
-- V27 — 내기 재개설 허용(취소 제외 부분 유니크) + 일 목표분 상한 (GROMO-1201 · GROMO-1205)
-- ════════════════════════════════════════════════════════════════════
-- 1) (challenge_id, bet_date) 전체 유니크 → status <> CANCELED 부분 유니크로 교체.
--    취소는 "없던 일"인데 전체 유니크가 취소 행까지 계수해 같은 날짜 재개설이 DB 에서 막혔다.
--    V4 의 소프트삭제 부분 유니크, V20 의 uq_group_challenges_active_cat_type 과 같은 패턴이다.
-- 2) group_challenge_durations.duration_minutes 상한 CHECK — V5 가 상한 없이 만들었다.
--    하루는 1440분이라 초과 목표는 달성 불가능한 챌린지다(서비스 가드 GROMO-1205 와 같은 값).

-- ── 1) 내기 (challenge_id, bet_date) — 비취소만 계수하는 부분 유니크 ────
-- V19 는 제약명을 명시해 만들었다(V20 교훈: 뒤 마이그레이션이 이름-무관 드롭을 반복하지 않도록
-- 제약명을 명시한다) — 그래서 여기서는 이름으로 바로 드롭한다.
ALTER TABLE public.group_challenge_bets
    DROP CONSTRAINT uq_group_challenge_bets_challenge_bet_date;

-- 비취소 내기는 챌린지당·날짜당 1개 — 동시 개설의 최후 방어선은 그대로 DB 다.
-- JPA 는 부분 인덱스를 표현할 수 없어 엔티티 @UniqueConstraint 는 제거됐다. 따라서 ci 프로파일
-- (create-drop) 스키마에는 이 제약이 없다 — 실 SQL 검증은 GroupChallengeV27MigrationTest 가 맡는다.
CREATE UNIQUE INDEX uq_group_challenge_bets_challenge_bet_date_active
    ON public.group_challenge_bets (challenge_id, bet_date)
    WHERE status <> 'CANCELED';

-- ── 2) 일 목표분 상한 CHECK ──────────────────────────────────────────
-- plain CHECK 는 기존 행도 즉시 검증한다 — dev DB 는 리셋 가능이라 범위 밖 행 정리는 하지 않는다
-- (forward-only 수용). 하한 1 도 함께 명시해 창 목표분 CHECK(V20)와 같은 성격의 가드로 둔다.
ALTER TABLE public.group_challenge_durations
    ADD CONSTRAINT group_challenge_durations_duration_minutes_check
        CHECK (duration_minutes BETWEEN 1 AND 1440);
