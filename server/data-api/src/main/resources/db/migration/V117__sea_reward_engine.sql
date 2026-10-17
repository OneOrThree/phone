-- GROMO-2274 바다 집중 누적 · 단계표 보상 엔진 (섬 외부 계약 §8) — 테이블 둘, 행은 넣지 않는다.
--
-- sea_focus_totals: 유저 한 명의 바다 집중 누적 한 행. 평생 누적(lifetime_seconds)은 줄지 않고, 이번 달 누적은
--   정산 달이 month_key 보다 늦어지면 month_key 가 갈리면서 0 에서 다시 시작한다(리셋은 정산 서비스가 가산 직전에
--   한다 — 월초 크론 없음. 앞으로만 간다: 시계가 뒤로 가 이전 달이 계산돼도 저장된 달의 누적에 더하고 되돌리지 않는다).
--   month_key 는 정산 시각을 KST 로 본 'YYYY-MM' 이다. 「도착 여부 무관」이라 섬·항해 상태 열이 없다.
--   유저는 익명화만 되고 삭제되지 않아 ON DELETE CASCADE 가 돌지 않는다 → 탈퇴 트랜잭션이 직접 지운다
--   (AccountWithdrawalService → SeaFocusRewardService.eraseWithdrawnUser, 계약 §0 N42). 개인 누적이라 남길 이유가 없다.
-- sea_reward_tiers: 단계표. 운영이 SQL 로 행을 넣고 바꾼다 — 코드 배포 없이 다음 달 시즌 세트를 연다.
--   set_key 는 'base'(평생 누적 기준) 또는 'YYYY-MM'(그 달 누적 기준, 월은 01~12) 이다 — CHECK 가 이 두 형식만 받아,
--   철자가 틀린 키('2026-1'·'2026/11')가 조용히 평가되지 않는 대신 insert 에서 거부된다. 행이 없는 달은 시즌 보상이
--   없을 뿐이다.
--   product_id 는 카탈로그 자산이다 — 지급은 개인 인벤토리(owned_products)라 clothes·decor 만 받고, 그 밖의 종류는
--   정산 서비스가 건너뛰며 경고를 남긴다(결정 N4 — hull 은 후속). 바다 전용 상품이 아직 없어 시드가 없다.
--   운영 카탈로그라 계정 탈퇴 정리 대상이 아니다.
CREATE TABLE sea_focus_totals (
    user_id          uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    lifetime_seconds bigint      NOT NULL DEFAULT 0,
    month_key        char(7)     NOT NULL,
    month_seconds    bigint      NOT NULL DEFAULT 0,
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sea_reward_tiers (
    id                bigserial   PRIMARY KEY,
    set_key           varchar(20) NOT NULL CHECK (set_key = 'base' OR set_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    threshold_minutes integer     NOT NULL CHECK (threshold_minutes > 0),
    product_id        varchar(80) NOT NULL REFERENCES catalog_assets (product_id),
    UNIQUE (set_key, threshold_minutes, product_id)
);
