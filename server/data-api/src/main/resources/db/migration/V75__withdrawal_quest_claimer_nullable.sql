-- ════════════════════════════════════════════════════════════════════
-- V75 — 탈퇴 파기에 필요한 퀘스트 정산 수령자 NOT NULL 해제 (GROMO-1950 · 계정 LLD §4)
-- ════════════════════════════════════════════════════════════════════
-- 정산 행(island_quest_claims)은 섬 통장 원장(QUEST_SETTLEMENT)의 근거라 남기고, 수령을 누른
-- 주민이 계정을 탈퇴하면 그 연결(claimed_by)만 끊는다. 새 컬럼·새 테이블은 없다.
-- 수령 writer 는 그대로 non-null 을 쓴다 — 여기서 풀리는 것은 탈퇴 파기 경로뿐이다(V65 와 같은 방식).
ALTER TABLE island_quest_claims ALTER COLUMN claimed_by DROP NOT NULL;
