-- 탈퇴자의 원문·발신자 연결을 파기하되 읽음·페이지 커서의 기준 ID는 보존한다.
ALTER TABLE chat_messages ALTER COLUMN sender_id DROP NOT NULL;
CREATE INDEX ix_chat_messages_sender ON chat_messages (sender_id) WHERE sender_id IS NOT NULL;

-- 이미 수신한 탈퇴 사건에도 같은 정책을 적용한다.
UPDATE chat_messages m
SET content = '', sender_id = NULL, client_message_id = m.id
FROM user_tombstones t
WHERE m.sender_id = t.user_id;
