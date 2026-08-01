-- ════════════════════════════════════════════════════════════════════
-- 그룹 챌린지 내기 — 내기 본체 + 참가자, 재화 원장 type 확장
-- ════════════════════════════════════════════════════════════════════
-- 판돈 재화는 기존 user_wallets(잔액·낙관락) + currency_transactions(원장·멱등키) 를 재사용한다.
-- 이중부기 원장 신설은 하지 않는다 — 그릇이 이미 있고, 원장 개편은 별도 배치 범위.

-- 내기: 챌린지 하나의 특정 날짜(bet_date)에 걸린 판. 그룹원 누구나 개설하고 개설자는 자동 참가한다.
CREATE TABLE public.group_challenge_bets (
    id uuid PRIMARY KEY,
    group_id uuid NOT NULL REFERENCES public.groups(id),
    challenge_id uuid NOT NULL REFERENCES public.group_challenges(id),
    creator_user_id uuid NOT NULL REFERENCES public.users(id),
    stake integer NOT NULL CHECK (stake > 0),
    bet_date date NOT NULL,
    status character varying(20) NOT NULL
        CHECK ((status)::text = ANY ((ARRAY['OPEN'::character varying, 'SETTLED'::character varying, 'REFUNDED'::character varying])::text[])),
    settled_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    -- 챌린지당·날짜당 내기 1개. 동시 개설의 최후 방어선이기도 하다.
    CONSTRAINT uq_group_challenge_bets_challenge_bet_date UNIQUE (challenge_id, bet_date)
);

-- 일 배치(04:00 KST)가 status=OPEN AND bet_date < 오늘 을 훑는다.
CREATE INDEX idx_group_challenge_bets_status_bet_date
    ON public.group_challenge_bets (status, bet_date);

-- 참가자: 판돈은 참가 즉시 차감(에스크로)되고, achieved/payout 은 정산 시점에 기록된다.
CREATE TABLE public.group_challenge_bet_participants (
    id uuid PRIMARY KEY,
    bet_id uuid NOT NULL REFERENCES public.group_challenge_bets(id),
    user_id uuid NOT NULL REFERENCES public.users(id),
    achieved boolean,
    payout integer,
    created_at timestamp(6) with time zone NOT NULL,
    -- 중복 참가 방어(동시 요청 레이스 포함)
    CONSTRAINT uq_group_challenge_bet_participants_bet_user UNIQUE (bet_id, user_id)
);

-- currency_transactions.type 도메인 확장 — 내기 판돈/지급/환불.
-- CHECK 는 값 목록을 통째로 교체해야 하므로 V2 가 만든 제약을 드롭하고 다시 만든다.
ALTER TABLE currency_transactions DROP CONSTRAINT currency_transactions_type_check;
ALTER TABLE currency_transactions
    ADD CONSTRAINT currency_transactions_type_check
    CHECK ((type)::text = ANY ((ARRAY[
        'SESSION_COMPLETE'::character varying,
        'STREAK_BONUS'::character varying,
        'PURCHASE'::character varying,
        'BET_STAKE'::character varying,
        'BET_PAYOUT'::character varying,
        'BET_REFUND'::character varying])::text[]));
