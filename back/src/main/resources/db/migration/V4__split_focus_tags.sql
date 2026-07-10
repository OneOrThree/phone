-- V4 — focus_tags → default_tags + user_focus_tags 분리 (GROMO-673)
-- 방향: dbml 정합. 태그를 정체성(default_tags 마스터)과 채택(user_focus_tags)으로 분리.
-- 데이터: 유저 태그(focus_tags)는 폐기(671 결정). 단 occupation 추천 태그 시드(occupation_default_tags)는
--   온보딩 기능 유지를 위해 name → default_tags 로 정규화 이관(보존). sort_order 는 dbml 누락으로 판정해
--   유지(추천 노출 순서의 유일한 소스 — occupations.sort_order 드롭이 만든 정렬 회귀(티켓 734) 재발 방지).

-- ── 1) default_tags — 글로벌 태그 마스터 ─────────────────────────────────────
CREATE TABLE default_tags (
    id         uuid PRIMARY KEY,
    name       varchar(255) NOT NULL UNIQUE,
    created_at timestamp(6) with time zone NOT NULL DEFAULT now()
);

-- ── 2) user_focus_tags — 유저 채택 태그 ─────────────────────────────────────
CREATE TABLE user_focus_tags (
    id                               uuid PRIMARY KEY,
    user_id                          uuid NOT NULL REFERENCES users (id),
    default_tag_id                   uuid NOT NULL REFERENCES default_tags (id),
    source_occupation_default_tag_id uuid REFERENCES occupation_default_tags (id),
    created_at                       timestamp(6) with time zone NOT NULL DEFAULT now(),
    deleted_at                       timestamp(6) with time zone
);
-- 동일 태그 중복 채택 방지는 **활성 행 한정** partial unique index 로 강제한다.
-- 테이블 UNIQUE(user_id, default_tag_id) 는 소프트딜리트 행까지 포함해, 태그 삭제 후 같은 이름
-- 재채택/이름 되돌리기가 영구 unique 위반(409)이 되므로 사용하지 않는다 (PR #170 리뷰).
CREATE UNIQUE INDEX uq_user_focus_tags_user_default_active
    ON user_focus_tags (user_id, default_tag_id)
    WHERE deleted_at IS NULL;

-- ── 3) occupation_default_tags 정규화: name(인라인) → default_tag_id(FK), 시드 보존 ──
-- 기존 추천 태그 name 을 default_tags 마스터로 승격(중복 name 은 1행). 빈 테이블이면 0행(무해).
INSERT INTO default_tags (id, name, created_at)
SELECT gen_random_uuid(), s.name, now()
FROM (SELECT DISTINCT name FROM occupation_default_tags) s
ON CONFLICT (name) DO NOTHING;

ALTER TABLE occupation_default_tags ADD COLUMN default_tag_id uuid;
UPDATE occupation_default_tags o SET default_tag_id = d.id FROM default_tags d WHERE d.name = o.name;
ALTER TABLE occupation_default_tags ALTER COLUMN default_tag_id SET NOT NULL;
ALTER TABLE occupation_default_tags
    ADD CONSTRAINT fk_occupation_default_tags_default_tag FOREIGN KEY (default_tag_id) REFERENCES default_tags (id);
-- 방어적 dedup: 동일 (occupation, name) 중복 시드가 레거시에 있으면 UNIQUE 부착이 실패(23505)하므로
-- 백필 후 중복 행을 1행만 남기고 제거한다 (V2 배포 실패 교훈 — 기존 행 정규화 선행).
DELETE FROM occupation_default_tags a
USING occupation_default_tags b
WHERE a.occupation = b.occupation
  AND a.default_tag_id = b.default_tag_id
  AND a.id > b.id;
ALTER TABLE occupation_default_tags
    ADD CONSTRAINT uq_occupation_default_tags_occ_tag UNIQUE (occupation, default_tag_id);
-- name 드롭 — name 을 참조하던 제약/인덱스는 PostgreSQL 이 컬럼 드롭 시 함께 제거.
ALTER TABLE occupation_default_tags DROP COLUMN name;

-- ── 4) focus_sessions.focus_tag_id FK 재지정: focus_tags → user_focus_tags ──
-- 레거시 참조 정리 먼저(기존 유저 태그 폐기 — 671 결정), 그 다음 FK 교체 (V2 배포 실패 교훈: 기존 행 정규화 선행).
UPDATE focus_sessions SET focus_tag_id = NULL WHERE focus_tag_id IS NOT NULL;
ALTER TABLE focus_sessions DROP CONSTRAINT fk5b795b8k404efrrkf6fnxdhf9;
ALTER TABLE focus_sessions
    ADD CONSTRAINT fk_focus_sessions_user_focus_tag FOREIGN KEY (focus_tag_id) REFERENCES user_focus_tags (id);

-- ── 5) 구 단일 태그 테이블 제거 ─────────────────────────────────────────────
DROP TABLE focus_tags;
