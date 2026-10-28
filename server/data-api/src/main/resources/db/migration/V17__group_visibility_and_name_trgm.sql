-- 그룹 공개/비공개 구분 도입.
-- 비공개 그룹은 이름 검색(GET /groups/search)에서 제외되고 초대 링크(groupId)로만 참여한다.
-- 기존 그룹은 전부 false(공개)로 남는다 — 비공개 의도 그룹이 있으면 수동 정정 대상이다.
--
-- 이름 trgm 인덱스는 일부러 여기 없다 → V18__group_name_trgm_index.sql.
-- 한 마이그레이션 = 한 트랜잭션이라, ADD COLUMN 이 잡은 ACCESS EXCLUSIVE 락이 이어지는 GIN 빌드가
-- 끝날 때까지 유지된다. 상수 default 컬럼 추가는 그 자체로는 즉시 끝나는데(PG 11+ 테이블 재작성 없음)
-- 인덱스와 묶이는 순간 그 시간만큼 그룹 조회·생성·참여가 통째로 대기한다. 그래서 컬럼만 먼저 커밋한다.
ALTER TABLE public.groups
    ADD COLUMN is_private boolean NOT NULL DEFAULT false;
