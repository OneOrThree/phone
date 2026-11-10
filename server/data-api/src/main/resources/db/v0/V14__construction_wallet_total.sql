-- 목표 선택 전부터 모아 둔 섬 통장 잔액으로 모든 건물을 짓는다.
-- 기존 목표·잔액·기여 이력·가격은 보존하고 모금 방식만 전환한다.
UPDATE construction_buildings SET funding = 'WALLET_TOTAL'
WHERE funding = 'RESIDENT_SPLIT';
