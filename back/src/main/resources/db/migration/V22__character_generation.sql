-- ════════════════════════════════════════════════════════════════════
-- 누끼(캐릭터) 생성 쿼터 — 생성 이력 기록 테이블
-- ════════════════════════════════════════════════════════════════════
-- 가입 후 7일 무제한, 이후 롤링 7일 내 2회 제한을 판정하기 위한 append-only 생성 이력.
-- 쿼터 계산은 (user_id, created_at) 로 창(now-7일 이후) 내 건수·가장 오래된 행을 조회한다.

CREATE TABLE public.character_generation (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id),
    created_at timestamp(6) with time zone NOT NULL,
    -- 클라 멱등키(옵션) — 재시도 시 같은 생성이 2슬롯을 소비하지 않도록 (user_id, client_generation_id) 중복 무시.
    -- NULL 이면 멱등 없이 그대로 기록(하위호환: 키를 안 보내는 현행 클라).
    client_generation_id uuid
);

-- 유저별 롤링 7일 윈도우 count / 가장 오래된 행 조회용 복합 인덱스.
CREATE INDEX idx_character_generation_user_created_at
    ON public.character_generation (user_id, created_at);

-- 멱등키 부분 유니크 — 키가 있을 때만 (user_id, client_generation_id) 중복을 막는다.
-- 부분 인덱스(WHERE ... IS NOT NULL)라 키 없는 다중 행은 제약을 받지 않는다.
CREATE UNIQUE INDEX uq_character_generation_client_id
    ON public.character_generation (user_id, client_generation_id)
    WHERE client_generation_id IS NOT NULL;
