-- 그룹 공개/비공개 구분 도입.
-- 비공개 그룹은 이름 검색(GET /groups/search)에서 제외되고 초대 링크(groupId)로만 참여한다.
-- 기존 그룹은 전부 false(공개)로 남는다 — 비공개 의도 그룹이 있으면 수동 정정 대상이다.
ALTER TABLE public.groups
    ADD COLUMN is_private boolean NOT NULL DEFAULT false;

-- 그룹 이름 유사도 검색용 GIN 인덱스 (닉네임 검색 idx_users_nickname_trgm 과 동형).
-- pg_trgm 확장은 V1__baseline.sql:30 에 이미 있다.
CREATE INDEX idx_groups_name_trgm
    ON public.groups USING gin (name public.gin_trgm_ops);
