ALTER TABLE developer_notices
    ADD COLUMN target_platform varchar(10) NOT NULL DEFAULT 'ALL',
    ADD CONSTRAINT developer_notices_target_platform_check
        CHECK (target_platform IN ('ALL', 'IOS', 'ANDROID'));

-- 기존 행은 게시 규칙과 같게 최소 버전에서 정한다: iOS 만 → IOS, Android 만 → ANDROID, 나머지(둘 다·없음)는 ALL.
UPDATE developer_notices
SET target_platform = CASE
    WHEN min_ios_version IS NOT NULL AND min_android_version IS NULL THEN 'IOS'
    WHEN min_ios_version IS NULL AND min_android_version IS NOT NULL THEN 'ANDROID'
    ELSE 'ALL'
END;
