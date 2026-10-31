ALTER TABLE developer_notices
    ADD COLUMN min_ios_version varchar(32),
    ADD COLUMN min_android_version varchar(32),
    ADD CONSTRAINT developer_notices_min_ios_format CHECK
        (min_ios_version IS NULL OR min_ios_version ~ '^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$'),
    ADD CONSTRAINT developer_notices_min_android_format CHECK
        (min_android_version IS NULL OR min_android_version ~ '^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$');
