-- GROMO-801 회원 탈퇴 시 소셜 관계 정리의 역방향 조회 인덱스.
--
-- friendships / pinned_users 는 관계를 방향이 있는 한 행으로 저장하므로, "이 유저가 낀 관계 전부" 를
-- 찾으려면 두 컬럼을 OR 로 훑어야 한다. 그런데 기존 인덱스는 UNIQUE(from_user_id, to_user_id) /
-- UNIQUE(user_id, pinned_user_id) 복합뿐이라 선두 컬럼(from_user_id·user_id) 조건만 탈 수 있고,
-- 역방향 컬럼(to_user_id·pinned_user_id) 단독 조건은 인덱스를 못 타 순차 스캔으로 빠진다.
-- (PostgreSQL 은 FK 컬럼에 인덱스를 자동 생성하지 않는다.)
--
-- 탈퇴 정리는 그 스캔을 탈퇴 트랜잭션 안에서 수행하므로, 테이블이 커지면 탈퇴 한 번이 테이블 전체를
-- 훑으며 트랜잭션을 길게 잡는다. 역방향 컬럼에 인덱스를 추가해 양쪽 브랜치 모두 인덱스를 타게 한다.
--
-- 이 갭은 이번 정리 로직이 만든 것이 아니다 — findAcceptedByUser·countAcceptedByUser 등 기존 OR 조회가
-- 이미 같은 특성을 갖고 있었고, 탈퇴 경로가 추가되며 노출 빈도가 늘었다.
--
-- ── CONCURRENTLY 인 이유 ─────────────────────────────────────────────────────
-- 일반 CREATE INDEX 는 빌드가 끝날 때까지 대상 테이블의 쓰기를 막는다(SHARE 락). dev/staging/prod 는
-- 부팅 시 Flyway 가 자동 실행되므로, 배포 중 친구 요청·수락·삭제가 통째로 대기하게 된다.
-- 부하테스트 기준 friendships 약 200 만 행(loadtest/seed/volume.md) 규모에서는 장애로 번질 수 있어
-- 온라인 생성(CONCURRENTLY)으로 기존 DML 을 막지 않는다.
--
-- CONCURRENTLY 는 트랜잭션 블록 안에서 실행할 수 없다 → 같은 이름의 .sql.conf 로 executeInTransaction=false.
--
-- 주의(운영): CONCURRENTLY 는 실패 시 INVALID 인덱스를 남긴다. 그 상태로 재시도하면
-- IF NOT EXISTS 가 생성을 건너뛰어 못 쓰는 인덱스가 방치되므로, 각 생성 앞에 DROP ... CONCURRENTLY
-- IF EXISTS 를 둬 재시도가 스스로 정리하게 한다(최초 실행에서는 no-op).

-- friendships: 살아있는 관계만 조회하므로(deleted_at IS NULL) 부분 인덱스로 크기를 줄인다.
DROP INDEX CONCURRENTLY IF EXISTS idx_friendships_to_user_active;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_friendships_to_user_active
    ON public.friendships (to_user_id)
    WHERE deleted_at IS NULL;

-- pinned_users: 소프트딜리트 컬럼이 없어 전체 인덱스.
DROP INDEX CONCURRENTLY IF EXISTS idx_pinned_users_pinned_user;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pinned_users_pinned_user
    ON public.pinned_users (pinned_user_id);
