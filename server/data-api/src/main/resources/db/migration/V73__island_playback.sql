-- ════════════════════════════════════════════════════════════════════
-- V73 — 공용 음악(방송기) 재생 상태 + 음원 불변 미디어 메타데이터 (GROMO-1779 · island-playback LLD §4)
-- ════════════════════════════════════════════════════════════════════
-- 1) 음원 불변 미디어 메타데이터 — catalog_assets(kind='audio')마다 곡 길이 한 행 (정책 M07).
--    catalog_assets 에는 길이 컬럼이 없고, 같은 trackId 의 오디오·길이를 몰래 바꾸지 않으므로
--    갱신 경로가 없는 별도 행으로 둔다. 길이는 밀리초 정수 — NaN·무한이 들어올 자리가 없고
--    소수초(120.5초 = 120500)를 잃지 않는다. 이 행이 없는 음원은 재생 명령에서 422 로 막힌다
--    (LLD §2 「metadata 가 없으면 공유 재생 명령을 활성화하지 않는다」).
CREATE TABLE audio_tracks (
    product_id      varchar(80) PRIMARY KEY REFERENCES catalog_assets (product_id) ON DELETE RESTRICT,
    duration_millis integer     NOT NULL CHECK (duration_millis > 0),
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- 2) 섬 재생 상태 — 섬(groups)당 한 행의 전체 상태. 행이 없으면 초기 상태(곡 없음·정지·0초·version 0)
--    이며 GET 은 행을 만들지 않는다. 최초 PATCH 가 섬 생성 시각을 anchor 로 행을 만든다(백필 없음).
--    position_seconds 는 effective_at 시점의 위치(초, 정수 내림) — 재생 중이면 서버 경과를 더해 곡 길이로
--    반복한다(정책 M05). version 은 행 배타 잠금 아래에서만 +1 — playback.updated 의 aggregateVersion.
CREATE TABLE island_playbacks (
    island_id        uuid        PRIMARY KEY REFERENCES groups (id) ON DELETE RESTRICT,
    track_id         varchar(80) REFERENCES audio_tracks (product_id) ON DELETE RESTRICT,
    playing          boolean     NOT NULL DEFAULT false,
    position_seconds bigint      NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
    effective_at     timestamptz NOT NULL,
    changed_by       uuid        REFERENCES users (id) ON DELETE RESTRICT,
    version          bigint      NOT NULL DEFAULT 0,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    -- 곡 없이 재생 중일 수 없다(LLD §2 「playing, trackId=null 이면 false」).
    CONSTRAINT island_playbacks_playing_needs_track CHECK (track_id IS NOT NULL OR NOT playing)
);
