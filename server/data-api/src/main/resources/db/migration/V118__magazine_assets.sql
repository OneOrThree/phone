-- GROMO-2289 고양이 잡지 꾸미기 재료 카탈로그 (잡지 구현 계획 §2-2 V113) — 홍보 칸의 틀·스티커·테이프 정의.
--
-- 1) catalog_assets 종류에 잡지 재료 3종(ad_frame · ad_sticker · ad_tape)을 더한다. 셋 다 개인(user) 소유다 —
--    앞으로 그릴 시즌 재료는 바다 보상(SeaFocusRewardService)이 개인 인벤토리(owned_products)에 넣는다.
--    개인 인벤토리 조회(AppearanceService.myInventory)는 clothes·decor 만 내려보내 옷장 화면에 섞이지 않는다.
-- 2) magazine_asset_meta: 잡지 재료의 부가 정보. 카탈로그 행은 불변이라 서랍 탭·묶음·정렬·퇴역은 옆 표에 둔다.
--    bundle: free = 모든 계정이 가진 것으로 본다(소유 행을 만들지 않는다) · season = owned_products 행이 있어야 가진 것.
--    kind: 카탈로그 종류의 사본 — (product_id, kind) 복합 FK 로 카탈로그와 어긋나지 못하고, 이 표의 CHECK 가 종류별 규칙을
--    직접 볼 수 있게 한다(CHECK 는 다른 표를 못 본다). 잡지 재료 3종만 받는다.
--    drawer_tab: 스티커 서랍 탭(cat · sea · friends · deco). 스티커는 반드시 있고 틀·테이프는 반드시 NULL 이다(CHECK) —
--    운영 SQL 이 시즌 스티커의 탭을 빠뜨리면 재료 목록 전체가 깨지므로 넣는 순간 막는다.
--    retired_at: 서랍에서 내린 시각. 이미 붙인 칸은 그대로 그린다 — 퇴역한 재료는 소유 행이 있거나 직전 칸에 있던
--    것만 다시 실을 수 있다(free 라도 퇴역하면 «모두가 가진 것» 에서 빠진다).
--    운영 카탈로그라 계정 탈퇴·섬 정리 대상이 아니다.
-- 3) 시드 64행(틀 11 · 스티커 45 · 테이프 8) — 10/14 에셋 id 표(catalog.json version 2026-10-14) 그대로이고, 전부 free 다
--    (10/14 확정 — 유료 스티커 없음, 기본 묶음 규칙 폐기). product_id 는 «mag.» + 앱 그림 id 다: catalog_assets 는
--    옷·꾸미기와 같은 전역 키라 'star'·'cloud' 같은 맨 이름은 충돌할 수 있다. sort_order 는 종류 안에서 1부터다.
ALTER TABLE catalog_assets DROP CONSTRAINT catalog_assets_kind_check;
ALTER TABLE catalog_assets ADD CONSTRAINT catalog_assets_kind_check
    CHECK (kind IN ('clothes', 'decor', 'island_theme', 'building_theme', 'audio',
                    'ad_frame', 'ad_sticker', 'ad_tape'));
ALTER TABLE catalog_assets DROP CONSTRAINT catalog_assets_kind_owner_check;
ALTER TABLE catalog_assets ADD CONSTRAINT catalog_assets_kind_owner_check
    CHECK ((kind IN ('clothes', 'decor', 'ad_frame', 'ad_sticker', 'ad_tape') AND owner_type = 'user')
        OR (kind IN ('island_theme', 'building_theme', 'audio') AND owner_type = 'island'));

-- 복합 FK 의 대상 — product_id 가 이미 PK 라 (product_id, kind) 도 당연히 유일하다.
ALTER TABLE catalog_assets ADD CONSTRAINT catalog_assets_product_kind_key UNIQUE (product_id, kind);

CREATE TABLE magazine_asset_meta (
    product_id varchar(80) PRIMARY KEY,
    kind       varchar(20) NOT NULL CHECK (kind IN ('ad_frame', 'ad_sticker', 'ad_tape')),
    bundle     varchar(10) NOT NULL CHECK (bundle IN ('free', 'season')),
    drawer_tab varchar(10) CHECK (drawer_tab IN ('cat', 'sea', 'friends', 'deco')),
    sort_order integer     NOT NULL,
    retired_at timestamptz,
    CONSTRAINT magazine_asset_meta_catalog_fk FOREIGN KEY (product_id, kind)
        REFERENCES catalog_assets (product_id, kind) ON DELETE RESTRICT,
    CONSTRAINT magazine_asset_meta_tab_check CHECK ((kind = 'ad_sticker') = (drawer_tab IS NOT NULL))
);

INSERT INTO catalog_assets (product_id, title, kind, owner_type) VALUES
    ('mag.frame-scallop', '분홍 물결', 'ad_frame', 'user'),
    ('mag.frame-ticket', '파란 티켓', 'ad_frame', 'user'),
    ('mag.frame-grid', '노란 모눈 메모', 'ad_frame', 'user'),
    ('mag.frame-polaroid', '폴라로이드', 'ad_frame', 'user'),
    ('mag.frame-catear', '고양이 귀', 'ad_frame', 'user'),
    ('mag.frame-cloud', '구름', 'ad_frame', 'user'),
    ('mag.frame-envelope', '편지 봉투', 'ad_frame', 'user'),
    ('mag.frame-woodsign', '나무 간판', 'ad_frame', 'user'),
    ('mag.frame-lifering', '구명 튜브', 'ad_frame', 'user'),
    ('mag.frame-notebook', '스프링 노트', 'ad_frame', 'user'),
    ('mag.frame-wave', '파도', 'ad_frame', 'user'),
    ('mag.tape-cream', '크림 테이프', 'ad_tape', 'user'),
    ('mag.tape-pink', '분홍 테이프', 'ad_tape', 'user'),
    ('mag.tape-blue', '하늘 테이프', 'ad_tape', 'user'),
    ('mag.tape-pinkdots', '분홍 물방울 테이프', 'ad_tape', 'user'),
    ('mag.tape-bluestripe', '파란 줄무늬 테이프', 'ad_tape', 'user'),
    ('mag.tape-yellowcheck', '노란 체크 테이프', 'ad_tape', 'user'),
    ('mag.tape-mint', '민트 테이프', 'ad_tape', 'user'),
    ('mag.tape-paw', '발자국 테이프', 'ad_tape', 'user'),
    ('mag.cat-black-book', '책 읽는 까만 고양이', 'ad_sticker', 'user'),
    ('mag.cat-white-sleep', '잠자는 흰 고양이', 'ad_sticker', 'user'),
    ('mag.cat-ginger-fish', '낚시하는 치즈 고양이', 'ad_sticker', 'user'),
    ('mag.cat-calico-wave', '손 흔드는 삼색 고양이', 'ad_sticker', 'user'),
    ('mag.cat-cream-heart', '하트 안은 크림 고양이', 'ad_sticker', 'user'),
    ('mag.cat-gray-cheer', '응원하는 회색 고양이', 'ad_sticker', 'user'),
    ('mag.cat-black-peek', '빼꼼 까만 고양이', 'ad_sticker', 'user'),
    ('mag.cat-ginger-face', '치즈 고양이 얼굴', 'ad_sticker', 'user'),
    ('mag.cat-calico-raft', '뗏목 탄 삼색 고양이', 'ad_sticker', 'user'),
    ('mag.cat-white-pencil', '연필 든 흰 고양이', 'ad_sticker', 'user'),
    ('mag.cat-cream-coffee', '커피 마시는 크림 고양이', 'ad_sticker', 'user'),
    ('mag.cat-gray-bottle', '유리병 든 회색 고양이', 'ad_sticker', 'user'),
    ('mag.cat-gray-headphone', '헤드폰 낀 회색 고양이', 'ad_sticker', 'user'),
    ('mag.cat-cream-booknap', '책 위에서 자는 크림 고양이', 'ad_sticker', 'user'),
    ('mag.fish', '물고기', 'ad_sticker', 'user'),
    ('mag.fish-basket', '물고기 바구니', 'ad_sticker', 'user'),
    ('mag.bottle', '유리병 편지', 'ad_sticker', 'user'),
    ('mag.map', '보물 지도', 'ad_sticker', 'user'),
    ('mag.palm-island', '야자수 섬', 'ad_sticker', 'user'),
    ('mag.shell', '조개', 'ad_sticker', 'user'),
    ('mag.sailboat', '돛단배', 'ad_sticker', 'user'),
    ('mag.lighthouse', '등대', 'ad_sticker', 'user'),
    ('mag.lantern', '등불', 'ad_sticker', 'user'),
    ('mag.whale', '별고래', 'ad_sticker', 'user'),
    ('mag.seagull', '갈매기', 'ad_sticker', 'user'),
    ('mag.turtle', '리본 거북이', 'ad_sticker', 'user'),
    ('mag.telescope', '망원경', 'ad_sticker', 'user'),
    ('mag.campfire', '모닥불', 'ad_sticker', 'user'),
    ('mag.pelican', '펠리컨', 'ad_sticker', 'user'),
    ('mag.dog', '강아지', 'ad_sticker', 'user'),
    ('mag.mongdol', '몽돌', 'ad_sticker', 'user'),
    ('mag.mailbox', '우체통', 'ad_sticker', 'user'),
    ('mag.star', '별', 'ad_sticker', 'user'),
    ('mag.heart', '하트', 'ad_sticker', 'user'),
    ('mag.cloud', '구름', 'ad_sticker', 'user'),
    ('mag.pencil', '연필', 'ad_sticker', 'user'),
    ('mag.book', '책', 'ad_sticker', 'user'),
    ('mag.paw', '발자국', 'ad_sticker', 'user'),
    ('mag.bow', '리본', 'ad_sticker', 'user'),
    ('mag.sparkle', '반짝', 'ad_sticker', 'user'),
    ('mag.crown', '왕관', 'ad_sticker', 'user'),
    ('mag.drink', '딸기 음료', 'ad_sticker', 'user'),
    ('mag.moon', '졸린 달', 'ad_sticker', 'user'),
    ('mag.clock', '알람시계', 'ad_sticker', 'user'),
    ('mag.tomato-timer', '토마토 타이머', 'ad_sticker', 'user');

INSERT INTO magazine_asset_meta (product_id, kind, bundle, drawer_tab, sort_order) VALUES
    ('mag.frame-scallop', 'ad_frame', 'free', NULL, 1),
    ('mag.frame-ticket', 'ad_frame', 'free', NULL, 2),
    ('mag.frame-grid', 'ad_frame', 'free', NULL, 3),
    ('mag.frame-polaroid', 'ad_frame', 'free', NULL, 4),
    ('mag.frame-catear', 'ad_frame', 'free', NULL, 5),
    ('mag.frame-cloud', 'ad_frame', 'free', NULL, 6),
    ('mag.frame-envelope', 'ad_frame', 'free', NULL, 7),
    ('mag.frame-woodsign', 'ad_frame', 'free', NULL, 8),
    ('mag.frame-lifering', 'ad_frame', 'free', NULL, 9),
    ('mag.frame-notebook', 'ad_frame', 'free', NULL, 10),
    ('mag.frame-wave', 'ad_frame', 'free', NULL, 11),
    ('mag.tape-cream', 'ad_tape', 'free', NULL, 1),
    ('mag.tape-pink', 'ad_tape', 'free', NULL, 2),
    ('mag.tape-blue', 'ad_tape', 'free', NULL, 3),
    ('mag.tape-pinkdots', 'ad_tape', 'free', NULL, 4),
    ('mag.tape-bluestripe', 'ad_tape', 'free', NULL, 5),
    ('mag.tape-yellowcheck', 'ad_tape', 'free', NULL, 6),
    ('mag.tape-mint', 'ad_tape', 'free', NULL, 7),
    ('mag.tape-paw', 'ad_tape', 'free', NULL, 8),
    ('mag.cat-black-book', 'ad_sticker', 'free', 'cat', 1),
    ('mag.cat-white-sleep', 'ad_sticker', 'free', 'cat', 2),
    ('mag.cat-ginger-fish', 'ad_sticker', 'free', 'cat', 3),
    ('mag.cat-calico-wave', 'ad_sticker', 'free', 'cat', 4),
    ('mag.cat-cream-heart', 'ad_sticker', 'free', 'cat', 5),
    ('mag.cat-gray-cheer', 'ad_sticker', 'free', 'cat', 6),
    ('mag.cat-black-peek', 'ad_sticker', 'free', 'cat', 7),
    ('mag.cat-ginger-face', 'ad_sticker', 'free', 'cat', 8),
    ('mag.cat-calico-raft', 'ad_sticker', 'free', 'cat', 9),
    ('mag.cat-white-pencil', 'ad_sticker', 'free', 'cat', 10),
    ('mag.cat-cream-coffee', 'ad_sticker', 'free', 'cat', 11),
    ('mag.cat-gray-bottle', 'ad_sticker', 'free', 'cat', 12),
    ('mag.cat-gray-headphone', 'ad_sticker', 'free', 'cat', 13),
    ('mag.cat-cream-booknap', 'ad_sticker', 'free', 'cat', 14),
    ('mag.fish', 'ad_sticker', 'free', 'sea', 15),
    ('mag.fish-basket', 'ad_sticker', 'free', 'sea', 16),
    ('mag.bottle', 'ad_sticker', 'free', 'sea', 17),
    ('mag.map', 'ad_sticker', 'free', 'sea', 18),
    ('mag.palm-island', 'ad_sticker', 'free', 'sea', 19),
    ('mag.shell', 'ad_sticker', 'free', 'sea', 20),
    ('mag.sailboat', 'ad_sticker', 'free', 'sea', 21),
    ('mag.lighthouse', 'ad_sticker', 'free', 'sea', 22),
    ('mag.lantern', 'ad_sticker', 'free', 'sea', 23),
    ('mag.whale', 'ad_sticker', 'free', 'sea', 24),
    ('mag.seagull', 'ad_sticker', 'free', 'sea', 25),
    ('mag.turtle', 'ad_sticker', 'free', 'sea', 26),
    ('mag.telescope', 'ad_sticker', 'free', 'sea', 27),
    ('mag.campfire', 'ad_sticker', 'free', 'sea', 28),
    ('mag.pelican', 'ad_sticker', 'free', 'friends', 29),
    ('mag.dog', 'ad_sticker', 'free', 'friends', 30),
    ('mag.mongdol', 'ad_sticker', 'free', 'friends', 31),
    ('mag.mailbox', 'ad_sticker', 'free', 'friends', 32),
    ('mag.star', 'ad_sticker', 'free', 'deco', 33),
    ('mag.heart', 'ad_sticker', 'free', 'deco', 34),
    ('mag.cloud', 'ad_sticker', 'free', 'deco', 35),
    ('mag.pencil', 'ad_sticker', 'free', 'deco', 36),
    ('mag.book', 'ad_sticker', 'free', 'deco', 37),
    ('mag.paw', 'ad_sticker', 'free', 'deco', 38),
    ('mag.bow', 'ad_sticker', 'free', 'deco', 39),
    ('mag.sparkle', 'ad_sticker', 'free', 'deco', 40),
    ('mag.crown', 'ad_sticker', 'free', 'deco', 41),
    ('mag.drink', 'ad_sticker', 'free', 'deco', 42),
    ('mag.moon', 'ad_sticker', 'free', 'deco', 43),
    ('mag.clock', 'ad_sticker', 'free', 'deco', 44),
    ('mag.tomato-timer', 'ad_sticker', 'free', 'deco', 45);
