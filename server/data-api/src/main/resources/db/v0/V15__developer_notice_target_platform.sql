ALTER TABLE developer_notices
    ADD COLUMN target_platform varchar(10) NOT NULL DEFAULT 'ALL',
    ADD CONSTRAINT developer_notices_target_platform_check
        CHECK (target_platform IN ('ALL', 'IOS', 'ANDROID'));
