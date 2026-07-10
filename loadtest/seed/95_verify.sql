-- 시드 검증 — golden 동결 전에 실행 (동결 후엔 접속 불가). 결과는 seed.sh 로그로 남아
-- volume.md 와 대조한다. make seed-verify(M7)도 이 파일을 재사용(대상: loadtest DB).
\set ON_ERROR_STOP on

-- 1) 테이블별 건수 — volume.md 대조용
SELECT relname AS table_name, n_live_tup AS rows
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;

-- 2) DB 크기 — "데이터 > SUT RAM(8GB)" 조건 확인
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;

-- 3) 커서 정렬 검증 (PRD M4 — API 이전 단계라 SQL 로 직접):
--    id DESC 표본 1만 건에서 started_at 이 단조 감소하는지. seed_uuid_v7 은 ms 프리픽스라
--    같은 ms 내 순서는 보장 안 함 → 1초 허용 오차.
SELECT count(*) AS cursor_order_violations
FROM (SELECT started_at,
             lag(started_at) OVER (ORDER BY id DESC) AS prev_started
      FROM (SELECT id, started_at FROM focus_sessions ORDER BY id DESC LIMIT 10000) s) t
WHERE prev_started IS NOT NULL
  AND started_at > prev_started + interval '1 second';

-- 4) FK 유도 공식 무결성 표본 — focus_sessions.focus_tag_id 가 실존 user_focus_tags 인지
SELECT count(*) AS dangling_tag_refs
FROM (SELECT focus_tag_id FROM focus_sessions LIMIT 100000) fs
LEFT JOIN user_focus_tags t ON t.id = fs.focus_tag_id
WHERE fs.focus_tag_id IS NOT NULL AND t.id IS NULL;
