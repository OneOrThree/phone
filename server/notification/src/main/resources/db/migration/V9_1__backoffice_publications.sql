-- 관리자 발행 문구는 승인 이후 템플릿 변경과 독립적으로 보관한다.
ALTER TABLE deliveries ADD COLUMN reviewed_push jsonb;

-- 운영 서비스 공지는 수신 설정과 조용한 시간을 지킨다. 임의 전체 발송 경로는 제공하지 않는다.
INSERT INTO kinds(id, silent, quiet_policy) VALUES('ADMIN_ANNOUNCEMENT', false, 'DEFER');

-- 관리 원장은 최신순 커서 페이지로 조회한다. 인덱스가 없으면 매 페이지 전체 정렬한다.
-- Flyway 부팅 마이그레이션에서는 CONCURRENTLY가 자기 트랜잭션과 대기할 수 있어 일반 인덱스를 쓴다.
CREATE INDEX deliveries_history_order ON deliveries(created_at DESC, id DESC);
