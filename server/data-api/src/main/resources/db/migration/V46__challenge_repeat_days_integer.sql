-- V46 — repeat_days JPA 타입 정합성 복구 (GROMO-1260)
--
-- V34는 1~127 비트마스크를 smallint로 만들었지만 GroupChallenge.repeatDays는 Java int라
-- Hibernate ddl-auto=validate가 INTEGER를 기대한다. 이미 적용된 V34는 수정하지 않고
-- 기존 값과 CHECK 제약을 보존한 채 PostgreSQL integer로 확장한다.

ALTER TABLE public.group_challenges
    ALTER COLUMN repeat_days TYPE integer
    USING repeat_days::integer;
