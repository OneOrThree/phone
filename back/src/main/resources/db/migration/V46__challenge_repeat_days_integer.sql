-- GROMO-1506 — repeat_days 컬럼 타입을 smallint → integer 로 맞춘다.
--
-- 왜 필요한가: V34 가 `ADD COLUMN repeat_days smallint` 로 만들었는데
-- 엔티티(GroupChallenge.java)는 `private int repeatDays` 다. Hibernate 는 int 에
-- integer(Types#INTEGER)를 기대하므로, ddl-auto: validate 를 쓰는 dev/staging/prod 에서
-- 스키마 검증이 거부되고 EntityManagerFactory 생성이 실패한다 → 앱이 아예 뜨지 않는다.
--
--   Schema validation: wrong column type encountered in column [repeat_days]
--   in table [group_challenges]; found [int2 (Types#SMALLINT)],
--   but expecting [integer (Types#INTEGER)]
--
-- 챌린지 v2 배치(V34~V45)가 머지 후 첫 배포라 이제 드러났다.
-- CI 는 이 부류를 못 잡는다 — application-ci.yml 이 ddl-auto: create-drop + flyway.enabled: false 라
-- 마이그레이션을 실행하지 않고 엔티티에서 스키마를 만든다(게이트 추가는 후속 티켓 1507).
--
-- 왜 컬럼을 넓히나(엔티티를 short 로 좁히지 않고): 비트마스크 상수(RepeatSchedule.EVERYDAY 등)와
-- 비트 연산이 전부 int 라, 엔티티를 short 로 바꾸면 도메인·서비스·DTO 로 캐스팅이 번진다.
-- 값 범위(1~127)는 어느 쪽이든 남으므로 저장 폭을 맞추는 편이 변경면이 작다.
--
-- Forward-only: 이미 적용된 V34 는 수정하지 않는다(Flyway 체크섬).
-- smallint → integer 는 PostgreSQL 에서 무손실 확대 변환이라 USING 절이 필요 없고,
-- 값·NOT NULL·CHECK(repeat_days BETWEEN 1 AND 127) 는 그대로 유지된다.

ALTER TABLE group_challenges
    ALTER COLUMN repeat_days TYPE integer;
