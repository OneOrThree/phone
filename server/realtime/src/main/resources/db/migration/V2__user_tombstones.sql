-- 탈퇴 tombstone (GROMO-1943 · 계정 LLD §4 chat_read_cursors 행)
--
-- Data 의 user.withdrawn 을 받으면 이 행을 확정하고 같은 로컬 TX 에서 그 사용자의 chat_read_cursors 를
-- 지운다. 이후의 커서 쓰기는 같은 사용자 잠금 뒤 이 행을 보고 거절한다 — 단순 DELETE 만으로는 멤버십
-- 캐시가 허용한 늦은 읽음 요청이 행을 다시 만든다.
--
-- 최소 식별자만 둔다: 읽음 위치·방 목록·시각 원문을 복사하지 않는다. auth_generation 은 중복·역순 사건이
-- 폐기를 되돌리지 못하게 GREATEST 로만 전진한다. 보존 기간 정책이 정해지기 전이라 TTL 삭제를 두지 않는다.
CREATE TABLE user_tombstones (
    user_id          uuid                        NOT NULL,
    auth_generation  bigint                      NOT NULL,
    withdrawn_at     timestamp(6) with time zone NOT NULL,
    CONSTRAINT pk_user_tombstones PRIMARY KEY (user_id)
);
