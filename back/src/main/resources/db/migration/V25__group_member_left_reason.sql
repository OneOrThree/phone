-- A-0 소프트삭제: 탈퇴/강퇴 구분 마커.
-- NULL = 활성 멤버, 'LEFT' = 자진 탈퇴(재참여 허용), 'KICKED' = 강퇴(재참여 차단).
-- is_left 컬럼은 V2 에서 이미 추가됨 — 이번엔 사유 컬럼만 신설한다.
ALTER TABLE group_members ADD COLUMN left_reason varchar(10);

ALTER TABLE group_members
    ADD CONSTRAINT group_members_left_reason_check
    CHECK (left_reason IS NULL OR left_reason IN ('LEFT', 'KICKED'));
