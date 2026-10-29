-- GROMO-2560 — 서비스·시간·level 로 일반 로그를 본다(Grafana ① 의 S3 판, 줄 수 상한 없음). 값은 render.py 가 채운다:
--   python3 render.py by-window.sql --env prod --from ... --to ... --services data-api [--levels ERROR,WARN]
-- Loki 상한(같은 시각에 줄이 몰린 경우 포함)에 막혔을 때, 또는 Loki 보관 기간(7일) 밖일 때 쓴다.
-- --levels 를 주면 level 이 없는 raw 줄(parse_error)은 빠진다. 안 주면 raw 줄도 log_id 없이 전부 남는다.
WITH src AS (
    SELECT service, archive_date, archive_hour, "$path" AS object_key,
           log_id, log_kind, level, logger, thread, message, exception, instance_id, parse_error,
           request_id, origin_request_id, event_id, operation_id, message_id, observed_at,
           coalesce(try(from_iso8601_timestamp("timestamp")), try(from_iso8601_timestamp(observed_at))) AS event_time,
           try(from_iso8601_timestamp(observed_at)) AS observed_time
    FROM ops_logs
    WHERE env = {{env}}
      AND service IN ({{services}})
      AND {{partitions}}
), selected AS (
    SELECT * FROM src
    WHERE event_time >= from_iso8601_timestamp({{from}}) AND event_time < from_iso8601_timestamp({{to}})
      AND {{level_filter}}
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
       log_kind,
       coalesce(parse_error, false) AS parse_error,
       request_id, origin_request_id, event_id, operation_id, message_id,
       date_diff('second', event_time, observed_time) AS arrival_lag_s,
       coalesce(date_diff('second', event_time, observed_time) > {{late_seconds}}, false) AS late_arrival,
       (format_datetime(event_time AT TIME ZONE 'UTC', 'yyyy-MM-dd') <> archive_date
        OR format_datetime(event_time AT TIME ZONE 'UTC', 'HH') <> archive_hour) AS other_hour_object,
       log_id, copies, instance_id, thread, logger, message, exception, observed_at, object_key
FROM deduped
ORDER BY event_time, service, coalesce(log_id, ''), message
