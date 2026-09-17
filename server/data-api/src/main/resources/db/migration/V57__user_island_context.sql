-- ════════════════════════════════════════════════════════════════════
-- V57 — 현재 섬 컨텍스트 저장소 + groups.approval_required (GROMO-1907 · island-membership LLD §4)
-- ════════════════════════════════════════════════════════════════════
-- 섬 생성·가입·현재 섬 이동·집중 세션 시작이 같은 사용자 축을 동시에 건드리는데, 이를 직렬화할 공통
-- 저장소가 없었다. user_island_contexts 는 그 논리 모델(UserIslandContext, LLD §4)의 실제 테이블이다 —
-- PK 가 곧 유저 id(1:1)라 users 행 배타 락 아래에서 이 행의 «첫 생성» 경합까지 함께 막힌다
-- (UserIslandContextLockService 참조 — insert-then-relock 같은 별도 장치가 필요 없는 이유).
--
-- context_version 은 groups.version 과 같은 방식의 JPA @Version 낙관락이다. outbox 순서용
-- aggregate_versions(USER, userId) 축(㊸)과는 별개 값이다 — 그 축은 인증 세션·알림·초대·탈퇴 등
-- 무관한 도메인이 공유하는 발행 순서용이라, 컨텍스트 전이 여부와 섞으면 "무슨 일로 올랐는지 알 수
-- 없는" 값이 된다. 컨텍스트 전이는 outbox 사건도 아니다(island.members.updated 로 방송하지 않음, §3.6).
CREATE TABLE user_island_contexts (
    user_id           uuid PRIMARY KEY REFERENCES users (id),
    -- 아직 어떤 섬에도 속한 적 없으면 NULL. 상실 사유별 복구(IM-D06)는 미승인이라 이 컬럼 하나로
    -- "없음"과 "복구 대상"을 구분하지 않는다 — 승인되면 그때 lossReason 등을 더한다.
    current_island_id uuid REFERENCES groups (id),
    context_version   bigint NOT NULL DEFAULT 0,
    created_at        timestamp(6) with time zone NOT NULL DEFAULT now(),
    updated_at        timestamp(6) with time zone
);

COMMENT ON TABLE user_island_contexts IS
    '사용자의 현재 섬 컨텍스트(users 1:1) — 논리 모델 UserIslandContext. GROMO-1907, island-membership LLD §4';

-- ── groups.approval_required ─────────────────────────────────────────
-- 섬 API(1759)의 create 계약이 요구하는 승인제 여부. 기존 그룹은 전부 즉시가입(승인 없음)이었으므로
-- 기본값 false 로 과거 행의 의미를 보존한다.
ALTER TABLE groups ADD COLUMN approval_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN groups.approval_required IS
    '가입에 방장 승인이 필요한지 — GROMO-1907, island-membership LLD §3.1. 기존 행은 전부 false(즉시가입)';
