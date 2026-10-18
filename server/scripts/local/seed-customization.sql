-- 로컬 전용 — prod 금지 (마이그레이션 아님). GROMO-2331 꾸미기 슬롯 로컬 확인용 시드.
-- 적용: psql "postgresql://<user>:<pw>@localhost:<port>/<db>" -f server/scripts/local/seed-customization.sql
-- 오리 모자(head) 하나를 카탈로그·이미지 메타·바다 보상 1분 단계(base 세트)에 심는다. 여러 번 돌려도 같다.
-- 이미지는 server/static/customization/head/duck.9572baaf.png (nginx 프로필의 /static/ 으로 나간다).
INSERT INTO catalog_assets (product_id, title, kind, owner_type)
VALUES ('cust.head.duck', '오리 모자', 'head', 'user')
ON CONFLICT (product_id) DO NOTHING;

INSERT INTO customization_asset_meta
    (product_id, kind, slot, image_path, width, height, anchor_x, anchor_y, sort_order, retired_at)
VALUES ('cust.head.duck', 'head', 'head', '/static/customization/head/duck.9572baaf.png', 1254, 1254, 0.5, 0.1, 1, NULL)
ON CONFLICT (product_id) DO NOTHING;

INSERT INTO sea_reward_tiers (set_key, threshold_minutes, product_id)
SELECT 'base', 1, 'cust.head.duck'
WHERE NOT EXISTS (SELECT 1 FROM sea_reward_tiers WHERE set_key = 'base' AND product_id = 'cust.head.duck');
