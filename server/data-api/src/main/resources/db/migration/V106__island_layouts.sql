-- GROMO-2232 섬 배치 정본 — 건물 좌표의 정본을 Data 로 모은다(map-assets §6, MV-결정1).
-- layout 은 { schemaVersion, mapId, buildings[{ id, cell{x,y}, anchor, footprint[[x,y]...] }] } 이고
-- cell·footprint 는 100×100 통행 셀 좌표다. mapVersion 은 manifest 가 정본이라 넣지 않는다.
-- 백필 없음 — 행이 없는 섬은 첫 조회 때 서버 기본 템플릿으로 지연 생성한다.
-- layout_revision 은 섬 단위 단조 정수 — 생성 시 1, 시설 완공마다 +1.
-- FK 는 island_construction_states 와 같은 RESTRICT — 섬은 소프트 삭제(status)로만 닫힌다.
CREATE TABLE island_layouts (
    island_id        uuid PRIMARY KEY REFERENCES groups (id) ON DELETE RESTRICT,
    layout_revision  bigint NOT NULL DEFAULT 1 CHECK (layout_revision >= 1),
    layout           jsonb NOT NULL,
    updated_at       timestamptz NOT NULL DEFAULT now()
);
