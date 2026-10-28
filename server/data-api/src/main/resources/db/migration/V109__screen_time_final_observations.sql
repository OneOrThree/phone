-- 중간 관측과 하루 전체의 최종 관측을 분리한다. 과거의 당일 수치는 보상 근거로 승격하지 않는다.
ALTER TABLE screen_time_observations ADD COLUMN finalized boolean NOT NULL DEFAULT false;
UPDATE screen_time_observations SET finalized = true
WHERE measured_at >= ((measured_date + 1)::timestamp AT TIME ZONE 'UTC');
