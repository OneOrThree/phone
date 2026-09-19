-- Data outbox 사건 수신 기록 (GROMO-1954 · 2026-09-19 R-1)
--
-- realtime 은 같은 사건을 HTTP(POST /internal/events)·Kafka(realtime-events) 두 입구로 받을 수 있고, relay 는
-- at-least-once 라 같은 입구로도 다시 온다. InboundEventService 가 이 행을 «먼저» 넣고 같은 로컬 TX 에서
-- 적용한다 — 이미 있으면 적용하지 않는다. 알림 서버 inbound_events 와 같은 역할이다.
--
-- event_id 는 Data 봉투의 eventId 원문이다(UUID 가 아닐 수 있다 — 'user.withdrawn:<userId>' 같은 결정적 키).
-- 봉투 본문은 저장하지 않는다: params 에 개인정보가 실릴 수 있고(outbox 규약 §2.7), 중복 판정에는 키만 필요하다.
-- 보존 기간 정책(A18)이 정해지기 전이라 TTL 삭제를 두지 않는다.
CREATE TABLE inbound_events (
    event_id     text                        NOT NULL,
    type         text                        NOT NULL,
    received_at  timestamp(6) with time zone NOT NULL DEFAULT now(),
    CONSTRAINT pk_inbound_events PRIMARY KEY (event_id)
);
