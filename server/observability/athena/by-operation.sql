-- GROMO-2560 — 기기별 발송 한 번(operation_id)의 전말: 참여한 구성원(operation.link)·외부 호출 결과(transport.result)·
-- 그 안의 실패 로그·DB 반영(dispatch.settle). Grafana ④ 의 S3 판. 값은 render.py 가 채운다:
--   python3 render.py by-operation.sql --env prod --from ... --to ... --operation-id <OP>
-- dispatch.settle 에는 operation_id 가 없다(Notification 코드가 그렇게 남긴다). 연결 로그의 (delivery_id, attempt) 로 찾는다 —
-- 같은 dispatch 실행이 남긴 settle 이다. 구성원이 여럿이면(공유 발송) 구성원마다 원인 키가 다르게 보인다 — 한 원인으로 합치지 않는다.
WITH src AS (
    SELECT service, archive_date, archive_hour, "$path" AS object_key,
           log_id, log_kind, level, logger, thread, message, instance_id,
           request_id, origin_request_id, origin_trace_id, dd.trace_id AS dd_trace_id, trace_id,
           event_id, delivery_id, attempt, operation_id, event_name, message_id, observed_at,
           coalesce(try(from_iso8601_timestamp("timestamp")), try(from_iso8601_timestamp(observed_at))) AS event_time,
           try(from_iso8601_timestamp(observed_at)) AS observed_time
    FROM ops_logs
    WHERE env = {{env}}
      AND service IN ({{services}})
      AND {{partitions}}
), win AS (
    SELECT * FROM src
    WHERE event_time >= from_iso8601_timestamp({{from}}) AND event_time < from_iso8601_timestamp({{to}})
), members AS (
    SELECT DISTINCT delivery_id, attempt FROM win
    WHERE service = 'notification' AND event_name = 'operation.link' AND operation_id = {{operation_id}}
), selected AS (
    SELECT * FROM win
    WHERE operation_id = {{operation_id}}
       OR (service = 'notification' AND event_name = 'dispatch.settle'
           AND EXISTS (SELECT 1 FROM members m
                       WHERE m.delivery_id = win.delivery_id AND m.attempt IS NOT DISTINCT FROM win.attempt))
), deduped AS (
    SELECT * FROM (
        SELECT selected.*,
               row_number() OVER (PARTITION BY log_id ORDER BY observed_at, object_key) AS copy_no,
               count(*) OVER (PARTITION BY log_id) AS copies
        FROM selected
        WHERE log_id IS NOT NULL
    ) WHERE copy_no = 1
    UNION ALL
    SELECT selected.*, CAST(NULL AS bigint) AS copy_no, CAST(NULL AS bigint) AS copies
    FROM selected
    WHERE log_id IS NULL
)
SELECT event_time,
       service,
       level,
       event_name,
       sum(CASE WHEN event_name = 'operation.link' THEN 1 ELSE 0 END) OVER () AS operation_members,
       origin_request_id, origin_trace_id, event_id, delivery_id, attempt, operation_id,
       date_diff('second', event_time, observed_time) AS arrival_lag_s,
       coalesce(date_diff('second', event_time, observed_time) > {{late_seconds}}, false) AS late_arrival,
       (format_datetime(event_time AT TIME ZONE 'UTC', 'yyyy-MM-dd') <> archive_date
        OR format_datetime(event_time AT TIME ZONE 'UTC', 'HH') <> archive_hour) AS other_hour_object,
       log_id, copies, instance_id, thread, logger, message, observed_at, object_key
FROM deduped
ORDER BY event_time, service, coalesce(log_id, ''), message
