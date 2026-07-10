-- 대형 4테이블 제약 복원 + 통계 갱신 — 20_facts.sql 이 저장해 둔 정의를 그대로 재부착.
-- 제약명·정의를 pg_get_constraintdef 로 저장했으므로 마이그레이션이 이름을 바꿔도 이 파일은 불변.
\set ON_ERROR_STOP on
SET maintenance_work_mem = '2GB'; -- 인덱스 빌드 가속 (설계 문서 §1-4)

DO $$
DECLARE r record;
BEGIN
  -- PK(0) → UNIQUE(1) → FK(2) 순서로 복원 — FK 가 참조할 키가 먼저 서야 한다
  FOR r IN SELECT tbl, conname, def FROM seed_saved_constraints ORDER BY ord ASC, conname LOOP
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', r.tbl, r.conname, r.def);
  END LOOP;
END $$;

DROP TABLE seed_saved_constraints;

-- 플래너 통계 동결 — 이 상태가 golden 에 담겨 모든 run 이 같은 플랜 기반에서 출발 (설계 문서 §1-4)
VACUUM ANALYZE;

-- 검증 요약 (건수는 seed.sh 로그에서 volume.md 와 대조)
SELECT relname, n_live_tup
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC
LIMIT 15;
