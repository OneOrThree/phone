-- 관리 원장은 최신순 커서 페이지로 조회한다. 인덱스가 없으면 매 페이지 전체 정렬한다.
-- Flyway 부팅 마이그레이션에서는 CONCURRENTLY가 자기 트랜잭션과 대기할 수 있어 일반 인덱스를 쓴다.
CREATE INDEX deliveries_history_order ON deliveries(created_at DESC, id DESC);
