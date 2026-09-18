-- ════════════════════════════════════════════════════════════════════
-- V61 — 1:1 편지 (GROMO-1933 · friend-letter LLD §2)
-- ════════════════════════════════════════════════════════════════════
-- 편지는 친구 한 명에게만 보이는 사적인 글이다. 섬 주민 전체가 보는 우체통 공개 메시지
-- (island-mailbox, 저장소는 Realtime 의 gromo_chat)와는 다른 도메인이라 테이블을 나눈다 —
-- 같은 화면(/screens/mailbox)에 나란히 뜨더라도 API·권한·저장소가 전부 갈린다(HLD §0).
--
-- 상태 전이가 없다. 보내면 끝이고 바뀌는 것은 read_at 하나뿐이라 status enum 을 두지 않는다.
CREATE TABLE letters (
    id          uuid PRIMARY KEY,
    -- ON DELETE RESTRICT 를 명시한다(NO ACTION 과 동의어지만 뜻을 적어 둔다) — 편지는 «주고받은
    -- 사실»의 기록이라 유저 행이 사라진다고 함께 지우지 않는다. 운영 탈퇴는 소프트 삭제
    -- (users.is_deleted)라 이 제약에 닿지 않는다: erasePersonalData 가 nickname 만 지우고 행을
    -- 남기므로 FK 가 끊기지 않는다(LLD §3). CASCADE 로 두면 뒷날 계정 하드 삭제가 «상대방이
    -- 받은» 편지까지 조용히 지운다.
    sender_id   uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    receiver_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    -- 상한 500 은 재영님 확정값(2026-09-18)이다. LLD·HLD 가 적어 둔 1000 은 폐기된 제안값이다.
    content     varchar(500) NOT NULL,
    -- 수신자가 처음 상세 조회한 시각. NULL = 안 읽음.
    read_at     timestamptz,
    -- 커서 정렬 축은 이 컬럼이 아니라 id 다 — UUID v7 이 이미 시간순이다(FocusSession 선례).
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- 시스템 소프트 삭제 필드. 지금 이 값을 «쓰는» 경로는 없다 — 사용자용 편지 삭제 API 는 이 티켓
    -- 범위 밖이고, 친구 삭제 후 편지 처리(LLD §4 결정 3)는 아직 미결이라 A안(보존) 상태다.
    -- 읽기 경로는 지금도 전부 deleted_at IS NULL 을 건다(아래 부분 인덱스와 짝).
    deleted_at  timestamptz
);

-- 편지함 두 방향(받은·보낸)을 각각 커버한다. friendships 가 to_user_id 단독 인덱스를 빠뜨려 남긴
-- 순차 스캔 경고를 편지에서 반복하지 않는다 — 편지함은 화면 진입마다 조회되는 목록이다.
CREATE INDEX idx_letters_receiver_cursor ON letters (receiver_id, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_letters_sender_cursor   ON letters (sender_id,   id DESC) WHERE deleted_at IS NULL;

COMMENT ON TABLE letters IS
    '친구 사이 1:1 편지 — GROMO-1933, friend-letter LLD §1.12~1.14 · §2. 섬 공개 메시지(island-mailbox)와 다른 도메인';
