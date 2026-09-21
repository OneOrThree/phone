-- ════════════════════════════════════════════════════════════════════
-- V83 — 개인 수령과 전원 자동 보너스 분리 (GROMO-1991 · island-quests policy Q05 개정)
-- ════════════════════════════════════════════════════════════════════
-- 기획 정본(planning-document `policy-2026-09-14.md` 「일일 퀘스트와 보상」):
--   «주민 한 명 달성 시 보상받기 모달을 띄우고, 본인이 받기를 누르면 섬에 물고기 10마리를 지급한다.»
--   «전원 달성 시 대상 주민 수 × 5마리를 즉시 지급한다.»
--   «같은 회차에서 각 주민의 달성 보상과 전원 보너스는 각각 한 번만 지급한다.»
-- 그래서 정산 행의 단위가 «회차 1행»에서 «회차 × 주민 1행 + 회차 보너스 1행»으로 바뀐다.
-- V71 의 유일키 (island_id, occurrence_id, kind) 는 주민 15명이 각자 받는 순간 두 번째부터
-- 막으므로 claimed_by 를 키에 넣고, kind 에 두 종류를 등록한다.
--
-- 데이터 변환·백필 없음: 정산 스위치 island-quest.settlement-enabled 는 V71 이후 줄곧 false 라
-- (application-satellites.yml · @Value 기본값, 켠 곳은 통합 테스트뿐) island_quest_claims 는 비어 있다.
-- 혹시 'SETTLEMENT' 행이 있으면 아래 CHECK 가 실패해 배포가 멈춘다 — 조용히 지우거나 옮기지 않는다.
-- 기존 V*.sql 은 건드리지 않는다.

-- 1) 회차의 «정산 완료»는 이제 전원 보너스 적립 시각이다. 개인 수령은 주민마다 다른 시각이라
--    회차 1컬럼으로 표현할 수 없다(그건 island_quest_claims 행이 갖는다).
ALTER TABLE island_quest_occurrences RENAME COLUMN claimed_at TO bonus_settled_at;

-- 2) 정산 종류 두 가지 — 개인 달성분(ACHIEVER, claimed_by = 받은 주민)과
--    전원 달성 보너스(ALL_ACHIEVED_BONUS, 수령 행위가 없어 claimed_by NULL).
ALTER TABLE island_quest_claims DROP CONSTRAINT island_quest_claims_kind_check;
ALTER TABLE island_quest_claims ADD CONSTRAINT island_quest_claims_kind_check
    CHECK (kind IN ('ACHIEVER', 'ALL_ACHIEVED_BONUS'));

-- 3) 도메인 유일 — (섬, 회차, 종류, 수령자). 같은 주민의 두 번째 수령을 막는다(다른 멱등키라도).
--    계정 탈퇴로 claimed_by 가 NULL 이 된 행끼리는 서로 구별되므로(NULL 은 distinct) 탈퇴 파기가
--    이 키에 막히지 않는다. 보너스 행은 claimed_by 가 NULL 이라 이 키가 1회를 보장하지 못하지만,
--    회차 행 배타 잠금 + bonus_settled_at + 지갑 원장 유일키(uq_island_wallet_tx_idem)가 막는다.
ALTER TABLE island_quest_claims DROP CONSTRAINT uq_island_quest_claim;
ALTER TABLE island_quest_claims ADD CONSTRAINT uq_island_quest_claim
    UNIQUE (island_id, occurrence_id, kind, claimed_by);

-- 4) 보너스 finalizer 의 «매분» 조회를 받는 부분 인덱스 (IslandQuestOccurrenceRepository#findIdsPendingBonusSince)
--    — WHERE bonus_settled_at IS NULL AND occurrence_date >= :from ORDER BY occurrence_date.
--    기존 두 인덱스는 (island_id, …)·(quest_id, …) 로 시작해 섬·퀘스트 조건이 없는 이 조회에 못 쓰여
--    누적 회차 전체를 매분 다시 훑었다(비용이 테이블 크기에 비례 → 정산 지연).
--    부분 조건을 쿼리의 WHERE 와 «글자 그대로» 맞춰야 플래너가 집는다. 적립이 끝난 회차는 이 인덱스에서
--    빠지므로(bonus_settled_at 이 채워진다) 인덱스는 미정산 회차 수 — 대개 퀘스트 수 × 2일 — 만큼만 남는다.
CREATE INDEX idx_island_quest_occurrences_bonus_pending
    ON island_quest_occurrences (occurrence_date)
    WHERE bonus_settled_at IS NULL;
