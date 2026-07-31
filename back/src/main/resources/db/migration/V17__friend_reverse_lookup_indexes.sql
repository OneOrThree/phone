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

-- friendships: 살아있는 관계만 조회하므로(deleted_at IS NULL) 부분 인덱스로 크기를 줄인다.
CREATE INDEX IF NOT EXISTS idx_friendships_to_user_active
    ON public.friendships (to_user_id)
    WHERE deleted_at IS NULL;

-- pinned_users: 소프트딜리트 컬럼이 없어 전체 인덱스.
CREATE INDEX IF NOT EXISTS idx_pinned_users_pinned_user
    ON public.pinned_users (pinned_user_id);
