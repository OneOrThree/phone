-- GROMO-2262 섬장 환영 인사말 + 방명록 (섬 외부 계약 §2).
--
-- groups.greeting: 섬장이 쓴 인사말(≤40 코드포인트, 여유로 160). NULL 이면 «기본 문구» 이고 읽을 때
--   "{섬 이름}섬에 온 걸 환영해요! 같이 집중해요 🐟" 로 합성한다 — 저장하지 않는 이유는 섬 이름이 바뀌어도
--   따라가고, 50자 이름 + 기본 문구가 40자를 넘는 모순을 피하기 위해서다.
ALTER TABLE groups ADD COLUMN greeting varchar(160);

-- island_guestbook_entries: 방문 1회 = 유저·섬·KST 하루(결정 N6) 이므로 (island, author, written_on) 이 유일하다.
--   written_on 은 KST 날짜. 섬당 최근 30개만 살리고 오래된 것은 deleted_at 으로 지운다(soft delete).
CREATE TABLE island_guestbook_entries (
    id          uuid        PRIMARY KEY,
    island_id   uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    author_id   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    content     varchar(80) NOT NULL,
    written_on  date        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz,
    CONSTRAINT uq_island_guestbook_day UNIQUE (island_id, author_id, written_on)
);

CREATE INDEX island_guestbook_island_created_idx ON island_guestbook_entries (island_id, created_at DESC);
