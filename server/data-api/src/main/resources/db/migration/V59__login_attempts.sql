-- GROMO-1908: 소셜 로그인 시도 원장 (계정 LLD §3 「로그인 내구 상태」).
--
-- 이 표는 «같은 X-Login-Attempt-Id 로 두 번 들어온 로그인» 을 한 번만 실행하기 위한 것이다.
-- 앱은 시도 시작 시 UUID 를 한 번 만들고, 응답이 유실되면 같은 값으로 재시도한다. 그 재시도에서
-- 제공자 일회성 code 를 다시 교환하면 (a) 제공자가 소비된 code 를 거절해 정상 로그인이 실패하고
-- (b) 성공하더라도 세션이 하나 더 생겨 「결과를 모르는 세션」이 쌓인다.
--
-- ⚠️ 토큰 «원문» 을 저장하지 않는다. LLD §3 이 두 번 금지한다(「원문 자격/원문 JWT 저장 금지」,
--    「Data 에는 원문 토큰 대신 해시·서명 재료만 남긴다」). 대신 최초 발급 토큰에서 뽑은
--    «고정 서명 재료» 를 남기고 재생 때 같은 재료로 다시 서명한다 — HS256 은 결정적이므로
--    같은 claims 에서 같은 문자열이 나온다. 그래서 이 표가 유출돼도 토큰이 유출되지 않는다.
--    (서명키가 함께 유출되면 재서명이 가능하지만, 그 경우는 이미 전 세션 위조가 가능한 상태다.)

CREATE TABLE login_attempts (
    -- 앱이 만든 X-Login-Attempt-Id 그대로. 이 값만으로는 아무것도 얻을 수 없다 —
    -- 조회에는 언제나 원 자격에서 계산한 credential_digest 가 함께 있어야 한다(LLD §3).
    attempt_id           uuid PRIMARY KEY,

    -- PENDING             : 실행권을 선점했고 결과가 아직 없다
    -- COMPLETED           : 결과 확정. 같은 자격의 재요청은 여기서 재생된다
    -- REPREPARE_REQUIRED  : 폐기가 아닌 CAS 경쟁 패배. Business 가 서명 주체가 되는 후속 단계
    --                       (GROMO-1661)에서만 발생한다 — 지금은 Data 가 서명하므로 이 경쟁이
    --                       없어 기록되지 않는다. 계약상의 상태라 CHECK 에는 미리 넣어 둔다.
    -- INVALIDATED         : 탈퇴·세션 폐기·복구 창 종료. 종료 상태이며 재준비/재생 금지
    status               varchar(24) NOT NULL
        CHECK (status IN ('PENDING', 'COMPLETED', 'REPREPARE_REQUIRED', 'INVALIDATED')),

    -- Business 가 keyed digest 를 계산한 비밀의 식별자. 「키가 바뀐 것」과 「자격이 다른 것」은
    -- 전혀 다른 사건인데 digest 만 비교하면 둘이 구분되지 않는다 — LLD §3 이 키 교체를
    -- IDEMPOTENCY_KEY_REUSED 로 판정하는 것을 명시적으로 금지하므로 key id 를 함께 고정한다.
    digest_key_id        varchar(64) NOT NULL,
    -- HMAC-SHA256 hex(64자). 원 code/credential 자체는 어떤 형태로도 저장하지 않는다.
    credential_digest    varchar(64) NOT NULL,

    provider             varchar(32) NOT NULL,
    -- id_token / access_token / authorization_code — digest 입력에 들어가는 자격 «종류».
    credential_kind      varchar(32) NOT NULL,
    -- 수락 당시 앱이 제시한 약관 버전. 카탈로그 확정(정책 Q05)은 이 표가 아니라 설정이 정한다.
    terms_version        varchar(64) NOT NULL,

    -- ── 확정 결과 (status=COMPLETED 일 때만 채워진다) ──
    -- FK 를 걸지 «않는다». auth_sessions.user_id 와 같은 이유다 — 탈퇴 익명화 뒤에도 「그 시도는
    -- 끝났다」는 사실이 남아야 하고, RESTRICT 로 남의 정리 작업을 막아서도 안 된다.
    user_id              uuid,
    session_id           uuid,
    onboarding_complete  boolean,

    -- ── 고정 서명 재료 (LLD §3). 이것으로 원 토큰을 «다시 만든다». ──
    token_guest          boolean,
    auth_generation      bigint,
    -- AT 와 RT 는 각자 서명되므로 발급 시각이 같은 초라는 보장이 없다. 따로 고정한다.
    access_issued_at     timestamptz,
    access_expires_at    timestamptz,
    refresh_issued_at    timestamptz,
    refresh_expires_at   timestamptz,
    -- RT 의 jti — 같은 초의 두 발급을 가르려고 무작위로 박힌다(JwtProvider.buildToken).
    -- 이 값을 고정하지 않으면 재생 토큰이 원본과 달라져 저장된 RT 해시와 어긋난다.
    refresh_jti          uuid,

    -- PENDING 실행권의 임차 시각. 실행자가 죽어 PENDING 이 남으면 이 시각으로 회수한다 —
    -- 회수가 없으면 그 attempt id 는 영원히 409 REQUEST_IN_PROGRESS 가 되어 사용자가 갇힌다.
    claimed_at           timestamptz NOT NULL,
    completed_at         timestamptz,
    -- 고정 복구 마감. 이 시각을 넘으면 재생하지 않고 새 제공자 인증을 요구한다(LLD §3).
    recovery_expires_at  timestamptz NOT NULL,

    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE login_attempts IS
    'GROMO-1908: POST /auth/sessions 의 내구 로그인 시도 원장. 토큰 원문 대신 고정 서명 재료를 보관한다.';
