-- 집중 꾸미기 보상 추첨·지급 (GROMO-2301).
-- 1) 세션 정산 행에 그 세션이 뽑은 아이템과 «처음 가졌는가»(결과창 NEW! 표시)를 남긴다. 같은 세션의 재조회
--    (새 키 finish·pending-result)는 다시 뽑지 않고 이 세 칸을 읽는다. 15분 미만이거나 정책이 없어 뽑지 않은 세션은
--    셋 다 NULL 이다.
--    CHECK 둘·복합 FK 는 NOT VALID 로 건다 — 기존 행은 새 칸이 전부 NULL 이라 위반이 있을 수 없고, 새로 넣거나 고치는 행에는
--    그대로 강제된다. 유효하게 걸면 ACCESS EXCLUSIVE 를 쥔 채 focus_settlements 전체를 훑는다. 같은 Flyway 트랜잭션에서
--    VALIDATE CONSTRAINT 해도 잠금을 쥔 채라 이득이 없어 하지 않는다.
ALTER TABLE focus_settlements
    ADD COLUMN customization_reward_revision integer,
    ADD COLUMN customization_reward_product_id varchar(80),
    ADD COLUMN customization_reward_new boolean,
    ADD CONSTRAINT focus_settlements_customization_reward_pair CHECK (
        (customization_reward_revision IS NULL) = (customization_reward_product_id IS NULL)
    ) NOT VALID,
    ADD CONSTRAINT focus_settlements_customization_reward_new_pair CHECK (
        (customization_reward_revision IS NULL) = (customization_reward_new IS NULL)
    ) NOT VALID,
    ADD CONSTRAINT focus_settlements_customization_reward_item_fk
        FOREIGN KEY (customization_reward_revision, customization_reward_product_id)
        REFERENCES customization_reward_items (revision, product_id) ON DELETE RESTRICT NOT VALID;

-- 2) 정책 revision 2 — 신발과 뗏목 6분류(kind=decor)를 추첨에서 뺀다(오스카 결정). 확률 값은 revision 1 그대로이고
--    카테고리 가중치만 머리·목으로 줄인다. 서버는 가장 큰 revision 을 쓴다. revision 1(90종 등록)은 그대로 둔다 —
--    신발·뗏목은 등록만 돼 있고 지급되지 않는다.
INSERT INTO customization_reward_policies
    (revision, minimum_active_seconds, rare_unlock_seconds, legendary_unlock_seconds, time_half_seconds,
     rare_max_bonus_ppm, legendary_max_bonus_ppm, rewards_per_eligible_session, duplicates_allowed,
     location_weights, category_weights, source_workbook_sha256)
SELECT 2, minimum_active_seconds, rare_unlock_seconds, legendary_unlock_seconds, time_half_seconds,
       rare_max_bonus_ppm, legendary_max_bonus_ppm, rewards_per_eligible_session, duplicates_allowed,
       location_weights, '{"head": 1, "neck": 1}'::jsonb, source_workbook_sha256
FROM customization_reward_policies WHERE revision = 1;

INSERT INTO customization_reward_items
    (revision, product_id, source_asset_id, category, rarity, rarity_reason, render_data, sort_order)
SELECT 2, product_id, source_asset_id, category, rarity, rarity_reason, render_data, sort_order
FROM customization_reward_items WHERE revision = 1 AND category IN ('head', 'neck');

-- 복사본이 원본(revision 1 의 머리·목 전부)과 같은 수이고 비어 있지 않아야 한다 — 지금은 20종이다.
DO $$
DECLARE
    copied_count integer := (SELECT count(*) FROM customization_reward_items WHERE revision = 2);
    source_count integer := (SELECT count(*) FROM customization_reward_items
                             WHERE revision = 1 AND category IN ('head', 'neck'));
BEGIN
    IF copied_count = 0 OR copied_count <> source_count THEN
        RAISE EXCEPTION '꾸미기 보상 revision 2 는 revision 1 의 머리·목 전부여야 합니다(복사 %, 원본 %)',
            copied_count, source_count;
    END IF;
END $$;
