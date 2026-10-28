-- GROMO-1995 · 마지막 소속 이탈 후 서버 컨텍스트 복구
--
-- 정책(policy-2026-09-14 §섬 가입·전망대·랭킹): 「모든 주민은 마지막 소속 섬에서도 탈퇴할 수 있다.
-- 마지막 소속 섬에서 탈퇴하면 처음 온보딩의 `04 · 혼자 시작 / 기존 섬 참여` 화면으로 이동한다.」
--
-- 그 이동을 서버가 표현하려면 current_island_id 를 null 로 «되돌리는» 쓰기가 필요한데, 지금까지는
-- 그 쓰기가 없어 null = 「한 번도 소속된 적 없음」과 동치였다(IslandMovementGuards#requireDepartureUnlocked
-- 가 그 등식에 기대고 있고, 등식이 깨지기 전에 상실 사유가 필요하다고 미리 경고해 뒀다).
--
-- 이 컬럼이 그 경고에 답한다 — null 인 current_island_id 를 두 상태로 가른다:
--   loss_reason IS NULL      → 한 번도 소속된 적 없음(온보딩 첫 진입)
--   loss_reason = 'LEFT'     → 마지막 섬에서 자진 탈퇴해 잃었음
--   loss_reason = 'KICKED'   → 마지막 섬에서 강퇴돼 잃었음 (처리 방침은 아직 미결 — 사유만 남긴다)
--
-- 값 집합은 group_members.left_reason(GroupLeaveReason)과 같다. 두 컬럼이 같은 사실의 두 기록이라
-- 이름을 갈라 두면 나중에 한쪽만 늘어난다.
ALTER TABLE user_island_contexts
    ADD COLUMN loss_reason varchar(20);

ALTER TABLE user_island_contexts
    ADD CONSTRAINT user_island_contexts_loss_reason_check
        CHECK (loss_reason IS NULL OR loss_reason IN ('LEFT', 'KICKED'));

-- ════════════════════════════════════════════════════════════════════════════
-- 이 배포 «전»에 이미 죽어 있던 현재 섬을 회수한다
-- ════════════════════════════════════════════════════════════════════════════
-- UserIslandContextRecovery 는 «이후»의 이탈에만 돈다. 그 전에 탈퇴·강퇴된 사람의 current_island_id 는
-- 지금도 비활성 멤버십을 가리킨 채 남아 있다 — 읽기 경로(IslandMembershipService#liveCurrentIsland)가
-- 런타임에 접어 감추므로 화면은 빈 온보딩으로 보이지만, 저장된 값은 여전히 죽은 섬이라 출발 섬 전망대
-- 가드(IslandMovementGuards#requireDepartureUnlocked)는 그 죽은 섬을 기준으로 생성·가입을 계속 막는다.
-- 그래서 컬럼만 얹고 끝내지 않는다.
--
-- 규칙은 런타임 회수와 «같다» (UserIslandContextRecovery#onMembershipRevoked):
--   ① 남은 활성 소속이 있으면 남은 «메인 섬»으로 옮긴다.
--      메인 섬 = MainIslandService#mainIslandId 와 같은 도출: 명시로 고른 user_main_islands 행이 있으면
--      그것, 없으면 가장 먼저 가입한 활성 섬(created_at, id 오름차순의 첫 행).
--   ② 남은 활성 소속이 없으면 current_island_id 를 NULL 로 두고 사유를 적는다.
--
-- 사유는 «관찰할 수 있는 것»만 적는다. 이 배포 이전 데이터에는 컨텍스트가 어떻게 끊겼는지 기록이 없어
-- 자진 이탈인지 강퇴인지 그 자체로는 알 수 없다. 유일한 근거는 잃은 섬의 group_members.left_reason 이다:
--   · left_reason 이 있으면(LEFT|KICKED) 그 값을 그대로 옮긴다.
--   · 멤버십 행 자체가 없거나 left_reason 이 NULL 이면(V30 이전 유령 이탈 등) loss_reason 을 NULL 로 둔다.
--     런타임의 reasonOf 는 그 자리에서 LEFT 로 기본값을 주지만, 그건 «방금 일어난» 이탈이라 자진 탈퇴가
--     사실상 확실한 경우다. 과거 행에 같은 기본값을 쓰면 강퇴를 자진 탈퇴로 «지어내는» 것이 된다.
--     NULL 이면 「한 번도 없음」과 구별되지 않지만, 그건 우리가 실제로 모르는 상태 그대로다.
--
-- context_version 은 올리지 않는다 — 마이그레이션은 앱이 트래픽을 받기 전에 돌아 대조할 인스턴스가 없다.
WITH recovered AS (
    SELECT c.user_id,
           -- ① 옮겨 갈 곳 — 명시 선택이 있으면 그것, 없으면 가장 먼저 가입한 활성 섬.
           COALESCE(
               (SELECT m.island_id FROM user_main_islands m WHERE m.user_id = c.user_id),
               (SELECT gm.group_id
                FROM group_members gm
                WHERE gm.user_id = c.user_id AND gm.is_left = false
                ORDER BY gm.created_at ASC, gm.id ASC
                LIMIT 1)) AS next_island_id,
           -- ② 관찰된 사유 — 잃은 섬의 멤버십 행에 남아 있는 값뿐. (user_id, group_id) 는 unique 라 1행이다.
           (SELECT gm.left_reason
            FROM group_members gm
            WHERE gm.user_id = c.user_id AND gm.group_id = c.current_island_id) AS observed_reason
    FROM user_island_contexts c
    WHERE c.current_island_id IS NOT NULL
      AND NOT EXISTS (SELECT 1
                      FROM group_members gm
                      WHERE gm.user_id = c.user_id
                        AND gm.group_id = c.current_island_id
                        AND gm.is_left = false)
)
UPDATE user_island_contexts c
SET current_island_id = r.next_island_id,
    loss_reason = CASE WHEN r.next_island_id IS NULL THEN r.observed_reason END,
    updated_at = now()
FROM recovered r
WHERE r.user_id = c.user_id;

-- 백필 뒤에도 모순이 남으면 배포를 멈춘다. 남을 수 있는 경우는 하나다: 명시로 고른 메인 섬(①)이
-- 활성 멤버십이 아닌 섬을 가리키는 것. 그 불변식은 MainIslandService#choose(활성 주민만 고를 수 있다)와
-- #onMembershipRevoked(멤버십이 끝나면 행을 옮기거나 지운다)가 지키므로, 깨져 있다면 그것부터 봐야 한다.
-- 조용히 틀린 current_island_id 로 서비스를 여는 것보다 부팅을 세우는 쪽이 낫다.
DO $$
DECLARE
    stale bigint;
BEGIN
    SELECT count(*) INTO stale
    FROM user_island_contexts c
    WHERE c.current_island_id IS NOT NULL
      AND NOT EXISTS (SELECT 1
                      FROM group_members gm
                      WHERE gm.user_id = c.user_id
                        AND gm.group_id = c.current_island_id
                        AND gm.is_left = false);
    IF stale > 0 THEN
        RAISE EXCEPTION 'V84: 활성 멤버십이 없는 current_island_id 가 % 건 남았습니다 — user_main_islands 가 비활성 섬을 가리킵니다', stale;
    END IF;
END $$;

-- 현재 섬이 있는데 상실 사유가 남아 있으면 복구 판정이 두 값 사이에서 갈린다 — 이동이 사유를 지우는
-- 것을 DB 가 강제한다(UserIslandContext#moveTo 가 그렇게 쓴다). 위 백필의 ① 갈래도 같은 규칙을 따른다.
ALTER TABLE user_island_contexts
    ADD CONSTRAINT user_island_contexts_loss_reason_exclusive
        CHECK (current_island_id IS NULL OR loss_reason IS NULL);
