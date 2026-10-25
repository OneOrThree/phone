-- GROMO-2477 집중섬에서 앉은 자리 — 시작 때 앱이 고른 지도 % 좌표(0~100)를 그대로 세션에 저장해 주민 목록·사건으로 나눈다.
--
-- focus_session_details:
--   seat_x, seat_y  지도 % 좌표. 반올림하지 않는다(앱 focusSpot 그대로). 자리 없이 시작한 세션(옛 앱·바다 세션)은 둘 다 null.
--   땅·겹침 판정은 앱 몫이라 DB 는 «둘 다 null 이거나 둘 다 0~100» 만 묶는다. NaN 은 PostgreSQL 에서 모든 수보다 커서
--   BETWEEN 에 걸려 거절된다. 모닥불 자리는 서버가 배정하는 rest_seat 로 그대로다.
--   IS NOT NULL 을 따로 적는 이유: 한쪽만 null 이면 BETWEEN 이 NULL 이 되고, CHECK 는 NULL 을 통과시킨다.
ALTER TABLE focus_session_details
    ADD COLUMN seat_x double precision,
    ADD COLUMN seat_y double precision,
    ADD CONSTRAINT focus_session_details_seat_ck CHECK (
        (seat_x IS NULL AND seat_y IS NULL)
        OR (seat_x IS NOT NULL AND seat_y IS NOT NULL
            AND seat_x BETWEEN 0 AND 100 AND seat_y BETWEEN 0 AND 100));
