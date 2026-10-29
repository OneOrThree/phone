-- GROMO-2557 Outbox 봉투에 최초 원인 요청의 로그 문맥을 남긴다.
--
-- event_outbox:
--   origin_request_id      append 한 요청의 request_id(또는 이미 있던 origin). 로그 계약 §2.1 형식만 저장한다.
--   origin_trace_id        append 순간 활성 tracer 의 trace id 원문(dd-trace-api CorrelationIdentifier). 정규화하지 않는다 —
--                          10진(64bit)과 32자리 hex 가 섞일 수 있다. agent 가 없거나 trace 가 없으면("0") 비운다.
--   trace_context_version  위 두 값의 형식 버전. 하나라도 있으면 1, 둘 다 없으면 null.
--
-- NULL 허용 · 기본값 · 백필 · 인덱스 없음: 이 배포 전 행과 스케줄러 발 append 는 원인 요청이 없다 — 값을 지어 넣지 않는다.
-- 조회는 로그 저장소에서 하므로 DB 인덱스가 필요 없다. 봉투 본문(params)·멱등 키·전달 행은 바꾸지 않는다.
-- 이 열을 모르는 이전 이미지도 그대로 돈다(Hibernate validate 는 모르는 열을 무시하고, 삽입은 null 로 남는다).
ALTER TABLE event_outbox
    ADD COLUMN origin_request_id varchar(128),
    ADD COLUMN origin_trace_id varchar(64),
    ADD COLUMN trace_context_version smallint;
