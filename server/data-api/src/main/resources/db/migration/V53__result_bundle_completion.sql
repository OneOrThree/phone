-- 결과 슬롯의 불변 기대 사건 집합. 전달 지연과 슬롯 완료를 구별한다.
CREATE TABLE notification_result_bundle_members (
    event_id varchar(200) PRIMARY KEY,
    user_id uuid NOT NULL,
    group_id uuid NOT NULL,
    slot_at timestamptz NOT NULL
);
CREATE INDEX ix_result_bundle_members_slot ON notification_result_bundle_members(group_id, slot_at, user_id);
CREATE TABLE notification_result_bundle_slots (
    group_id uuid NOT NULL,
    slot_at timestamptz NOT NULL,
    sealed_at timestamptz NOT NULL,
    PRIMARY KEY(group_id, slot_at)
);
CREATE TABLE notification_result_bundle_manifests (
    user_id uuid NOT NULL,
    group_id uuid NOT NULL,
    slot_at timestamptz NOT NULL,
    event_ids jsonb NOT NULL,
    published_at timestamptz,
    PRIMARY KEY(user_id, group_id, slot_at)
);
CREATE INDEX ix_result_bundle_unpublished ON notification_result_bundle_manifests(slot_at)
    WHERE published_at IS NULL;
-- 배포 전에 이미 내구화된 사건도 같은 완료 경계에 들어간다.
INSERT INTO notification_result_bundle_members(event_id,user_id,group_id,slot_at)
SELECT event_id,user_id,(params->>'groupId')::uuid,(params->>'slotAt')::timestamptz
FROM event_outbox WHERE type='notification.requested'
    AND params->>'kind' IN ('BET_RESULT','BET_VOID_REFUND')
    AND params->>'groupId' IS NOT NULL AND params->>'slotAt' IS NOT NULL;
