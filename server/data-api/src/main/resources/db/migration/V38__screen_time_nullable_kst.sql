-- V38 — daily_screen_time_stats.total_screen_time_minutes nullable 화 (GROMO-1267, FR-16 · 정책 B7)
--
-- "0분 사용"과 "미집계"는 다르다 — SCREEN_TIME 은 클라 보고 데이터라 값이 안 오면 0 이 아니라
-- 미집계(null)다. 종전엔 측정 누락(actualScreenTimeMinutes null)을 0 으로 뭉개 저장해 미보고가
-- "0분 사용 = 목표 달성"으로 뒤집힐 수 있었다(정책 B7 — 구 D5 갭 해소). NOT NULL 을 풀고
-- 저장 경로(ScreenTimeService)가 미집계를 null 로 남긴다. FOCUS 는 서버 실측이라 "행 없음 = 0분"이
-- 사실이므로 그대로 0 으로 접는다(FR-15).
--
-- 기존 데이터 정정은 없다: 이미 0 으로 저장된 행에서 "실제 0분"과 "미집계 뭉개짐"을 사후에
-- 구분할 방법이 없다 — forward-only 로 수용한다.
--
-- KST 통일(GROMO-1259, N8 · FR-19) 데이터 정정도 없다: 유저 존 매핑이 있던 국가는 KR · JP · GB
-- 뿐이고 KR · JP 는 UTC+9 로 KST 와 동일 버킷이라 어긋난 행이 없으며, GB 행은 일 집계라 원본
-- 시각이 남아 있지 않아 재버킷이 불가능하다. 해외 유저 어긋남은 알려진 한계 L5 로 수용
-- (docs/prd/challenge/prd.md L5 · policy.md B3).

ALTER TABLE daily_screen_time_stats
    ALTER COLUMN total_screen_time_minutes DROP NOT NULL;
