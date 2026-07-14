-- GROMO-805: 오늘 스크린타임 row 가 interim 인지 final 인지 구분한다.
-- week/month 오늘 집계는 interim이면 현재 목표로 재계산하고, final이면 저장된 클라 스냅샷을 사용한다.
ALTER TABLE daily_screen_time_stats
    ADD COLUMN is_screen_time_finalized boolean NOT NULL DEFAULT false;
