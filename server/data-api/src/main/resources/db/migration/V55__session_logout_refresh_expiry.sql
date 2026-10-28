-- GROMO-1757: 원 RT 종료 증명. 기존 폐기 행은 NULL로 유지하여 신규 성공 재생으로 승격하지 않는다.
ALTER TABLE auth_sessions ADD COLUMN logout_refresh_expires_at timestamp(6) with time zone;
