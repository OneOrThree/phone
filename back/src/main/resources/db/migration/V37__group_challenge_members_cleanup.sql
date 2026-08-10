-- V37 — group_challenge_members 잔재 정리 (GROMO-1265 · GROMO-1266)
--
-- 1) usage_date NOT NULL 승격 (GROMO-1266): 창 사용분 보고 경로(V20 이후 유일한 쓰기 경로)는
--    항상 usage_date 를 채운다. NULL 행 = V20 이전 잔재(재활용 전 미사용 테이블 시절) —
--    모든 조회 경로가 usage_date = :date 동등 조건이라 NULL 행은 어떤 화면·판정에도 닿지 않는
--    죽은 데이터다.
--    백필 규칙: created_at 의 KST 날짜로 백필하는 안은 (challenge, user, usage_date) 유니크와
--    실제 보고 행이 충돌할 위험만 있고 얻는 값이 없어 기각 — NULL 행은 삭제로 정리한다.
-- 2) is_achieved · achieved_at 드롭 (GROMO-1265): GROMO-561 시절 "저장 시 판정" 모델의 스키마
--    잔재. 판정은 통계 실측의 조회 시 계산(GroupBetJudge · 카드 진행률)으로 대체된 지 오래라
--    값을 갱신하는 코드가 없다(전 행 false/NULL 고정).

DELETE FROM group_challenge_members WHERE usage_date IS NULL;

ALTER TABLE group_challenge_members
    ALTER COLUMN usage_date SET NOT NULL;

ALTER TABLE group_challenge_members
    DROP COLUMN is_achieved,
    DROP COLUMN achieved_at;
