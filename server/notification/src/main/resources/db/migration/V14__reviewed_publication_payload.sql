-- 관리자 발행 문구는 승인 이후 템플릿 변경과 독립적으로 보관한다.
ALTER TABLE deliveries ADD COLUMN reviewed_push jsonb;

-- 운영 서비스 공지는 수신 설정과 조용한 시간을 지킨다. 임의 전체 발송 경로는 제공하지 않는다.
INSERT INTO kinds(id, silent, quiet_policy) VALUES('ADMIN_ANNOUNCEMENT', false, 'DEFER');
