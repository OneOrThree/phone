-- make reset — loadtest ← golden TEMPLATE 복제로 매 run 동일 출발선 (설계 §1-5).
-- SUT app 이 붙어 있으면 DROP 이 막히므로 잔여 접속을 먼저 강제 종료 —
-- 그래서 test 파이프라인 순서가 reset → app 기동이다.
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
WHERE datname = 'loadtest' AND pid <> pg_backend_pid();

DROP DATABASE IF EXISTS loadtest;
CREATE DATABASE loadtest TEMPLATE golden;
