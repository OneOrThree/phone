-- GROMO-2306 망원경 1시간 고정 + 핀 1시간 (섬 외부 v1.0 마무리 계약 §1).
--
-- telescope_buckets: 사람마다 1시간 버킷의 망원경 새 섬 목록 스냅샷. 그 버킷의 첫 목록 요청이 후보를 뽑아 한 행을
--   넣고(ON CONFLICT DO NOTHING — 두 기기 동시 첫 요청이면 한쪽 행이 이긴다), 같은 버킷 안의 요청은 이 행을 읽는다.
--   정원·가입·강퇴·비공개 변동은 표시(full·membershipStatus·칸 빠짐)만 바꾸고 뽑은 섬·순서는 바꾸지 않는다.
--   정리 잡은 없다 — 새 버킷 행을 넣을 때 그 사람의 옛 버킷 행을 함께 지운다.
-- island_ids: 뽑은 순서 그대로(최대 5 = 가까운 섬 1 + 무작위 4). 섬이 지워져도 FK 가 아니라 남는다 — 읽을 때 거른다.
-- has_nearby: island_ids[1] 이 뽑힌 순간 정원이 남아 있었는지 — 그 섬이 이 버킷 동안 가까운 섬(15분)이다.
CREATE TABLE telescope_buckets (
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    bucket_start timestamptz NOT NULL,
    island_ids   uuid[]      NOT NULL,
    has_nearby   boolean     NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, bucket_start)
);

COMMENT ON TABLE telescope_buckets IS
    '망원경 1시간 목록 스냅샷(GROMO-2306) — 같은 버킷 안에서는 이 행이 정본이고 정원·가입 변동은 표시(full·membershipStatus)만 바꾼다';

-- 핀 만료를 «다음 07:00 KST» 에서 «넣은 버킷의 끝(넣은 정시 + 1시간)» 으로 바꾼다. 이미 그보다 이른 만료는 그대로 둔다.
-- 대부분의 기존 핀은 이 UPDATE 로 곧바로 만료된다(정본 SCOPE-07 «1시간 갱신 때 무작위 섬과 함께 사라진다»).
UPDATE telescope_pins
SET expires_at = LEAST(expires_at, date_trunc('hour', pinned_at) + interval '1 hour');
