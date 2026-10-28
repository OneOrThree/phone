-- 새 섬 사건은 기존 알림/링크 전송에 섞지 않는다. 전용 transport가 등록될 때까지 내구 보류한다.
ALTER TABLE event_outbox_deliveries
    DROP CONSTRAINT event_outbox_deliveries_target_check;
ALTER TABLE event_outbox_deliveries
    ADD CONSTRAINT event_outbox_deliveries_target_check
    CHECK (target IN ('KAFKA', 'LINK', 'NOTI', 'REALTIME'));
