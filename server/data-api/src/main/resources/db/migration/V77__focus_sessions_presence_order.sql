-- GROMO-1743: 집중 프레즌스 순서 판정을 DB 순번으로.
--
-- presence:focus:{userId} 리스의 「어느 시작·종료가 더 새로운가」는 지금까지 세션 id(UUID v7)의 문자열
-- 비교였다. UUID v7 의 앞자리는 id 를 만든 «인스턴스의 벽시계»라, data-api 를 여러 대로 늘리면 시계가
-- 앞선 대가 만든 이전 세션 id 가 뒤처진 대의 다음 세션 id 보다 커질 수 있다. 순서의 근거를 공유
-- 저장소(이 시퀀스)로 옮긴다.
--
-- 같은 사용자의 두 시작은 users 행 배타 락 아래서 INSERT 되므로(레거시 start · v0.3 start 모두),
-- 한 사용자 안에서 번호 순서가 곧 커밋 순서다. 사용자끼리는 비교하지 않는다(키가 사용자별이다).
--
-- 테이블 재작성을 피하려고 BIGSERIAL 로 한 번에 넣지 않는다: 널 허용 컬럼 추가 → 시퀀스 → DEFAULT.
-- 셋 다 카탈로그만 바꾼다. 기존 행은 널이고, 읽는 쪽(RedisFocusPresence)은 널이면 순서 판정을 건너뛴다.
-- 롤백(이미지만 되돌림)에도 무해하다 — 구버전은 이 컬럼을 모르고 INSERT 하고, DEFAULT 가 번호를 채운다.
ALTER TABLE public.focus_sessions ADD COLUMN presence_order bigint;

CREATE SEQUENCE public.focus_sessions_presence_order_seq OWNED BY public.focus_sessions.presence_order;

ALTER TABLE public.focus_sessions
    ALTER COLUMN presence_order SET DEFAULT nextval('public.focus_sessions_presence_order_seq');

-- 열린 마커만 번호를 받는다(사용자당 1건이라 수가 작다). 이 세션들의 종료가 배포 뒤에 오므로, 번호가
-- 없으면 그 종료는 순서 판정을 건너뛰어 리스를 못 지운다 — 그러면 TTL(최대 13시간) 내내 채팅이 막힌다.
-- 이미 끝난 행은 그대로 널이다 — 그 행으로 올 종료는 재전달뿐이고, 건너뛰어도 결과가 같다.
UPDATE public.focus_sessions
   SET presence_order = nextval('public.focus_sessions_presence_order_seq')
 WHERE ended_at IS NULL;

COMMENT ON COLUMN public.focus_sessions.presence_order IS
    'GROMO-1743: 집중 프레즌스 리스의 순서 판정 키(DB 시퀀스). 인스턴스 시계에 묶인 UUID v7 대신 쓴다. V77 이전에 끝난 행은 NULL.';
