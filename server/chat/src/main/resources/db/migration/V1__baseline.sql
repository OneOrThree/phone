-- 채팅 서비스 베이스라인 (GROMO-292)
--
-- 이 데이터베이스(gromo_chat)에는 채팅이 소유한 두 테이블만 있다. 그룹·유저는 Data API 의 gromo
-- 에 있고 여기서 FK 로 걸지 않는다 — 다른 데이터베이스라 물리적으로 불가능하고, 가능하더라도
-- 걸지 않는다(두 서비스의 마이그레이션이 한 몸이 된다). 참조 무결성은 쓰기 시점의 멤버십 검사가 대신한다.

CREATE TABLE chat_messages (
    -- UUID v7. 앞 48비트가 epoch 밀리초라 «PK 정렬 = 시간 정렬»이고,
    -- 커서 페이징(id < :cursor)과 안 읽음 집계(id > 커서)가 전부 이 성질에 얹혀 있다.
    id                 uuid                     NOT NULL,
    group_id           uuid                     NOT NULL,
    sender_id          uuid                     NOT NULL,
    content            varchar(2000)            NOT NULL,
    -- 클라이언트가 만드는 멱등 키. 재전송을 애플리케이션이 아니라 아래 유니크 인덱스가 막는다.
    client_message_id  uuid                     NOT NULL,
    sent_at            timestamp(6) with time zone NOT NULL,
    CONSTRAINT pk_chat_messages PRIMARY KEY (id)
);

-- 재전송 차단. 「있나 보고 없으면 넣는다」에는 검사와 INSERT 사이에 창이 있어 동시 재전송 두 건이
-- 둘 다 통과한다 — 이 제약에는 그 창이 없다. 애플리케이션은 위반을 잡아 «원래 그 메시지»를 돌려준다.
CREATE UNIQUE INDEX ux_chat_messages_dedup
    ON chat_messages (group_id, sender_id, client_message_id);

-- 히스토리 페이징(방별 최신순)과 방 목록의 DISTINCT ON (group_id) … ORDER BY group_id, id DESC 를 함께 받는다.
-- sent_at 이 아니라 id 로 정렬하는 이유: sent_at 은 같은 밀리초에 값이 겹쳐 커서 경계가 흔들린다.
CREATE INDEX ix_chat_messages_group_id_desc
    ON chat_messages (group_id, id DESC);

CREATE TABLE chat_read_cursors (
    id                    uuid                     NOT NULL,
    group_id              uuid                     NOT NULL,
    user_id               uuid                     NOT NULL,
    -- 여기까지 읽었다(포함). 안 읽음 = 이 값보다 큰 id 의 개수.
    last_read_message_id  uuid                     NOT NULL,
    updated_at            timestamp(6) with time zone NOT NULL,
    CONSTRAINT pk_chat_read_cursors PRIMARY KEY (id)
);

-- 자연키. 이 제약이 있어야 읽음 갱신의 ON CONFLICT (group_id, user_id) 가 성립한다 —
-- 빼면 UPSERT 가 런타임에 실패하고, 그 실패는 「두 기기에서 동시에 방을 열 때만」 나타난다.
CREATE UNIQUE INDEX ux_chat_read_cursors_group_user
    ON chat_read_cursors (group_id, user_id);
