-- 모든 건물의 건설비를 주민별 분담(RESIDENT_SPLIT, 「각자 몫 n빵」) 대신 섬 통장 잔액으로 낸다
-- (GROMO-2761, 2026-11-05 결정). 방장이 목표를 고르고 방장만 착공하는 흐름은 그대로다.
-- 주민별 기여 기록(island_construction_contributions)과 RESIDENT_SPLIT 판정 코드는 남겨 두므로
-- 새 migration 으로 이 값만 되돌리면 이전 방식으로 돌아간다.
UPDATE construction_buildings SET funding = 'WALLET_TOTAL' WHERE funding = 'RESIDENT_SPLIT';
