-- ════════════════════════════════════════════════════════════════════
-- 누끼(캐릭터) 생성 쿼터 — 생성 이력 기록 테이블
-- ════════════════════════════════════════════════════════════════════
-- 가입 후 7일 무제한, 이후 롤링 7일 내 2회 제한을 판정하기 위한 append-only 생성 이력.
-- 쿼터 계산은 (user_id, created_at) 로 창(now-7일 이후) 내 건수·가장 오래된 행을 조회한다.

CREATE TABLE public.character_generation (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id),
    created_at timestamp(6) with time zone NOT NULL
);

-- 유저별 롤링 7일 윈도우 count / 가장 오래된 행 조회용 복합 인덱스.
CREATE INDEX idx_character_generation_user_created_at
    ON public.character_generation (user_id, created_at);
