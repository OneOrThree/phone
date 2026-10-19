-- GROMO-2287 섬 외부 v1.0 새 쿼리의 확장성 — 부분 인덱스 둘. 컬럼·데이터 변경 없음.
--
-- ① group_members (group_id, user_id) WHERE is_left = false
--   망원경 후보(GroupRepository#TELESCOPE_VISIBLE_SQL)는 섬마다 «활성 주민 수» 상관 서브쿼리와 «내 소속/강퇴 이력»
--   NOT EXISTS 를 돈다. 기존 UNIQUE (user_id, group_id) 는 선두가 user_id 라 «group_id 로 활성 주민을 모으는»
--   접근에 못 쓰여 섬마다 group_members 순차 읽기가 반복됐다(1만 명 fixture 중앙값 359.7ms → 7.5ms, 2026-10-18 조사).
--   선두 열이 달라 기존 인덱스와 중복이 아니다. 활성 행만 담아 이탈 행이 쌓여도 커지지 않는다.
--   수혜자는 «주민 수 상관 서브쿼리» 하나다: user_id 를 포함해 users 조인과 함께 Index Only Scan 으로 끝난다.
--   «내 소속/강퇴» NOT EXISTS 는 KICKED 행이 is_left = true 라 이 부분 인덱스를 못 쓰고 기존 UNIQUE (user_id, group_id) 를 탄다(그쪽이 더 좋은 경로).
--   관측: Index Only Scan 은 visibility map 에 의존한다 — autovacuum 이 밀리면 EXPLAIN 의 Heap Fetches 가 늘 수 있다.
--   행이 훨씬 늘면 CREATE INDEX CONCURRENTLY 는 Flyway 트랜잭션 밖(executeInTransaction=false)이 필요하므로 별도 마이그레이션으로 한다.
--   쓰기 비용: 가입/이탈/재가입 시 인덱스 1개 추가 갱신(is_left 가 바뀌면 부분 인덱스 진입/이탈) — 하루 수십~수백 건 규모라 무시 가능.
CREATE INDEX group_members_active_group_user_idx ON group_members (group_id, user_id) WHERE is_left = false;

-- ② island_guestbook_entries (island_id, created_at DESC, id DESC) WHERE deleted_at IS NULL
--   최근 30개 목록·쓰기 직후 정리(trimBeyondLatest30)는 «살아 있는 글만 최신순». 기존
--   island_guestbook_island_created_idx (island_id, created_at DESC) 는 지운 글도 훑고 id 정렬을 따로 한다.
--   부분 인덱스는 지운 글을 아예 담지 않고 ORDER BY created_at DESC, id DESC LIMIT 30 을 인덱스 순서로 끝낸다.
--   기존 인덱스는 지우지 않는다(되돌림은 새 마이그레이션의 DROP INDEX).
CREATE INDEX island_guestbook_live_recent_idx ON island_guestbook_entries (island_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
