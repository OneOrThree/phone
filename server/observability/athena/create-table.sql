-- GROMO-2560 — S3 원본 로그(2556, gzip JSONL) Athena 외부 테이블. 실행 전 render.py 로 {{bucket}}·{{start_date}} 를 채운다.
--   python3 render.py create-table.sql --bucket <버킷> --start-date <보관 시작일 YYYY-MM-DD>
-- 키: system_log/v2/env=<env>/service=<service>/date=YYYY-MM-DD/hour=HH/<수집기 HOSTNAME>-<무작위 8자>.json.gz
--   date·hour 는 «객체 첫 레코드»의 event time(UTC)이다. 레코드 발생 시각이 아니다 — 질의는 앞뒤 여유를 둔 파티션으로 줄이고
--   본문 timestamp 로 최종 필터링한다(by-*.sql). 그래서 열 이름도 archive_date·archive_hour 로 둔다.
-- 본문의 env·service 는 파티션 값과 같아 열로 두지 않는다(Hive 는 파티션 열과 같은 이름의 데이터 열을 허용하지 않는다).
-- 모르는 필드는 SerDe 가 무시한다. raw 줄(parse_error=true)에는 log_id·timestamp 가 없다 — 질의가 observed_at 으로 대신한다.
CREATE EXTERNAL TABLE IF NOT EXISTS ops_logs (
  `schema_version` int,
  `log_id` string,
  `log_kind` string,
  `timestamp` string,
  `observed_at` string,
  `level` string,
  `logger` string,
  `thread` string,
  `message` string,
  `exception` string,
  `truncated` boolean,
  `original_size_bytes` bigint,
  `parse_error` boolean,
  `stream` string,
  `version` string,
  `instance_id` string,
  `dd` struct<trace_id:string,span_id:string>,
  `trace_id` string,
  `span_id` string,
  `legacy_trace_id` string,
  `request_id` string,
  `origin_request_id` string,
  `origin_trace_id` string,
  `user_id` string,
  `event_id` string,
  `delivery_id` string,
  `attempt` int,
  `operation_id` string,
  `event_name` string,
  `message_id` string,
  `edge_request_id` string,
  `http_method` string,
  `http_route` string,
  `http_path` string,
  `status_code` int,
  `duration_ms` bigint,
  `outcome` string
)
PARTITIONED BY (`env` string, `service` string, `archive_date` string, `archive_hour` string)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
-- 깨진 JSON 한 줄이 있으면 OpenX 는 기본으로 그 객체를 읽는 질의 전체를 실패시킨다. 수집기는 raw 줄도 JSON 으로 감싸 보관하지만(2556)
-- 그 전제가 깨진 객체(손상·잘림)가 있어도 나머지 줄은 조회되게 건너뛴다. 건너뛴 줄 수는 알 수 없다 — 그 줄은 Loki·원 컨테이너 로그로 본다.
WITH SERDEPROPERTIES ('ignore.malformed.json' = 'true')
LOCATION 's3://{{bucket}}/system_log/v2/'
TBLPROPERTIES (
  'projection.enabled' = 'true',
  'projection.env.type' = 'enum',
  'projection.env.values' = 'dev,staging,prod,unknown',
  'projection.service.type' = 'enum',
  'projection.service.values' = 'data-api,business-api,notification,realtime,nginx,canary',
  'projection.archive_date.type' = 'date',
  'projection.archive_date.format' = 'yyyy-MM-dd',
  'projection.archive_date.range' = '{{start_date}},NOW',
  'projection.archive_date.interval' = '1',
  'projection.archive_date.interval.unit' = 'DAYS',
  'projection.archive_hour.type' = 'enum',
  'projection.archive_hour.values' = '00,01,02,03,04,05,06,07,08,09,10,11,12,13,14,15,16,17,18,19,20,21,22,23',
  'storage.location.template' = 's3://{{bucket}}/system_log/v2/env=${env}/service=${service}/date=${archive_date}/hour=${archive_hour}/'
)
