-- 이관의 scalar version은 최종 snapshot 적재까지 바뀔 수 있다.
-- 개방 전 backfill하지 않고, 첫 개방 후 설정 쓰기가 기존 version으로 원자 초기화한다.
ALTER TABLE settings
    ADD COLUMN notification_enabled_version bigint,
    ADD COLUMN sound_enabled_version bigint,
    ADD COLUMN night_mode_enabled_version bigint,
    ADD COLUMN night_start_time_version bigint,
    ADD COLUMN night_end_time_version bigint;
