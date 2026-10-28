-- iOS Activity 수명 제한을 Android 집중 세션에 적용하지 않는다.
ALTER TABLE focus_live_activities ALTER COLUMN expires_at DROP NOT NULL;
UPDATE focus_live_activities SET expires_at = NULL WHERE environment = 'android';
