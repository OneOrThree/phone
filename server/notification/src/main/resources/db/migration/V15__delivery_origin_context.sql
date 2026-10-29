-- 발송 작업 행에 최초 원인 요청의 로그 문맥을 남긴다 (GROMO-2557).
--
-- 수신(Kafka·내부 HTTP)과 실제 발송은 다른 시각·스레드라, 발송 쪽 로그가 원요청으로 이어지려면 값이 행에 있어야 한다.
--   origin_request_id  Data relay 헤더 x-origin-request-id(없으면 인증된 내부 HTTP 의 X-Request-Id). 형식 검사를 통과한 값만.
--   origin_trace_id    relay 헤더 x-origin-trace-id 원문(10진·32자리 hex 그대로).
--
-- NULL 허용 · 기본값 · 백필 · 인덱스 없음: 이 배포 전 행과 헤더 없는 구버전 레코드는 원인을 모른다 — 지어 넣지 않는다.
-- 행은 enqueue 의 INSERT 한 번에만 채운다. 같은 사건의 재전달은 inbound_events 멱등과 ON CONFLICT DO NOTHING 이라
-- 기존 행의 값을 덮지 않는다. envelope_hash 대상 본문은 바꾸지 않는다.
ALTER TABLE deliveries
    ADD COLUMN origin_request_id varchar(128),
    ADD COLUMN origin_trace_id varchar(64);
