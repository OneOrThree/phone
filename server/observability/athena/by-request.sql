-- GROMO-2560 — 원인 키로 관련 로그를 모아 시간순으로 본다(Grafana ②→③→④ 의 S3 판). 값은 render.py 가 채운다:
--   python3 render.py by-request.sql --env prod --from 2026-10-29T13:15:00Z --to 2026-10-29T13:30:00Z --request-id <R1>
--   키: --request-id(request_id·origin_request_id) / --trace(origin_trace_id·dd.trace_id·trace_id) / --event-id / --message-id.
--   여러 개를 주면 합집합. 안 준 키는 NULL 이 되어 아무것도 고르지 않는다.
-- 순서: ① 파티션(env·service·객체 시각 ±여유)으로 스캔을 줄인다 → ② 본문 시각으로 거른다 → ③ 원인 키로 직접 고른다
--   → ④ 고른 줄 중 operation.link 의 operation_id 로 한 번 더 고른다(semijoin, 행끼리 곱하지 않는다)
--   → ⑤ 같은 log_id 재전송만 하나로 줄이고 log_id 없는 줄은 전부 남긴다 → ⑥ 늦은 도착·시계 차이·공유 구성원 열을 붙인다.
WITH src AS (
    SELECT service, archive_date, archive_hour, "$path" AS object_key,
           log_id, log_kind, level, logger, thread, message, instance_id,
           request_id, origin_request_id, origin_trace_id, dd.trace_id AS dd_trace_id, trace_id,
           event_id, delivery_id, attempt, operation_id, event_name, message_id, observed_at,
           -- raw 줄에는 timestamp 가 없다 → 수집 시각으로 대신한다. 형식이 깨진 값 하나가 질의 전체를 죽이지 않게 try.
           coalesce(try(from_iso8601_timestamp("timestamp")), try(from_iso8601_timestamp(observed_at))) AS event_time,
           try(from_iso8601_timestamp(observed_at)) AS observed_time
    FROM ops_logs
    WHERE env = {{env}}
      AND service IN ({{services}})
      AND {{partitions}}
), win AS (
    SELECT *,
           coalesce(request_id = {{request_id}} OR origin_request_id = {{request_id}}
                    OR origin_trace_id = {{trace}} OR dd_trace_id = {{trace}} OR trace_id = {{trace}}
                    OR event_id = {{event_id}} OR message_id = {{message_id}}, false) AS direct
    FROM src
    WHERE event_time >= from_iso8601_timestamp({{from}}) AND event_time < from_iso8601_timestamp({{to}})
), linked_operations AS (
    SELECT DISTINCT operation_id FROM win
    WHERE direct AND event_name = 'operation.link' AND operation_id IS NOT NULL
), selected AS (
    SELECT * FROM win
    WHERE direct OR operation_id IN (SELECT operation_id FROM linked_operations)
), deduped AS (
    -- 같은 log_id = 같은 로그의 재전송 사본. 가장 먼저 수집된 사본 하나만 남긴다.
    SELECT * FROM (
        SELECT selected.*,
               row_number() OVER (PARTITION BY log_id ORDER BY observed_at, object_key) AS copy_no,
               count(*) OVER (PARTITION BY log_id) AS copies
        FROM selected
        WHERE log_id IS NOT NULL
    ) WHERE copy_no = 1
    UNION ALL
    -- log_id 가 없는 줄(raw·구형)은 같은 로그인지 판정할 키가 없다 — 지우지 않고 전부 남긴다.
    SELECT selected.*, CAST(NULL AS bigint) AS copy_no, CAST(NULL AS bigint) AS copies
    FROM selected
    WHERE log_id IS NULL
), marked AS (
    SELECT *,
           -- 같은 event_id 의 data-api outbox.delivery(전달 시도 결과) 중 가장 이른 시각. 이 로그는 브로커 ack «뒤»에 남으므로
           -- 소비 쪽 줄이 조금 앞설 수는 있다. 허용 오차보다 더 앞서면 호스트 시계 차이로 본다.
           min(CASE WHEN service = 'data-api' AND event_name = 'outbox.delivery' THEN event_time END)
               OVER (PARTITION BY event_id) AS producer_time,
           CASE WHEN operation_id IS NOT NULL THEN
               sum(CASE WHEN event_name = 'operation.link' THEN 1 ELSE 0 END) OVER (PARTITION BY operation_id) END
               AS operation_members
    FROM deduped
)
SELECT event_time,
       service,
       level,
       event_name,
       CASE WHEN direct THEN 'direct' ELSE 'operation' END AS relation,
       -- 원인 키로는 안 잡히고 operation 으로만 들어온 연결 로그 = 같은 발송을 함께 쓴 다른 원인의 구성원
       (event_name = 'operation.link' AND NOT direct) AS shared_member,
       operation_members,
       request_id, origin_request_id, origin_trace_id, dd_trace_id, event_id, delivery_id, attempt, operation_id, message_id,
       -- 늦은 도착: 발생과 수집 사이가 길다. 시각 순서는 믿어도 되고, 다른 시간 파티션 객체에 들어 있을 수 있다.
       date_diff('second', event_time, observed_time) AS arrival_lag_s,
       coalesce(date_diff('second', event_time, observed_time) > {{late_seconds}}, false) AS late_arrival,
       (format_datetime(event_time AT TIME ZONE 'UTC', 'yyyy-MM-dd') <> archive_date
        OR format_datetime(event_time AT TIME ZONE 'UTC', 'HH') <> archive_hour) AS other_hour_object,
       -- 시계 차이: 서비스 간 시각 순서를 믿으면 안 된다. 단계 순서(outbox.delivery → consumer.accept → ...)로 읽는다.
       CASE WHEN event_id IS NOT NULL AND service <> 'data-api' AND producer_time IS NOT NULL
            THEN date_diff('millisecond', producer_time, event_time) END AS skew_ms,
       coalesce(event_id IS NOT NULL AND service <> 'data-api'
                AND date_diff('millisecond', producer_time, event_time) < -{{skew_ms}}, false) AS clock_skew_suspect,
       log_id, copies, instance_id, thread, logger, message, observed_at, object_key
FROM marked
ORDER BY event_time, service, coalesce(log_id, ''), message
