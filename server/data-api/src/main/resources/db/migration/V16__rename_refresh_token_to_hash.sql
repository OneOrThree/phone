-- GROMO-713: Refresh Token을 평문이 아닌 SHA-256 해시로 저장하도록 전환한다.
-- 컬럼이 담는 값이 토큰 원본에서 해시로 바뀌므로 이름도 함께 정정해 오용을 막는다.
ALTER TABLE users RENAME COLUMN refresh_token TO refresh_token_hash;

-- 기존에 저장된 평문 RT는 해시 조회(SHA-256 매칭)에 걸리지 않는 죽은 값이다.
-- 남겨두면 유출 시 그대로 재사용 가능한 자격증명이므로 정리한다.
-- (해당 사용자는 재로그인 필요 — fail-closed 정책, 백필하지 않는다)
UPDATE users SET refresh_token_hash = NULL;
