-- GROMO-1894 친구 요청 취소 상태 (friend-letter LLD §1.11 · §2).
-- V1__baseline.sql 의 friendships_status_check 에 CANCELED 를 더한다. 다른 컬럼은 손대지 않는다.
-- 편지(letters) 테이블은 여기 넣지 않는다 — LLD §4 결정 1·2 와 본문 길이 상한(HLD §2.1)이 미결이라
-- 구현 착수 전 확인이 선행돼야 한다. 확정되면 별도 V 로 추가한다.
ALTER TABLE friendships DROP CONSTRAINT friendships_status_check;
ALTER TABLE friendships ADD CONSTRAINT friendships_status_check
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELED'));
