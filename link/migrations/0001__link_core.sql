-- ════════════════════════════════════════════════════════════════════
-- 링크 서비스 원장 — 링크 · 클릭 · 멤버십 전이 · claim
-- ════════════════════════════════════════════════════════════════════
-- 이 DB(Neon)에는 «코어 FK 가 없다». group_id · inviter_id · user_id 는 전부
-- 코어(gromo DB)의 값이지만 참조 무결성을 걸 수 없다 — 링크 서버는 코어를 못 읽는다
-- (정본 service-architecture.md §3 단방향 규칙). 그래서 코어가 보장해 주던 것들을
-- 이 파일의 제약·인덱스와 저장소 트랜잭션이 직접 떠받친다.

-- gen_random_uuid() 용. Neon·PostgreSQL 13+ 는 기본 제공하지만 명시해 둔다.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 멤버십 전이 원장 ────────────────────────────────────────────────
-- (groupId, inviterId) 한 쌍의 «세대»와 «명령 순서»를 따로 가진다.
--
--   epoch          = 탈퇴·강퇴·재가입 때만 증가하는 멤버십 세대(A22 ⓚ).
--                    일반 낙관락 version 을 쓰면 첫 가입이 버전을 올려
--                    재사용 링크의 이후 수신자가 전부 실패한다.
--   transition_seq = 코어가 멤버십 전이 트랜잭션에서 발급한 단조 순서(A22 ㋥).
--                    같은 outbox 라도 HTTP 적용 순서는 보장되지 않고, A21 직렬화는
--                    userId 축인데 claim 사용자와 발급자는 다른 사람이다.
--
-- 이 표가 tombstone 이다 — 행이 있다는 것 자체가 「이 쌍에 대해 최소 이 세대까지
-- 관측했다」는 뜻이고, 그보다 낡은 issue/revoke/confirm 은 전부 거부된다(A22 ㊊).
CREATE TABLE membership_epochs (
    group_id       uuid   NOT NULL,
    inviter_id     uuid   NOT NULL,
    epoch          bigint NOT NULL,
    transition_seq bigint NOT NULL,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, inviter_id),
    CONSTRAINT ck_membership_epoch_nonneg CHECK (epoch >= 0 AND transition_seq >= 0)
);

-- ── 링크 원장 ───────────────────────────────────────────────────────
CREATE TABLE links (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 기존 slug 를 그대로 이관한다. 생성 규칙은 8자(혼동 문자 제외 31자 알파벳)지만
    -- 구 스키마(V21)와 같이 12 로 잡아 규칙 변경 여지를 남긴다.
    slug             varchar(12) NOT NULL UNIQUE,
    group_id         uuid NOT NULL,
    inviter_id       uuid NOT NULL,

    -- 발급 당시의 멤버십 세대. revoke 는 slug 가 아니라 이 값으로 대상을 지목한다
    -- (A22 ⓑ″·㋑ — 구 테이블 제거 후 Data 는 slug 를 모른다).
    link_version     bigint NOT NULL,

    status           text NOT NULL DEFAULT 'ACTIVE',
    revoked_at       timestamptz,
    revoke_reason    text,

    -- 표시정보 스냅샷(A22 ㋡). 구 구현은 랜딩마다 코어에서 그룹명·닉네임을 조회했다 —
    -- 링크 서버는 못 부르므로 발급 시 동봉받고 변경 이벤트로 갱신한다.
    group_name       text NOT NULL,
    inviter_name     text,
    -- 스냅샷 전용 단조 버전. 멤버십 epoch 와 «분리»한다 — 이름이 바뀔 때마다 epoch 가
    -- 올라가면 공유된 활성 slug 의 반복 사용이 깨진다.
    snapshot_version bigint NOT NULL DEFAULT 0,

    -- 그룹 삭제·종료(A22 ㋢). 구 구현은 랜딩·매치 양쪽이 findActiveGroup 으로 실시간
    -- 판정했다 — 안 받으면 죽은 그룹 slug 가 계속 성공한다.
    group_closed     boolean NOT NULL DEFAULT false,
    group_closed_at  timestamptz,

    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_links_status CHECK (status IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT ck_links_revoked_at CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

-- 멱등 발급의 최후 방어선 — «활성» 링크만 (그룹, 초대자)당 1개다.
-- 구 스키마는 무조건 UNIQUE 였지만 여기엔 폐기 상태가 있어, 재가입 후 재발급이
-- 폐기된 옛 링크와 충돌하면 안 된다(partial unique).
CREATE UNIQUE INDEX uq_links_active_group_inviter
    ON links (group_id, inviter_id) WHERE status = 'ACTIVE';

CREATE INDEX idx_links_group_inviter ON links (group_id, inviter_id);
CREATE INDEX idx_links_inviter ON links (inviter_id);

-- ── 클릭 + 매치 + claim 상태 ────────────────────────────────────────
-- 구 invite_link_clicks 와 같은 상태 기계다(클릭 → 매치 → claim). 한 행이 전이를
-- 전부 가지므로 매치 소진이 곧 이 행의 UPDATE 이고 원자성 확보가 단순하다.
CREATE TABLE link_clicks (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id           uuid NOT NULL REFERENCES links (id),
    -- SHA-256(UTF8(ip + LINK_IP_SALT)) hex 64자. 원본 IP 는 어디에도 저장하지 않는다.
    -- salt 를 바꾸면 기존 해시와 대조가 불가능해져 진행 중이던 매치가 전멸한다.
    ip_hash           char(64) NOT NULL,
    os                varchar(16) NOT NULL,  -- 'ios' | 'android' | 'other'
    user_agent        varchar(512),
    clicked_at        timestamptz NOT NULL DEFAULT now(),

    matched           boolean NOT NULL DEFAULT false,
    matched_at        timestamptz,
    matched_device_id varchar(64),
    app_instance_id   varchar(64),

    -- 잠정 귀속(A22 ㋟). 「유효」 판정은 Data 의 멤버십 락 아래 남긴 확정 레코드가
    -- 와야 성립하므로, 이 컬럼만으로 보상·전환을 집계하지 않는다.
    claimed_user_id   uuid,
    claimed_at        timestamptz,
    claim_id          uuid,

    -- 이관 추적(§7.2). 구 invite_link_clicks.id 를 보존해 백필·호환 소진이
    -- 같은 행을 두 번 만들지 않게 한다.
    legacy_click_id   uuid UNIQUE,

    CONSTRAINT ck_clicks_matched CHECK ((matched) = (matched_at IS NOT NULL)),
    CONSTRAINT ck_clicks_claimed CHECK ((claimed_user_id IS NOT NULL) <= (claimed_at IS NOT NULL))
);

-- 매치 검색 전용 부분 인덱스 — 소진된 클릭은 다시 검색되지 않으므로 인덱스에서도 뺀다.
CREATE INDEX idx_clicks_match
    ON link_clicks (ip_hash, os, clicked_at DESC)
    WHERE matched = false;

CREATE INDEX idx_clicks_link ON link_clicks (link_id);

-- 매치 재시도 멱등(기기별 기존 매치 조회) — /l/match 는 호출마다 이 조회를 먼저 탄다.
CREATE INDEX idx_clicks_device
    ON link_clicks (matched_device_id, matched_at DESC)
    WHERE matched = true;

-- claim 후보 조회(매치까지 갔고 아직 유저가 안 붙은 행).
CREATE INDEX idx_clicks_claimable
    ON link_clicks (link_id, matched_at DESC)
    WHERE matched = true AND claimed_user_id IS NULL;

-- ── claim 원장 — 잠정 기록 + 불변 확정 근거 ─────────────────────────
-- A22 ㋟: 링크는 «잠정» 기록만 하고, Data 가 멤버십 락 아래 남긴 확정 레코드가
-- `link.claimConfirmed` relay 로 와야 유효해진다. ㋙: 폐기는 그 사이 수락된
-- claim 까지 되돌린다(relay 지연 중 링크는 active 로 보여 claim 을 기록한다).
CREATE TABLE link_claims (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id                uuid NOT NULL REFERENCES links (id),
    slug                   varchar(12) NOT NULL,
    group_id               uuid NOT NULL,
    inviter_id             uuid NOT NULL,
    -- 탈퇴 시 NULL 로 익명화된다(A22 ⓐ). 확정 근거(confirm_proof)는 건드리지 않는다.
    claimed_user_id        uuid,
    click_id               uuid REFERENCES link_clicks (id),

    status                 text NOT NULL DEFAULT 'PENDING',
    -- claim 기록 시점에 링크가 갖고 있던 세대. 확정·폐기의 대조 축이다.
    membership_epoch       bigint NOT NULL,

    created_at             timestamptz NOT NULL DEFAULT now(),

    -- 불변 확정 근거. 한 번 쓰이면 rewrite 금지(아래 트리거가 강제한다).
    -- 사용자 식별자는 여기 담지 않는다 — 탈퇴 익명화가 근거를 고쳐 쓰게 되기 때문이다.
    -- 대신 claimed_user_id 컬럼이 신원을 갖고, 근거에는 되돌릴 수 없는 subject_hash 만 둔다.
    confirm_proof          jsonb,
    confirmed_at           timestamptz,
    confirm_transition_seq bigint,

    revoked_at             timestamptz,
    anonymized_at          timestamptz,

    -- LEGACY = 구 invite_link_clicks.claimed_user_id 를 이관한 «근거만» 있는 귀속이다.
    -- 구 운영은 가입 검증 없이 이 값을 찍었으므로 확정(CONFIRMED)으로 올리면 멤버십·보상 자격을
    -- 날조하게 된다. 유효 집계는 CONFIRMED 기준이라 LEGACY 는 아무 자격도 만들지 않고,
    -- Data 가 멤버십 락 아래 만든 확정 근거를 보내면 그때 CONFIRMED 로 승격된다(A22 ㋟).
    CONSTRAINT ck_claims_status CHECK (status IN ('PENDING', 'CONFIRMED', 'REVOKED', 'ANONYMIZED', 'LEGACY')),
    CONSTRAINT ck_claims_confirm CHECK ((confirm_proof IS NOT NULL) = (confirmed_at IS NOT NULL))
);

-- 한 링크에서 한 유저는 한 번만 claim 한다(구 InviteLinkClick.claim 의 「최초 1회」).
CREATE UNIQUE INDEX uq_claims_link_user
    ON link_claims (link_id, claimed_user_id) WHERE claimed_user_id IS NOT NULL;

CREATE INDEX idx_claims_link_status ON link_claims (link_id, status);
CREATE INDEX idx_claims_group_inviter ON link_claims (group_id, inviter_id);

-- 확정 근거 불변 강제. 애플리케이션 코드의 UPDATE … WHERE confirm_proof IS NULL 만으로는
-- 새 호출부 하나가 조용히 계약을 깬다 — 「유효 claim 확정의 증거를 rewrite 하지 않는다」는
-- DB 가 지킨다. 익명화(claimed_user_id → NULL)는 근거를 안 건드리므로 통과한다.
CREATE OR REPLACE FUNCTION link_claims_proof_is_immutable() RETURNS trigger AS $$
BEGIN
    IF OLD.confirm_proof IS NOT NULL
       AND (NEW.confirm_proof IS DISTINCT FROM OLD.confirm_proof
            OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
            OR NEW.confirm_transition_seq IS DISTINCT FROM OLD.confirm_transition_seq) THEN
        RAISE EXCEPTION 'link_claims.confirm_proof 는 불변입니다 (claimId=%)', OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_link_claims_proof_immutable
    BEFORE UPDATE ON link_claims
    FOR EACH ROW EXECUTE FUNCTION link_claims_proof_is_immutable();

-- ── 탈퇴 tombstone ──────────────────────────────────────────────────
-- 위성 쓰기 전 활성 검사와 이 표가 함께 「탈퇴 경합」을 막는다(정본 §5). tombstone 은
-- «이후» 쓰기만 막으므로, withdraw 는 기존 claimed_user_id 익명화를 같은 TX 에서 한다(A22 ⓐ).
CREATE TABLE user_tombstones (
    user_id        uuid PRIMARY KEY,
    withdrawn_at   timestamptz NOT NULL DEFAULT now(),
    transition_seq bigint,
    anonymized_claims  integer NOT NULL DEFAULT 0,
    anonymized_clicks  integer NOT NULL DEFAULT 0
);

-- ── 명령 멱등 ───────────────────────────────────────────────────────
-- A22 ㊞·㉼: 멱등 키는 호출자(앱/Business)가 소유한다. 요청 본문 해시를 «영구» 멱등키로
-- 쓰지 않는다 — 같은 설정의 정상 재요청이 접힌다. 대신 같은 키에 다른 본문이 오면 409 다.
CREATE TABLE idempotency_results (
    scope        text NOT NULL,
    key          text NOT NULL,
    request_hash text NOT NULL,
    status_code  integer NOT NULL,
    response     jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, key)
);

-- ── claim 내구 큐 ───────────────────────────────────────────────────
-- A22 ㊺: 구 앱의 claim 타임아웃은 15초이고 실패하면 다음 로그인까지 재시도가 없다.
-- 정지 창에서 예산을 넘길 위험이 있으면 202 로 받되, «이 표에 커밋한 뒤에만» 202 다.
CREATE TABLE claim_queue (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            varchar(12) NOT NULL,
    user_id         uuid NOT NULL,
    idempotency_key text,
    state           text NOT NULL DEFAULT 'QUEUED',
    attempts        integer NOT NULL DEFAULT 0,
    lease_until     timestamptz,
    received_at     timestamptz NOT NULL DEFAULT now(),
    applied_at      timestamptz,
    last_error      text,
    CONSTRAINT ck_claim_queue_state CHECK (state IN ('QUEUED', 'APPLIED', 'FAILED'))
);

CREATE INDEX idx_claim_queue_pending ON claim_queue (received_at) WHERE state = 'QUEUED';
