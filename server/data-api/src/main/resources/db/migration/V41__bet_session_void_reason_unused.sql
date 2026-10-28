-- ════════════════════════════════════════════════════════════════════
-- V41 — 회차 무산 사유(void_reason) + 0명 종료 상태(UNUSED) (GROMO-1404 · N33 · N52)
-- ════════════════════════════════════════════════════════════════════
-- · void_reason: 종료 상태를 보조하는 사유 축 — VOIDED(인원 미달 INSUFFICIENT_PARTICIPANTS ·
--   챌린지 삭제 CHALLENGE_DELETED)와 24h 데드라인 자동 환불(REFUND_DEADLINE, status=REFUNDED)에
--   기록한다. 사유 없이 상태 하나면 "인원 부족" 카피가 삭제 건까지 거짓말한다.
-- · UNUSED: 참가자 0명 전용 종료 상태 — 아무도 돈을 걸지 않은 회차. 결과 큐·내역·알림 어디에도
--   싣지 않는다. VOIDED 는 환불 대상이 실제 있는 경우(정확히 1명)로 한정된다.
-- 종료 경로 전부(정산·크론·삭제)가 잠금 안에서 인원을 재확인해 0명 → UNUSED / 1명 → VOIDED 로
-- 분기한다 — 정산 본체는 이번에 배선했고, 참가 마감 크론(N47)은 후속(B4)이다.

ALTER TABLE public.group_challenge_bet_sessions
    ADD COLUMN void_reason character varying(40)
        CONSTRAINT group_challenge_bet_sessions_void_reason_check
            CHECK (void_reason IS NULL OR (void_reason)::text = ANY ((ARRAY[
                'INSUFFICIENT_PARTICIPANTS'::character varying,
                'CHALLENGE_DELETED'::character varying,
                'REFUND_DEADLINE'::character varying])::text[]));

-- status CHECK 에 UNUSED 추가 — V39 가 제약명을 명시해 만들었으므로 이름으로 교체한다(V20 교훈).
ALTER TABLE public.group_challenge_bet_sessions
    DROP CONSTRAINT group_challenge_bet_sessions_status_check;
ALTER TABLE public.group_challenge_bet_sessions
    ADD CONSTRAINT group_challenge_bet_sessions_status_check
        CHECK ((status)::text = ANY ((ARRAY[
            'OPEN'::character varying,
            'SETTLED'::character varying,
            'REFUNDED'::character varying,
            'FORFEITED'::character varying,
            'VOIDED'::character varying,
            'UNUSED'::character varying])::text[]));
