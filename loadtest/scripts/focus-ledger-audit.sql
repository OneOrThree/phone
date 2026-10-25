-- 실행 예: psql -v ON_ERROR_STOP=1 -X -v run_id=<UUID> -v fixture_user_ids='[...]' -f focus-ledger-audit.sql
-- 반드시 읽기 전용 role 로 접속한다(트랜잭션 READ ONLY 는 보조 방어일 뿐이다).
-- psql 변수 run_id(UUID), fixture_user_ids(exact 전용 UUID의 JSON 배열)가 필요하다.
-- 운영 자동 실행 없음. 부하 종료 후 스키마/배포 SHA 확인을 거친 읽기 전용 대조 템플릿.
-- UUID/주제/응답 원문을 결과에 출력하지 않는다. 집중/휴식 투영만 집계한다.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
WITH fixture AS (
    SELECT value::uuid AS user_id
    FROM jsonb_array_elements_text(:'fixture_user_ids'::jsonb)
), scoped AS (
    SELECT d.session_id, d.lifecycle
    FROM focus_session_details d
    WHERE d.user_id IN (SELECT user_id FROM fixture)
      AND d.subject LIKE 'lt:' || (:'run_id'::uuid)::text || ':%'
      AND length(d.subject) = 76
      AND right(d.subject, 36) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
), events AS (
    SELECT e.id, e.type, e.params->>'status' AS transition_status
    FROM event_outbox e
    JOIN scoped s ON e.params->>'sessionId' = s.session_id::text
    WHERE e.user_id IN (SELECT user_id FROM fixture)
      AND e.type IN ('focus.member.updated', 'rest.member.updated')
), deliveries AS (
    SELECT e.type, e.transition_status, d.target,
           CASE WHEN d.delivered_at IS NULL THEN 'PENDING' ELSE 'DELIVERED' END AS delivery_status,
           count(*) AS rows
    FROM events e JOIN event_outbox_deliveries d ON d.outbox_id = e.id
    GROUP BY e.type, e.transition_status, d.target, delivery_status
)
SELECT jsonb_build_object(
    'serverStarts', (SELECT count(*) FROM scoped),
    'completed', (SELECT count(*) FROM scoped WHERE lifecycle = 'COMPLETED'),
    'activeOrPaused', (SELECT count(*) FROM scoped WHERE lifecycle IN ('ACTIVE', 'PAUSED')),
    'abandoned', (SELECT count(*) FROM scoped WHERE lifecycle = 'ABANDONED'),
    'settlements', (SELECT count(*) FROM focus_settlements f JOIN scoped s USING (session_id)),
    'completedWithoutSettlement', (SELECT count(*) FROM scoped s
        WHERE lifecycle = 'COMPLETED' AND NOT EXISTS (SELECT 1 FROM focus_settlements f WHERE f.session_id = s.session_id)),
    'settlementWithoutCompleted', (SELECT count(*) FROM scoped s JOIN focus_settlements f USING (session_id)
        WHERE lifecycle <> 'COMPLETED'),
    'openIntervals', (SELECT count(*) FROM focus_session_intervals i JOIN scoped s USING (session_id) WHERE i.ended_at IS NULL),
    'rewardAccrualRows', (SELECT count(*) FROM focus_reward_accruals a JOIN scoped s USING (session_id)),
    'rewardAccruedFish', (SELECT coalesce(sum(a.earned_fish), 0) FROM focus_reward_accruals a JOIN scoped s USING (session_id)),
    'focusProjectionEvents', (SELECT count(*) FROM events),
    'focusProjectionDeliveries', (SELECT coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) FROM deliveries d)
);
ROLLBACK;
