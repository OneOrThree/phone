-- V50 — friendships 역방향(수신자) 조회 인덱스 (GROMO-1630)
--
-- 친구 판정 쿼리들은 양방향 OR(from_user_id = :me OR to_user_id = :me)인데,
-- 기존 인덱스는 (from_user_id, to_user_id) 부분 unique뿐이라 to_user_id 브랜치가
-- 순차 스캔이다. 리그 랭킹 isFriend 후조인(GROMO-1630)이 이 쿼리를 랭킹 조회
-- 핫패스(리그·홈·집중세션 폴링)에 올리면서, 받은 요청 목록·친구 수 집계 등
-- 기존 수신자 축 조회까지 함께 인덱스를 타도록 to_user_id 선두 인덱스를 추가한다.

CREATE INDEX IF NOT EXISTS idx_friendships_to_user_id
    ON public.friendships (to_user_id);
