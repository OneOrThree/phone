-- GROMO-2267 섬 소식 (섬 외부 계약 §7) — 섬장이 잡지 홍보비를 쓰면 주민 전원이 읽는 «섬 소식» 한 줄이 생긴다.
--
-- island_news: 섬 공동 피드. 한 행 = 한 소식이고 «주민 전원에게 같은 글» 이라 수신자별 행도 읽음 표시도 없다.
--   kind: 소식의 종류(지금은 'PROMOTION' 하나). CHECK 를 걸지 않는다 — 다음 종류(잡지·도착 소식 등)가 마이그레이션
--     없이 들어오고, 읽는 쪽은 모르는 kind 를 그대로 내려보낸다.
--   body: 이미 완성된 한 줄 문구(≤200자). 문구는 소식을 쓰는 서비스가 정한다.
-- 섬이 닫혀도 groups 행은 묘비로 남아 ON DELETE CASCADE 가 돌지 않는다 → IslandPurgeService 가 직접 지운다.
CREATE TABLE island_news (
    id         uuid         PRIMARY KEY,
    island_id  uuid         NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    kind       varchar(20)  NOT NULL,
    body       varchar(200) NOT NULL,
    created_at timestamptz  NOT NULL DEFAULT now()
);

-- 최신순 목록(GET /islands/{id}/news) 읽기용.
CREATE INDEX island_news_island_created_idx ON island_news (island_id, created_at DESC);
