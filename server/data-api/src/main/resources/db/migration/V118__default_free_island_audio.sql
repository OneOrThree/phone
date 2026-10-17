-- 기본 세 곡은 판매 발행본·섬별 구매 행 없이 모든 섬에 무료 제공한다.
-- 앱 번들 CC0 음원은 각 90초이며, 기존에 등록된 불변 메타데이터는 덮어쓰지 않는다.
INSERT INTO catalog_assets (product_id, title, kind, owner_type) VALUES
    ('waves', '잔잔한 파도', 'audio', 'island'),
    ('campfire', '모닥불', 'audio', 'island'),
    ('forest-wind', '숲속 바람', 'audio', 'island')
ON CONFLICT (product_id) DO NOTHING;

INSERT INTO audio_tracks (product_id, duration_millis) VALUES
    ('waves', 90000), ('campfire', 90000), ('forest-wind', 90000)
ON CONFLICT (product_id) DO NOTHING;
