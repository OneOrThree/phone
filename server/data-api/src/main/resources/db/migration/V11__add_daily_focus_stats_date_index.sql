-- V11 — 평균 집중 집계 쿼리용 인덱스 2종 (GROMO-753 코드리뷰 후속)
-- 배경: 평균 집중 API(getFocusAverage)의 TOTAL/CATEGORY 집계는 daily_focus_stats 를 date BETWEEN 으로만 스캔한다.
--       현재 daily_focus_stats 인덱스는 PK(id) + UNIQUE(user_id, date) 뿐 — 선행 컬럼이 user_id 라
--       user_id 필터 없는 기간 집계는 인덱스를 못 타고 full scan(유저 증가 시 O(N) 열화).
--       CATEGORY 는 추가로 users.occupation 을 필터하는데 occupation 단독 인덱스가 없다.
-- 방향: date 단독 인덱스로 기간 집계의 range scan 을, occupation 인덱스로 카테고리 모수 좁히기를 지원한다.
--       (user_id 선행 조회 경로는 기존 UNIQUE(user_id, date) 가 그대로 커버 — 중복 아님)
-- 버전 주의: 이미 배포된 daily_screen_time_finalized 가 V10 을 사용하므로 미배포 인덱스 마이그레이션을 V11 로 옮긴다.
-- 참고: ci 프로파일은 Flyway 비활성(create-drop)이라 테스트에선 이 마이그레이션이 실행되지 않는다(정상).

-- TOTAL/CATEGORY 집계의 date BETWEEN range scan 지원 (user_id 선행 아님 → 전체 기간 스캔 대응)
CREATE INDEX idx_daily_focus_stats_date ON daily_focus_stats (date);

-- CATEGORY 집계가 users.occupation = ? 로 모수를 좁힐 때 사용
CREATE INDEX idx_users_occupation ON users (occupation);
