-- GROMO-1992 · 로그인 시도 원장에 계정 전환(account switch) 재개 증거 열 추가
--
-- 게스트 계정이 소셜 로그인으로 전환될 때, 제공자 검증이 끝난 「전환 사실」을 attempt 에 남긴다.
-- 201/200 응답이 유실돼 앱이 재시도해도 같은 시도 id 로 전환 결과를 재생할 수 있게 하기 위한
-- 내구 증거이다 — login_attempts 가 소셜 로그인에 대해 하는 일의 전환 축 확장이다.
--
-- FK 를 걸지 «않는다»: user_id·session_id 와 같은 이유다. source 게스트와 target 회원·social
-- 행은 탈퇴로 비활성화·삭제될 수 있고, login_attempts 는 그 경계를 넘어 복구 사실을 보존해야
-- 한다. RESTRICT 로 남의 정리 작업을 막아서도 안 된다.
-- provider subject·credential·토큰 원문은 여기에도 추가하지 않는다(표의 원문 금지 규칙 그대로).
--
-- 별도 인덱스는 두지 않는다 — 지금 예정된 접근은 PK attempt_id 단건뿐이고, source/target 스윕
-- 인덱스는 실제 cleanup 쿼리와 함께 후속 단계에서 결정한다.

ALTER TABLE login_attempts
    -- 앱이 「같은 게스트로 계속」이 아니라 「회원으로 전환」을 확정했는가. false 면 아래 7열은
    -- 전부 null 이어야 한다 — 충돌로 판정됐다가 실제 충돌이 아니어서 일반 로그인으로 끝난 행도
    -- confirmed=true + evidence null 모양을 가질 수 있다.
    ADD COLUMN account_switch_confirmed boolean NOT NULL DEFAULT false,
    -- VERIFIED | GUEST_WITHDRAWN — 일반/미준비 시도는 'NONE' 문자열이 아니라 NULL 이다.
    ADD COLUMN switch_phase varchar(24),
    -- 전환 «되는» 게스트 쪽 식별자. source 의 세션·auth generation 까지 고정해야 재생 시
    -- 게스트의 토큰을 그 세대 그대로 폐기할지 판정할 수 있다.
    ADD COLUMN switch_source_user_id uuid,
    ADD COLUMN switch_source_session_id uuid,
    ADD COLUMN switch_source_auth_generation bigint,
    -- 전환 «받는» 회원 쪽 식별자.
    ADD COLUMN switch_target_user_id uuid,
    ADD COLUMN switch_target_social_account_id uuid,
    ADD COLUMN switch_verified_at timestamptz;

-- 허용하는 모양은 정확히 세 가지다:
--   ① phase=null + evidence 전부 null  — 일반 시도이거나, confirmed 만 찍힌 미전환 시도
--   ② phase ∈ (VERIFIED, GUEST_WITHDRAWN) + status ∈ (PENDING, COMPLETED) + confirmed +
--      evidence 전부 non-null(generation ≥ 0) — 전환 검증이 끝난 시도(완료돼도 증거는 보존)
--   ③ phase ∈ (VERIFIED, GUEST_WITHDRAWN) + status=INVALIDATED + confirmed +
--      evidence 전부 null — invalidate() 가 증거를 지우고 phase/confirmed 만 종료 표지로 남긴 상태
--
-- ⚠️ SQL CHECK 는 UNKNOWN(null) 도 통과시킨다. 두 phase 분기에 `switch_phase IS NOT NULL` 을
--    명시하지 않으면 phase=null 인 채 evidence 만 채운 고아 행이 승인된다 — 각 분기의 첫 조건이다.
ALTER TABLE login_attempts
ADD CONSTRAINT ck_login_attempts_switch_state CHECK (
    (
        switch_phase IS NULL
        AND switch_source_user_id IS NULL
        AND switch_source_session_id IS NULL
        AND switch_source_auth_generation IS NULL
        AND switch_target_user_id IS NULL
        AND switch_target_social_account_id IS NULL
        AND switch_verified_at IS NULL
    )
    OR
    (
        switch_phase IS NOT NULL
        AND switch_phase IN ('VERIFIED', 'GUEST_WITHDRAWN')
        AND status IN ('PENDING', 'COMPLETED')
        AND account_switch_confirmed = true
        AND switch_source_user_id IS NOT NULL
        AND switch_source_session_id IS NOT NULL
        AND switch_source_auth_generation IS NOT NULL
        AND switch_source_auth_generation >= 0
        AND switch_target_user_id IS NOT NULL
        AND switch_target_social_account_id IS NOT NULL
        AND switch_verified_at IS NOT NULL
    )
    OR
    (
        switch_phase IS NOT NULL
        AND switch_phase IN ('VERIFIED', 'GUEST_WITHDRAWN')
        AND status = 'INVALIDATED'
        AND account_switch_confirmed = true
        AND switch_source_user_id IS NULL
        AND switch_source_session_id IS NULL
        AND switch_source_auth_generation IS NULL
        AND switch_target_user_id IS NULL
        AND switch_target_social_account_id IS NULL
        AND switch_verified_at IS NULL
    )
);
