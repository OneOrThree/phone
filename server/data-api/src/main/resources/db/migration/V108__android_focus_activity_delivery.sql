-- 기존 iOS 등록 계약을 유지하며 단일 기기의 Android 지속 알림 전송을 허용한다.
ALTER TABLE focus_live_activities DROP CONSTRAINT focus_live_activities_environment_check;
ALTER TABLE focus_live_activities ADD CONSTRAINT focus_live_activities_environment_check
    CHECK (environment IN ('development', 'production', 'android'));
