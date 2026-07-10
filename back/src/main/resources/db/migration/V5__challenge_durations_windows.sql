-- V5 — 챌린지 type별 파라미터 CTI 분리 + groups 미션 컬럼 이관 (GROMO-674)
-- 방향: dbml 정합. group_challenges 의 duration/window 를 1:1 상세 테이블로 분리(CTI, NULL 오염 방지),
--   groups 의 미션 컬럼(mission_*, window_*, duration_minutes)은 그룹의 대표 챌린지로 이관 후 드롭.
-- 데이터: 기존 그룹의 미션 설정은 유저 데이터라 보존 이관(챌린지 없는 그룹 → 대표 챌린지 신설).
--   V2 배포 실패 교훈 — 기존 행 정규화/이관을 제약·드롭보다 먼저 수행.

-- ── 1) CTI 상세 테이블 생성 ─────────────────────────────────────────────────
CREATE TABLE group_challenge_durations (
    challenge_id     uuid PRIMARY KEY REFERENCES group_challenges (id),
    duration_minutes integer NOT NULL
);

CREATE TABLE group_challenge_windows (
    challenge_id    uuid PRIMARY KEY REFERENCES group_challenges (id),
    window_start_at timestamp(6) with time zone NOT NULL,
    window_end_at   timestamp(6) with time zone NOT NULL
);

-- ── 2) 기존 group_challenges 인라인 파라미터 → 상세 테이블 이관 ────────────────
INSERT INTO group_challenge_durations (challenge_id, duration_minutes)
SELECT id, duration_minutes
FROM group_challenges
WHERE type = 'DURATION' AND duration_minutes IS NOT NULL;

INSERT INTO group_challenge_windows (challenge_id, window_start_at, window_end_at)
SELECT id, window_start, window_end
FROM group_challenges
WHERE type = 'TIME_WINDOW' AND window_start IS NOT NULL AND window_end IS NOT NULL;

-- ── 3) 그룹의 창설 미션 설정 → 대표 챌린지 신설(보존 이관) ─────────────────────
-- 가드는 (type, category) 일치 챌린지 존재 여부 — 그룹에 "다른" 미션의 챌린지만 있어도 창설 미션이
-- 이관 없이 드롭되던 유실 버그 방지 (PR #173 리뷰). 같은 미션의 챌린지가 이미 있으면 그 행이 대표.
INSERT INTO group_challenges (id, group_id, type, category, status, created_at)
SELECT gen_random_uuid(), g.id, g.mission_type, g.mission_category, 'ACTIVE', now()
FROM groups g
WHERE g.mission_type IS NOT NULL AND g.mission_category IS NOT NULL
  AND NOT EXISTS (SELECT 1
                  FROM group_challenges c
                  WHERE c.group_id = g.id
                    AND c.type = g.mission_type
                    AND c.category = g.mission_category);

-- 상세 없는 창설-미션 챌린지에 그룹 인라인 값 백필 — category 까지 일치시켜
-- 다른 카테고리의 기존 챌린지에 그룹 값이 잘못 붙는 것을 방지.
INSERT INTO group_challenge_durations (challenge_id, duration_minutes)
SELECT c.id, g.duration_minutes
FROM group_challenges c
         JOIN groups g ON g.id = c.group_id
WHERE c.type = 'DURATION' AND c.type = g.mission_type AND c.category = g.mission_category
  AND g.duration_minutes IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM group_challenge_durations d WHERE d.challenge_id = c.id);

INSERT INTO group_challenge_windows (challenge_id, window_start_at, window_end_at)
SELECT c.id, g.window_start, g.window_end
FROM group_challenges c
         JOIN groups g ON g.id = c.group_id
WHERE c.type = 'TIME_WINDOW' AND c.type = g.mission_type AND c.category = g.mission_category
  AND g.window_start IS NOT NULL AND g.window_end IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM group_challenge_windows w WHERE w.challenge_id = c.id);

-- ── 4) 인라인 컬럼 드롭 (이관 완료 후) ─────────────────────────────────────────
-- group_challenges: 파라미터는 상세 테이블로. time_zone 은 dbml 폐기(window 는 UTC 저장).
ALTER TABLE group_challenges DROP COLUMN duration_minutes;
ALTER TABLE group_challenges DROP COLUMN window_start;
ALTER TABLE group_challenges DROP COLUMN window_end;
ALTER TABLE group_challenges DROP COLUMN time_zone;

-- groups: 미션 설정은 대표 챌린지 소유(dbml). 컬럼 드롭 시 관련 CHECK 도 함께 제거된다.
ALTER TABLE groups DROP COLUMN mission_category;
ALTER TABLE groups DROP COLUMN mission_type;
ALTER TABLE groups DROP COLUMN window_start;
ALTER TABLE groups DROP COLUMN window_end;
ALTER TABLE groups DROP COLUMN duration_minutes;
