-- GROMO-1924: 집중 세션 시작 게이트의 선행 조건.

-- 1) 소속 상실 종결 사유 (선행 조건 #7, 2026-09-18 결정 FR-D03 = B1 「강제 종료, 미정산」).
--    강퇴 TX 가 진행 세션을 MEMBERSHIP_LOST 로 끝낸다. ABANDONED(기본 마커가 밖에서 닫힌 사고의 정리)와
--    섞으면 원인 추적이 안 되므로 값을 나눈다. 15자라 V58 의 varchar(10) 를 넓힌다.
--    V58 의 인라인 CHECK 는 PostgreSQL 기본 이름(<table>_<column>_check)으로 만들어졌다.
--    두 부분 인덱스(user_progressing_uk · rest_seat_uk)의 조건은 ACTIVE/PAUSED 만 보므로 그대로다.
ALTER TABLE focus_session_details DROP CONSTRAINT focus_session_details_lifecycle_check;
ALTER TABLE focus_session_details ALTER COLUMN lifecycle TYPE varchar(20);
ALTER TABLE focus_session_details ADD CONSTRAINT focus_session_details_lifecycle_check
    CHECK (lifecycle IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED', 'MEMBERSHIP_LOST'));
