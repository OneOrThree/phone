-- 구 RT를 세션으로 승격할 때만 당시 기기를 연결한다. 기존 다중 세션에 현재 유저 토큰을 추정 백필하지 않는다.
ALTER TABLE auth_sessions ADD COLUMN legacy_device_token text;
