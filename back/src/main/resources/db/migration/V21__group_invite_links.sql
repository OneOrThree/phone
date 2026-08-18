-- ════════════════════════════════════════════════════════════════════
-- 그룹 초대 링크 — 링크 원장 + 클릭/매치/claim 상태
-- ════════════════════════════════════════════════════════════════════
-- deferred deep link 퍼널의 진실원본이다. GA4 는 분석 레이어일 뿐이고,
-- "어떤 링크가 누구를 데려왔나" 의 정답은 이 두 테이블이 가진다.

-- 초대 링크 원장: slug → (그룹, 초대자). (그룹, 초대자)당 1링크를 재사용한다(멱등 발급).
CREATE TABLE public.group_invite_links (
    id          uuid PRIMARY KEY,
    -- 생성 규칙은 8자(혼동 문자 제외 알파벳)지만 규칙 변경 여지를 두고 컬럼은 12로 잡는다.
    slug        character varying(12) NOT NULL UNIQUE,
    group_id    uuid NOT NULL REFERENCES public.groups (id),
    inviter_id  uuid NOT NULL REFERENCES public.users (id),
    created_at  timestamp(6) with time zone NOT NULL DEFAULT now(),
    updated_at  timestamp(6) with time zone NOT NULL DEFAULT now(),
    -- 멱등 발급의 최후 방어선(동시 발급 레이스 포함)
    CONSTRAINT uq_invite_links_group_inviter UNIQUE (group_id, inviter_id)
);

-- 클릭 + 매치 + claim 상태. 별도 install 테이블 없이 클릭 행 하나가 상태 전이를 전부 가진다
-- (클릭 → 매치(설치 기기 연결) → claim(유저 연결)).
CREATE TABLE public.invite_link_clicks (
    id                uuid PRIMARY KEY,
    link_id           uuid NOT NULL REFERENCES public.group_invite_links (id),
    -- SHA-256(ip + LINK_IP_SALT) hex 64자. 원본 IP 는 어디에도 저장하지 않는다.
    ip_hash           character varying(64) NOT NULL,
    os                character varying(16) NOT NULL,   -- 'ios' | 'android' | 'other'
    user_agent        character varying(512),
    clicked_at        timestamp(6) with time zone NOT NULL DEFAULT now(),
    matched           boolean NOT NULL DEFAULT FALSE,
    matched_at        timestamp(6) with time zone,
    matched_device_id character varying(64),            -- 앱 자체 device_id
    app_instance_id   character varying(64),            -- GA4 앱스트림 결합용
    claimed_user_id   uuid REFERENCES public.users (id),
    claimed_at        timestamp(6) with time zone
);

-- 매치 검색 전용 부분 인덱스 — 소진된 클릭은 다시 검색되지 않으므로 인덱스에서도 제외한다.
CREATE INDEX idx_invite_clicks_match
    ON public.invite_link_clicks (ip_hash, os, clicked_at DESC)
    WHERE matched = FALSE;

CREATE INDEX idx_invite_clicks_link ON public.invite_link_clicks (link_id);

-- 매치 재시도 멱등(기기별 기존 매치 조회) 전용 — /l/match 는 호출마다 이 조회를 먼저 탄다.
CREATE INDEX idx_invite_clicks_device
    ON public.invite_link_clicks (matched_device_id, matched_at DESC)
    WHERE matched = TRUE;
