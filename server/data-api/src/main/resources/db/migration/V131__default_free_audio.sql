-- 기본 세 곡은 판매 등록/구매 행과 무관하게 모든 섬에 제공한다.
-- 기존 곡의 불변 자산·미디어 메타데이터는 덮어쓰지 않는다.
INSERT INTO catalog_assets (product_id, title, kind, owner_type)
VALUES ('waves', '잔잔한 파도', 'audio', 'island'),
       ('campfire', '모닥불', 'audio', 'island'),
       ('forest-wind', '숲속 바람', 'audio', 'island')
ON CONFLICT (product_id) DO NOTHING;

-- 앱에 포함된 WAV 원본은 각각 90,000ms다.
INSERT INTO audio_tracks (product_id, duration_millis)
VALUES ('waves', 90000), ('campfire', 90000), ('forest-wind', 90000)
ON CONFLICT (product_id) DO NOTHING;
