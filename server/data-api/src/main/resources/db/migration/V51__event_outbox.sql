-- ════════════════════════════════════════════════════════════════════
-- V51 — 공통 내구 이벤트·명령 기반 (GROMO-1659 · GROMO-1660 공통 선행 / 정본 A21·A22 ㊸·㊢·㋥)
-- ════════════════════════════════════════════════════════════════════
-- 서버를 나누는 순간 「도메인 커밋 = 이벤트 발생」이 공짜로 성립하지 않는다. Data API 가 커밋한 직후
-- 응답이 유실되거나 프로세스가 죽으면 도메인 상태만 바뀌고 이벤트는 아예 생기지 않는다(A21).
-- 그래서 명령 트랜잭션이 «같은 트랜잭션에서» 봉투를 이 테이블에 적고, 발행은 그 행을 읽어서 한다.
--
-- 테이블 넷이 각각 다른 실패를 막는다:
--   event_outbox             — 봉투 자체(불변). 커밋과 함께 남는다.
--   event_outbox_deliveries  — 대상(Kafka·Link·Noti)별 전달 상태. 실패가 «남은 대상만» 재시도한다.
--   aggregate_versions       — 순서용 version 을 aggregate 행 잠금 아래 발급한다(㊸).
--   command_idempotency      — 첫 응답이 유실된 재시도에 «같은 봉투»를 재생한다(㊼ · A21).
--
-- ⚠️ 이 마이그레이션은 스키마만 만든다. relay 는 설정이 없으면 꺼져 있고(기본값 disabled),
--    A18(발행 실패 정책)이 보류라 «고갈 시 행을 없애는» 처리는 일부러 넣지 않았다.

-- ── ① 봉투 ────────────────────────────────────────────────────────────
-- 정본 봉투(서비스 §「이벤트」): eventId · schemaVersion · type · occurredAt · scheduledAt ·
-- userId · locale · subjectId · version · params.
--
-- subject_id 가 uuid 가 아니라 varchar 인 이유: 정본이 요구하는 subjectId 는 sessionId 처럼 uuid 인
-- 경우가 대부분이지만, 링크 멤버십 전이처럼 «(groupId, inviterId)» 복합 키를 정규 문자열로 싣는
-- 자리도 있다. uuid 로 못 박으면 그 축을 표현할 수 없어 ㋥ 의 전이 순서가 봉투 밖으로 샌다.
--
-- aggregate_type/aggregate_id 는 «version 을 발급한 aggregate» 다. 이 값은 곧 relay 의 순서 축이기도
-- 하다 — 순서와 version 이 다른 축을 쓰면 「선행 미전달을 건너뛰지 않는다」가 성립하지 않는다.
-- 유저 축은 (USER, userId), 링크 멤버십 전이는 (LINK_MEMBERSHIP, "<groupId>:<inviterId>") 다.
CREATE TABLE public.event_outbox (
    id               uuid                        NOT NULL,
    -- 결정적 사건 키. fan-out 은 «<사건키>:<userId>» 로 수신자마다 다른 값을 갖는다(㊢).
    -- 소비 측 dedup 의 유일한 근거라 UNIQUE 다 — 같은 키의 재기록은 애초에 만들 수 없다.
    event_id         character varying(200)      NOT NULL,
    -- 스키마 호환용. 순서용 version 과 «다른 값»이며 둘 다 필수다(ⓦ).
    schema_version   integer                     NOT NULL,
    type             character varying(100)      NOT NULL,
    occurred_at      timestamp(6) with time zone NOT NULL,
    -- 예약 발송 사건의 발송 예정 시각. 즉시 사건은 NULL.
    scheduled_at     timestamp(6) with time zone,
    user_id          uuid                        NOT NULL,
    -- 렌더 로케일. 미보고 유저는 NULL 로 남기고 수신 측이 ko 로 폴백한다 — 여기서 ko 를 박으면
    -- 「보고받은 ko」와 「모름」이 구분되지 않아 나중에 언어 보고가 붙어도 고칠 수 없다.
    locale           character varying(35),
    subject_id       character varying(200),
    aggregate_type   character varying(60)       NOT NULL,
    aggregate_id     character varying(200)      NOT NULL,
    -- aggregate 행 잠금 아래 발급된 단조 증가 값(㊸). 시퀀스를 그대로 쓰면 할당 순서와 커밋 순서가
    -- 어긋나 «나중에 커밋된 최신 상태»가 소비자에게 폐기된다.
    version          bigint                      NOT NULL,
    params           jsonb                       NOT NULL,
    created_at       timestamp(6) with time zone NOT NULL,
    CONSTRAINT event_outbox_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX uq_event_outbox_event_id ON public.event_outbox (event_id);

-- 같은 aggregate 에서 같은 version 이 두 번 나오면 순서 판정이 무너진다 — 발급 경로의 버그를
-- 「조용한 중복」이 아니라 즉시 실패로 드러낸다.
CREATE UNIQUE INDEX uq_event_outbox_aggregate_version
    ON public.event_outbox (aggregate_type, aggregate_id, version);

-- ── ② 대상별 전달 상태 ────────────────────────────────────────────────
-- 표시가 단일 published_at 이 아니라 «대상별»인 이유(A21): 링크 서버는 Kafka 를 소비하지 않으므로
-- 같은 사건이 Kafka 로도 가고 HTTP 로도 간다. 하나로 합치면 한쪽만 실패했을 때 성공한 쪽까지
-- 재전달되거나(중복) 실패한 쪽이 영영 안 간다(유실).
--
-- aggregate_* 3컬럼은 봉투에서 «복제»한 값이다. 정규화를 깨는 대신 얻는 것: 선행 미전달 검사
-- (NOT EXISTS)가 이 테이블 안의 부분 인덱스 하나로 끝난다. 봉투는 불변이라 복제본이 낡을 수 없다.
CREATE TABLE public.event_outbox_deliveries (
    id              uuid                        NOT NULL,
    outbox_id       uuid                        NOT NULL,
    -- KAFKA · LINK · NOTI. 대상이 늘면 여기에 값이 는다.
    target          character varying(20)       NOT NULL
        CONSTRAINT event_outbox_deliveries_target_check
            CHECK ((target)::text = ANY ((ARRAY[
                'KAFKA'::character varying,
                'LINK'::character varying,
                'NOTI'::character varying])::text[])),
    aggregate_type  character varying(60)       NOT NULL,
    aggregate_id    character varying(200)      NOT NULL,
    aggregate_version bigint                    NOT NULL,
    -- 이 대상에 실제로 보낼 본문. Kafka 는 봉투 그대로, HTTP 대상은 그 명령의 본문이다
    -- (링크 폐기의 linkVersion·membershipEpoch 처럼 대상에만 필요한 값이 여기 들어간다, ⓑ″).
    payload         jsonb                       NOT NULL,
    -- HTTP 대상의 «논리 엔드포인트 키». 설정된 허용목록에서 URL·method·caller 토큰을 찾는 열쇠다.
    -- ⚠️ 여기에 URL 을 담지 않는다 — payload 가 목적지를 고를 수 있으면 그 자체가 SSRF 구조다.
    endpoint_key    character varying(80),
    delivered_at    timestamp(6) with time zone,
    attempt_count   integer                     NOT NULL,
    last_attempt_at timestamp(6) with time zone,
    last_error      text,
    next_attempt_at timestamp(6) with time zone NOT NULL,
    -- 선점 리스. lease_token 이 «펜싱 토큰»이다 — 리스가 만료돼 남이 재클레임한 뒤 옛 워커가
    -- 뒤늦게 완료를 보고하면 토큰이 달라 0행이 갱신된다(낡은 완료 표시 거부).
    lease_owner     character varying(80),
    lease_token     uuid,
    lease_expires_at timestamp(6) with time zone,
    created_at      timestamp(6) with time zone NOT NULL,
    CONSTRAINT event_outbox_deliveries_pkey PRIMARY KEY (id),
    CONSTRAINT fk_event_outbox_deliveries_outbox
        FOREIGN KEY (outbox_id) REFERENCES public.event_outbox (id) ON DELETE CASCADE
);

-- 한 봉투에 같은 대상 행이 둘이면 그 대상이 두 번 전달된다.
CREATE UNIQUE INDEX uq_event_outbox_deliveries_outbox_target
    ON public.event_outbox_deliveries (outbox_id, target);

-- 미전달 스캔 — 전달 완료가 대다수가 되므로 부분 인덱스로 좁힌다.
CREATE INDEX idx_event_outbox_deliveries_pending
    ON public.event_outbox_deliveries (target, next_attempt_at, lease_expires_at)
    WHERE delivered_at IS NULL;

-- 「같은 순서 축의 선행 미전달이 있는가」(NOT EXISTS) 전용. 이 인덱스가 없으면 relay 가
-- 매 틱 전체 미전달을 훑는다.
CREATE INDEX idx_event_outbox_deliveries_ordering
    ON public.event_outbox_deliveries (target, aggregate_type, aggregate_id, aggregate_version)
    WHERE delivered_at IS NULL;

-- ── ③ aggregate 순서 version 발급구 ───────────────────────────────────
-- 시퀀스를 쓰지 않는 이유는 ㊸ 에 있다: 시퀀스는 «번호 할당 순서»만 보장하고 «커밋 순서»를 보장하지
-- 않는다. 같은 유저의 T1 이 10 을 받고 멈춘 사이 T2 가 11 을 커밋·발행한 뒤 T1 이 마지막에 커밋하면
-- DB 최종 상태는 T1 인데 소비자는 최대값 11 때문에 이벤트 10 을 폐기한다.
-- 이 테이블의 행을 «잠근 채» 번호를 올리면 같은 aggregate 의 두 트랜잭션이 겹치지 않는다 —
-- 즉 번호 순서가 곧 커밋 순서가 된다. (users 에는 @Version 도 없어 기존 낙관락이 이 경합을 못 막는다.)
CREATE TABLE public.aggregate_versions (
    aggregate_type character varying(60)       NOT NULL,
    aggregate_id   character varying(200)      NOT NULL,
    -- 마지막으로 «발급한» 값. 다음 발급은 이 값 + 1 이다.
    last_version   bigint                      NOT NULL,
    updated_at     timestamp(6) with time zone NOT NULL,
    CONSTRAINT aggregate_versions_pkey PRIMARY KEY (aggregate_type, aggregate_id)
);

-- ── ④ 명령 멱등 ──────────────────────────────────────────────────────
-- 멱등 키의 소유자는 «앱»이다(A21 · ㊼). eventId 는 결정적이지만 호출자는 첫 응답을 받기 전엔 그
-- 값을 모르므로, 커밋 직후 응답이 유실돼 같은 POST 가 다시 오면 두 번째 트랜잭션이 새 도메인 객체와
-- 새 outbox 행을 만든다. 그래서 키를 요청에 싣고 결과를 여기 UNIQUE 로 저장해 재시도에 «저장된
-- 응답»을 그대로 재생한다 — 그 응답에 eventId·version 이 들어 있으므로 재시도도 같은 봉투를 얻는다.
--
-- request_fingerprint 는 «영구 멱등키»가 아니다(계약 §3 이 본문 해시를 키로 쓰는 것을 금지한다).
-- 같은 키로 «다른 본문»이 오는 것을 거부하기 위한 검사값일 뿐이다 — 키를 재사용한 별개 명령이
-- 남의 응답을 재생받는 사고를 막는다.
CREATE TABLE public.command_idempotency (
    idempotency_key     character varying(200)      NOT NULL,
    user_id             uuid                        NOT NULL,
    command_type        character varying(100)      NOT NULL,
    request_fingerprint character varying(64)       NOT NULL,
    -- 재생할 응답. 명령 트랜잭션과 같은 트랜잭션에서 채워지므로 «커밋된 행 = 응답 있음» 이다.
    response_body       jsonb,
    created_at          timestamp(6) with time zone NOT NULL,
    CONSTRAINT command_idempotency_pkey PRIMARY KEY (idempotency_key)
);
