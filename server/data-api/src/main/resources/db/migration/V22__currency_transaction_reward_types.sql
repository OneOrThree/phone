-- currency_transactions.type 도메인 확장 — 재화 보상 사유 3종(집중 목표·스크린타임 목표·리그 승급, GROMO-1039).
-- CHECK 는 값 목록을 통째로 교체해야 하므로 V19 가 만든 제약을 드롭하고 다시 만든다.
-- 프로덕션은 ddl-auto: validate 라 enum 값 추가만으로는 CHECK 가 갱신되지 않는다 → 이 마이그레이션이 없으면
-- FOCUS_GOAL/SCREEN_TIME_GOAL/LEAGUE_TIER_BONUS INSERT 가 전부 제약 위반으로 실패한다(코드리뷰 반영).
ALTER TABLE currency_transactions DROP CONSTRAINT currency_transactions_type_check;
ALTER TABLE currency_transactions
    ADD CONSTRAINT currency_transactions_type_check
    CHECK ((type)::text = ANY ((ARRAY[
        'SESSION_COMPLETE'::character varying,
        'STREAK_BONUS'::character varying,
        'PURCHASE'::character varying,
        'BET_STAKE'::character varying,
        'BET_PAYOUT'::character varying,
        'BET_REFUND'::character varying,
        'FOCUS_GOAL'::character varying,
        'SCREEN_TIME_GOAL'::character varying,
        'LEAGUE_TIER_BONUS'::character varying])::text[]));
