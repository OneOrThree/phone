-- UTC 퀘스트 일계와 KST 도서관 일계를 독립된 관측으로 보관한다.
ALTER TABLE screen_time_observations ADD COLUMN timezone varchar(32) NOT NULL DEFAULT 'UTC';
ALTER TABLE screen_time_observations DROP CONSTRAINT uq_screen_time_observation;
ALTER TABLE screen_time_observations ADD CONSTRAINT uq_screen_time_observation
    UNIQUE (user_id, device_id, measured_date, timezone, measured_at);
ALTER TABLE screen_time_observations ADD CONSTRAINT screen_time_observations_timezone_check
    CHECK (timezone IN ('UTC', 'Asia/Seoul'));
