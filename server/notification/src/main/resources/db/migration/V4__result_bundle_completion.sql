CREATE TABLE result_bundle_manifests (
    user_id uuid NOT NULL,
    group_id uuid NOT NULL,
    slot_at timestamptz NOT NULL,
    event_ids jsonb NOT NULL,
    PRIMARY KEY(user_id, group_id, slot_at)
);
-- Data의 5분 트리거는 실제 발송 대신 정본 슬롯 완료를 내구화한다.
INSERT INTO jobs(id,owner,cron,config) VALUES
('notification-bet-event-flush','DATA','0 */5 * * * *',
 '{"replayable":false,"target":"NotificationScheduler#flushBetEventNotifications","note":"정본 재훑기 커밋 뒤 결과 슬롯 봉인과 완료 outbox 발행. 내구 원장에서 자동 재개한다."}'::jsonb);
