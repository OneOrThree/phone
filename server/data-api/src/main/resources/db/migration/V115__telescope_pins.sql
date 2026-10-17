-- GROMO-2268 망원경 핀 — 잡지·전망대로 «직접 넣은 섬» (섬 외부 계약 §6).
--
-- telescope_pins: 이 사람의 망원경에 넣어 둔 섬. 한 사람의 만료 안 된 핀은 최대 4개다 — 5번째를 넣으면
--   pinned_at 이 가장 오래된 핀이 같은 트랜잭션에서 빠진다(서비스 몫이라 표는 개수를 제한하지 않는다).
-- source: 어디서 넣었나. magazine = 잡지(찜 리본·잡지 칸), observatory = 전망대 검색·랭킹.
-- expires_at: 다음 07:00 KST. 만료는 읽을 때 걸러낸다(expires_at > now) — 정리 잡은 없고, 같은 사람이 핀을
--   넣을 때 그 사람의 만료 행만 함께 지운다.
CREATE TABLE telescope_pins (
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    island_id  uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    source     varchar(20) NOT NULL CHECK (source IN ('magazine', 'observatory')),
    pinned_at  timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, island_id)
);

-- 한 사람의 핀을 오래된 순으로 읽을 때(목록·5번째 밀어내기) 쓴다. PK 는 섬이 둘째라 정렬을 돕지 못한다.
CREATE INDEX telescope_pins_user_pinned_idx ON telescope_pins (user_id, pinned_at);
