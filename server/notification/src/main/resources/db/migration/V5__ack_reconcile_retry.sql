-- 실패한 정본 조회도 다음 시도를 내구 예약한다. null은 새 ack의 즉시 조회를 뜻한다.
ALTER TABLE result_ack ADD COLUMN next_reconcile_at timestamptz;
CREATE INDEX result_ack_reconcile_due ON result_ack
    (COALESCE(next_reconcile_at, updated_at), user_id, session_id)
    WHERE state = 'NEEDS_CONFIRM';
