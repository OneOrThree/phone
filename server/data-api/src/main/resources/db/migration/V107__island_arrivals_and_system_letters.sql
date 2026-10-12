-- GROMO-2260 섬 도착 기록 + 시스템 편지 (섬 외부 계약 §1).
--
-- island_arrivals: 이 사람이 이 섬에 «가 본 적» 이 있는가(first)와 «최근 머문» 시각(last).
--   즉시 이동(PUT /me/current-island)은 도착 기록이 있는 소속 섬만 받는다 — 망원경에서 가입하고
--   아직 항해하지 않은 섬은 목록에 arrivedBefore=false 로 보인다. 나가기·강퇴 뒤 다음 위치는
--   남은 소속 중 last_arrived_at 이 가장 늦은 섬이다.
CREATE TABLE island_arrivals (
    user_id          uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    island_id        uuid        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    first_arrived_at timestamptz NOT NULL,
    last_arrived_at  timestamptz NOT NULL,
    PRIMARY KEY (user_id, island_id)
);

-- 기존 활성 소속은 전부 «가 본 섬» 으로 채운다 — V107 이전의 가입·생성은 전부 그 섬으로 바로
-- 옮겼다(즉시 가입·생성의 moveTo). 채우지 않으면 배포 순간 기존 주민 전원의 섬 이동이 403 이 된다.
-- 시각은 멤버십 시작 축(COALESCE(rejoined_at, created_at), V97 주석)이다.
INSERT INTO island_arrivals (user_id, island_id, first_arrived_at, last_arrived_at)
SELECT gm.user_id, gm.group_id,
       COALESCE(gm.rejoined_at, gm.created_at, now()),
       COALESCE(gm.rejoined_at, gm.created_at, now())
FROM group_members gm
WHERE gm.is_left = false;

-- 시스템 편지 — 강퇴·가입 승인 안내. 발신자가 사람이 아니라 sender_id 가 NULL 이다.
ALTER TABLE letters ALTER COLUMN sender_id DROP NOT NULL;
ALTER TABLE letters ADD COLUMN kind varchar(20) NOT NULL DEFAULT 'FRIEND'
    CHECK (kind IN ('FRIEND', 'KICK', 'JOIN_APPROVED'));
ALTER TABLE letters ADD COLUMN island_id uuid REFERENCES groups (id) ON DELETE SET NULL;
