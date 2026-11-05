-- 웹 섬만 정원을 해제한다. 일반 섬의 max_members 검증은 유지한다.
ALTER TABLE islands ADD COLUMN web_lobby boolean NOT NULL DEFAULT false;
CREATE TABLE web_island_pools (
    id varchar(255) PRIMARY KEY,
    island_id uuid REFERENCES islands(id)
);
INSERT INTO web_island_pools (id, island_id) VALUES ('main', NULL);
