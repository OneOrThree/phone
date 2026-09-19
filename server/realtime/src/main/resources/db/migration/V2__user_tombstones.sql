-- 탈퇴 사용자 tombstone (GROMO-1946 · 계정 LLD §4 chat/realtime 행)
--
-- Data 의 user.withdrawn 사건을 받은 realtime 소비자가 로컬 TX 에서 적는다. 채팅 접근 fence 와
-- 보존 메시지의 공개 발신자 치환(senderId → null)이 이 한 표를 대조한다.
-- LLD 가 정한 대로 최소 사용자 식별·폐기 사실·세대만 둔다 — 읽음 위치·방 목록·프로필 원문을 복사하지 않는다.
-- 보존 기간 정책이 정해지기 전이라 TTL 삭제를 두지 않는다. 역순·중복 사건이 행을 지우는 경로도 없다.
CREATE TABLE user_tombstones (
    user_id          uuid                        NOT NULL,
    -- 탈퇴로 올린 «뒤»의 인증 세대. 이보다 오래된 세대의 명령·AT 를 거절하는 기준이다.
    auth_generation  bigint                      NOT NULL,
    withdrawn_at     timestamp(6) with time zone NOT NULL,
    CONSTRAINT pk_user_tombstones PRIMARY KEY (user_id)
);
