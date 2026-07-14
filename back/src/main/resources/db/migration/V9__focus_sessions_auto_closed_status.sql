-- GROMO-804: focus_sessions.status CHECK 제약에 AUTO_CLOSED 추가.
-- orphan 자동 종료(sweepOrphanSessions) 세션을 status=AUTO_CLOSED 로 표시해 by-category 실시간 집계에서 제외한다.
-- V2 원본 제약(ACTIVE/COMPLETED/CANCELED)과 동일 포맷으로 DROP 후 AUTO_CLOSED 만 추가해 재생성한다.
ALTER TABLE focus_sessions DROP CONSTRAINT focus_sessions_status_check;
ALTER TABLE focus_sessions
    ADD CONSTRAINT focus_sessions_status_check
    CHECK ((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'COMPLETED'::character varying, 'CANCELED'::character varying, 'AUTO_CLOSED'::character varying])::text[]));
