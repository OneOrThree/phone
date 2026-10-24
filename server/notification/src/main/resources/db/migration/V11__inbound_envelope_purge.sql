-- GROMO-2212 탈퇴자의 알림 수신 원문 파기.
-- 수신 멱등은 원문이 아니라 envelope_hash 로 판정한다 — 원문을 지운 뒤에도 같은 eventId 의 같은 봉투는
-- 수락하고 다른 봉투는 EVENT_ID_CONFLICT 로 거절한다. 해시 식은 InboundService.ENVELOPE_HASH 와 같아야 한다
-- (jsonb 텍스트 표현의 SHA-256 — 키 순서·공백이 정규화된다).
ALTER TABLE inbound_events ADD COLUMN user_id uuid, ADD COLUMN envelope_hash text,
    ALTER COLUMN envelope DROP NOT NULL;

-- 기존 행 백필. userId 는 정규 36자 표기일 때만 캐스트한다 — Java UUID.fromString 이 받아 준 축약형은
-- 캐스트가 실패하므로 user_id 를 비워 둔다(그 행은 사용자 단위 파기 대상에서 빠진다).
UPDATE inbound_events
SET envelope_hash = encode(sha256(convert_to(envelope::text, 'UTF8')), 'hex'),
    user_id = CASE
        WHEN envelope->>'userId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN (envelope->>'userId')::uuid
    END
WHERE envelope IS NOT NULL;

-- 이미 탈퇴한 사용자의 원문을 지운다. user_fences·device_tokens 의 tombstone 은 건드리지 않는다.
UPDATE inbound_events SET envelope = NULL
WHERE user_id IN (SELECT user_id FROM user_fences WHERE withdrawn);

ALTER TABLE inbound_events ALTER COLUMN envelope_hash SET NOT NULL;

-- 탈퇴 TX 의 파기(DeviceService.generation)가 원문이 남은 행만 찾는다.
CREATE INDEX inbound_events_user_envelope_idx ON inbound_events(user_id) WHERE envelope IS NOT NULL;
