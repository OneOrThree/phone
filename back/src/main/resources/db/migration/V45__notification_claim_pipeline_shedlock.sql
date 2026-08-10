-- ════════════════════════════════════════════════════════════════════
-- V45 — notification_sent_logs 사건 단위 클레임 확장 + ShedLock 스키마
--       (GROMO-1417 · N41 · N44 / GROMO-1283 · policy §E4)
-- ════════════════════════════════════════════════════════════════════
-- · kind / subject_id: dedup 축을 "사건 단위 (유저 × kind × 대상 id)" 로 옮긴다(N41).
--   슬롯 단위로 dedup 하면 발송 후 생긴 후보(같은 kind 의 연속 정산 포함)가 충돌로 스킵돼
--   돈이 걸린 결과 알림이 유실된다. 기존 행은 kind=type · subject_id=NULL 로 백필한다 —
--   유니크 인덱스는 NULL 을 서로 다른 값으로 취급하므로(Postgres 기본) 과거 이력과 충돌하지 않는다.
-- · status / claimed_at: "조회 후 발송" 은 다중 인스턴스에서 이중 발송이 가능하므로, 발송 전에
--   PENDING 행을 INSERT 해 선점한다(충돌 = 남이 선점). claimed_at 은 10분 리스의 기준 —
--   선점 후 죽은 워커의 건이 영구 미발송으로 남지 않게 만료 후 재클레임한다.
--   DEFERRED 는 조용한 시간(23–07)에 걸린 표시 푸시의 이월 상태다(N44 — 버리지 않고 07:00 발송).
-- · group_id / slot_at: 묶음 키 (유저 × 그룹 × 시간슬롯) 의 메타(N20·N41). dedup 키와는 분리다.
-- · sent_at NULL 허용: PENDING/DEFERRED 클레임 행은 아직 발송 전이다 — 실발송 시각은 SENT 전이 때 채운다.

ALTER TABLE public.notification_sent_logs
    ADD COLUMN kind character varying(255);

UPDATE public.notification_sent_logs SET kind = type;

ALTER TABLE public.notification_sent_logs
    ALTER COLUMN kind SET NOT NULL;

ALTER TABLE public.notification_sent_logs
    ADD COLUMN subject_id uuid;

ALTER TABLE public.notification_sent_logs
    ADD COLUMN status character varying(20) DEFAULT 'SENT' NOT NULL
        CONSTRAINT notification_sent_logs_status_check
            CHECK ((status)::text = ANY ((ARRAY[
                'PENDING'::character varying,
                'DEFERRED'::character varying,
                'SENT'::character varying])::text[]));

ALTER TABLE public.notification_sent_logs
    ADD COLUMN claimed_at timestamp(6) with time zone;

ALTER TABLE public.notification_sent_logs
    ADD COLUMN group_id uuid;

ALTER TABLE public.notification_sent_logs
    ADD COLUMN slot_at timestamp(6) with time zone;

ALTER TABLE public.notification_sent_logs
    ALTER COLUMN sent_at DROP NOT NULL;

-- 사건 단위 선점 유니크 — INSERT … ON CONFLICT (user_id, kind, subject_id) DO NOTHING 의 대상.
CREATE UNIQUE INDEX uq_notification_sent_logs_user_kind_subject
    ON public.notification_sent_logs (user_id, kind, subject_id);

-- 미발송 클레임 스캔(리스 만료 회수·이월 flush) — SENT 가 대다수라 부분 인덱스로 좁힌다.
CREATE INDEX idx_notification_sent_logs_unsent_claims
    ON public.notification_sent_logs (status, claimed_at)
    WHERE (status)::text <> 'SENT'::text;

-- ── ShedLock (GROMO-1283 · policy §E4) ─────────────────────────────────
-- 챌린지·정산·알림 크론의 멀티 인스턴스 중복 실행 차단 — shedlock-provider-jdbc-template 표준 스키마.
CREATE TABLE public.shedlock (
    name       character varying(64)  NOT NULL,
    lock_until timestamp              NOT NULL,
    locked_at  timestamp              NOT NULL,
    locked_by  character varying(255) NOT NULL,
    CONSTRAINT shedlock_pkey PRIMARY KEY (name)
);
