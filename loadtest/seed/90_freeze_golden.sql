-- golden 동결 — template0 방식: 복제(TEMPLATE) 가능하되 접속 불가.
-- 이후 리셋은 make reset: DROP DATABASE loadtest; CREATE DATABASE loadtest TEMPLATE golden;
-- (같은 인스턴스 내 파일 수준 복사라 분 단위. golden 에 접속이 없어야 복제 가능 — 그래서 접속 차단이 겸사)
ALTER DATABASE golden ALLOW_CONNECTIONS false;
ALTER DATABASE golden IS_TEMPLATE true;
