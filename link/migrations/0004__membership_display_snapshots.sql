-- Data의 표시정보 version은 (groupId, inviterId) 축이다.
-- 두 delta가 역순 도착해도 서로 다른 필드가 소실되지 않게 각각 비교한다.
CREATE TABLE link_display_snapshots (
    group_id uuid NOT NULL,
    inviter_id uuid NOT NULL,
    group_name text,
    group_name_version bigint NOT NULL DEFAULT 0,
    inviter_name text,
    inviter_name_version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (group_id, inviter_id)
);
