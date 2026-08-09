-- GROMO-1252 (코드리뷰 3차 ①): 세션의 '날짜별 집중 초' 분포 보관 컬럼.
--
-- 완료 시점에 확정한 분포(앱이 실어 보낸 값을 날짜별 벽시계 몫으로 클램프한 결과, 없으면 벽시계 분할)를
-- 사전집계(daily_focus_stats)에만 쓰고 버려서, 같은 화면의 by-category(/stats/by-category)는 여전히
-- 구간을 벽시계로 잘라 총합이 어긋났다(일시정지가 자정을 걸치면 300/300 vs 600/900).
-- 여기 보관해 조회 집계·앱 복원이 사전집계와 같은 분포를 쓰게 한다.
--
-- 키는 유저 존(country_code 파생, CountryZoneResolver) 로컬 날짜 "YYYY-MM-DD", 값은 그 날짜의 집중 초.
-- 레거시 행은 NULL — 조회측이 종전 벽시계 클리핑으로 폴백한다.
ALTER TABLE focus_sessions ADD COLUMN focus_seconds_by_date jsonb;
