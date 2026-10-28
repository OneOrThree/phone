-- Catus 현행 스키마 V0 (V138 기준). 기존 DB는 docs/db/rebase-v0.py로 검증·백업 후 전환한다.
-- 기본 데이터는 db/seed/insert.sql → afterMigrate__defaults.sql 콜백이 담당한다.
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: focus_settlements_mirror_accrual(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.focus_settlements_mirror_accrual() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.earned_fish > 0 AND NOT EXISTS (
            SELECT 1 FROM focus_reward_accruals a WHERE a.session_id = NEW.session_id) THEN
        INSERT INTO focus_reward_accruals (id, session_id, accrued_on, earned_fish)
        VALUES (gen_random_uuid(), NEW.session_id,
                (NEW.completed_at AT TIME ZONE 'UTC')::date, NEW.earned_fish)
        ON CONFLICT (session_id, accrued_on) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: aggregate_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aggregate_versions (
    aggregate_type character varying(60) NOT NULL,
    aggregate_id character varying(200) NOT NULL,
    last_version bigint NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL
);


--
-- Name: audio_tracks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audio_tracks (
    product_id character varying(80) NOT NULL,
    duration_millis integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audio_tracks_duration_millis_check CHECK ((duration_millis > 0))
);


--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    refresh_token_hash character varying(64),
    bootstrap_nonce_hash character varying(64),
    session_epoch bigint NOT NULL,
    revoked_at timestamp(6) with time zone,
    revoke_reason character varying(30),
    created_at timestamp(6) with time zone NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    logout_refresh_expires_at timestamp(6) with time zone
);


--
-- Name: catalog_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_assets (
    product_id character varying(80) NOT NULL,
    title character varying(120) NOT NULL,
    kind character varying(20) NOT NULL,
    owner_type character varying(10) NOT NULL,
    target_building character varying(30),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_assets_kind_check CHECK (((kind)::text = ANY ((ARRAY['clothes'::character varying, 'decor'::character varying, 'island_theme'::character varying, 'building_theme'::character varying, 'audio'::character varying, 'ad_frame'::character varying, 'ad_sticker'::character varying, 'ad_tape'::character varying, 'head'::character varying, 'neck'::character varying, 'shoes'::character varying])::text[]))),
    CONSTRAINT catalog_assets_kind_owner_check CHECK (((((kind)::text = ANY ((ARRAY['clothes'::character varying, 'decor'::character varying, 'ad_frame'::character varying, 'ad_sticker'::character varying, 'ad_tape'::character varying, 'head'::character varying, 'neck'::character varying, 'shoes'::character varying])::text[])) AND ((owner_type)::text = 'user'::text)) OR (((kind)::text = ANY ((ARRAY['island_theme'::character varying, 'building_theme'::character varying, 'audio'::character varying])::text[])) AND ((owner_type)::text = 'island'::text)))),
    CONSTRAINT catalog_assets_owner_type_check CHECK (((owner_type)::text = ANY ((ARRAY['user'::character varying, 'island'::character varying])::text[]))),
    CONSTRAINT catalog_assets_target_building_check CHECK ((((kind)::text = 'building_theme'::text) = (target_building IS NOT NULL)))
);


--
-- Name: command_idempotency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.command_idempotency (
    idempotency_key character varying(200) NOT NULL,
    user_id uuid NOT NULL,
    command_type character varying(100) NOT NULL,
    request_fingerprint character varying(64) NOT NULL,
    response_body jsonb,
    created_at timestamp(6) with time zone NOT NULL
);


--
-- Name: construction_cost_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.construction_cost_policies (
    revision integer NOT NULL,
    building_id character varying(30) NOT NULL,
    cost integer NOT NULL,
    build_seconds integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT construction_cost_policies_build_seconds_check CHECK ((build_seconds >= 0)),
    CONSTRAINT construction_cost_policies_cost_check CHECK ((cost >= 0))
);


--
-- Name: TABLE construction_cost_policies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.construction_cost_policies IS '불변 건설 비용 revision — 정책 C10. 「건설 가격·공사 시간」표(D4)가 revision 1';


--
-- Name: construction_cost_policy_publication; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.construction_cost_policy_publication (
    singleton boolean DEFAULT true NOT NULL,
    revision integer NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT construction_cost_policy_publication_singleton_check CHECK (singleton)
);


--
-- Name: construction_guide_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.construction_guide_recipients (
    island_id uuid NOT NULL,
    building_id character varying(30) NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: customization_asset_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customization_asset_meta (
    product_id character varying(80) NOT NULL,
    kind character varying(20) NOT NULL,
    slot character varying(10) NOT NULL,
    image_path character varying(200) NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    anchor_x numeric(5,4) NOT NULL,
    anchor_y numeric(5,4) NOT NULL,
    sort_order integer NOT NULL,
    retired_at timestamp with time zone,
    CONSTRAINT customization_asset_meta_anchor_check CHECK ((((anchor_x >= (0)::numeric) AND (anchor_x <= (1)::numeric)) AND ((anchor_y >= (0)::numeric) AND (anchor_y <= (1)::numeric)))),
    CONSTRAINT customization_asset_meta_height_check CHECK ((height > 0)),
    CONSTRAINT customization_asset_meta_kind_check CHECK (((kind)::text = ANY ((ARRAY['clothes'::character varying, 'decor'::character varying, 'head'::character varying, 'neck'::character varying, 'shoes'::character varying])::text[]))),
    CONSTRAINT customization_asset_meta_slot_check CHECK (((slot)::text = ANY ((ARRAY['clothes'::character varying, 'decor'::character varying, 'head'::character varying, 'neck'::character varying, 'shoes'::character varying])::text[]))),
    CONSTRAINT customization_asset_meta_slot_kind_check CHECK (((slot)::text = (kind)::text)),
    CONSTRAINT customization_asset_meta_width_check CHECK ((width > 0))
);


--
-- Name: customization_reward_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customization_reward_items (
    revision integer NOT NULL,
    product_id character varying(80) NOT NULL,
    source_asset_id character varying(80) NOT NULL,
    category character varying(10) NOT NULL,
    rarity character varying(10) NOT NULL,
    rarity_reason character varying(200) NOT NULL,
    render_data jsonb NOT NULL,
    sort_order integer NOT NULL,
    CONSTRAINT customization_reward_items_category_check CHECK (((category)::text = ANY ((ARRAY['head'::character varying, 'neck'::character varying, 'shoes'::character varying, 'flag'::character varying, 'mat'::character varying, 'oar'::character varying, 'cargo'::character varying, 'lantern'::character varying, 'canopy'::character varying])::text[]))),
    CONSTRAINT customization_reward_items_rarity_check CHECK (((rarity)::text = ANY ((ARRAY['common'::character varying, 'uncommon'::character varying, 'rare'::character varying, 'legendary'::character varying])::text[]))),
    CONSTRAINT customization_reward_items_render_data_check CHECK ((jsonb_typeof(render_data) = 'object'::text)),
    CONSTRAINT customization_reward_items_sort_order_check CHECK ((sort_order >= 0))
);


--
-- Name: customization_reward_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customization_reward_policies (
    revision integer NOT NULL,
    minimum_active_seconds integer NOT NULL,
    rare_unlock_seconds integer NOT NULL,
    legendary_unlock_seconds integer NOT NULL,
    time_half_seconds integer NOT NULL,
    rare_max_bonus_ppm integer NOT NULL,
    legendary_max_bonus_ppm integer NOT NULL,
    rewards_per_eligible_session integer NOT NULL,
    duplicates_allowed boolean NOT NULL,
    location_weights jsonb NOT NULL,
    category_weights jsonb NOT NULL,
    source_workbook_sha256 character(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customization_reward_policie_rewards_per_eligible_session_check CHECK ((rewards_per_eligible_session = 1)),
    CONSTRAINT customization_reward_policies_category_weights_check CHECK ((jsonb_typeof(category_weights) = 'object'::text)),
    CONSTRAINT customization_reward_policies_duplicates_allowed_check CHECK (duplicates_allowed),
    CONSTRAINT customization_reward_policies_legendary_max_bonus_ppm_check CHECK (((legendary_max_bonus_ppm >= 0) AND (legendary_max_bonus_ppm <= 1000000))),
    CONSTRAINT customization_reward_policies_location_weights_check CHECK ((jsonb_typeof(location_weights) = 'object'::text)),
    CONSTRAINT customization_reward_policies_minimum_active_seconds_check CHECK ((minimum_active_seconds > 0)),
    CONSTRAINT customization_reward_policies_rare_max_bonus_ppm_check CHECK (((rare_max_bonus_ppm >= 0) AND (rare_max_bonus_ppm <= 1000000))),
    CONSTRAINT customization_reward_policies_revision_check CHECK ((revision > 0)),
    CONSTRAINT customization_reward_policies_time_half_seconds_check CHECK ((time_half_seconds > 0)),
    CONSTRAINT customization_reward_unlock_order CHECK (((minimum_active_seconds <= rare_unlock_seconds) AND (rare_unlock_seconds <= legendary_unlock_seconds)))
);


--
-- Name: daily_focus_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_focus_stats (
    id uuid NOT NULL,
    date date NOT NULL,
    is_focus_time_goal_achieved boolean NOT NULL,
    session_count integer NOT NULL,
    total_focus_seconds integer NOT NULL,
    updated_at timestamp(6) with time zone,
    user_id uuid,
    total_distraction_seconds integer DEFAULT 0 NOT NULL
);


--
-- Name: event_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_outbox (
    id uuid NOT NULL,
    event_id character varying(200) NOT NULL,
    schema_version integer NOT NULL,
    type character varying(100) NOT NULL,
    occurred_at timestamp(6) with time zone NOT NULL,
    scheduled_at timestamp(6) with time zone,
    user_id uuid NOT NULL,
    locale character varying(35),
    subject_id character varying(200),
    aggregate_type character varying(60) NOT NULL,
    aggregate_id character varying(200) NOT NULL,
    version bigint NOT NULL,
    params jsonb NOT NULL,
    created_at timestamp(6) with time zone NOT NULL
);


--
-- Name: event_outbox_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_outbox_deliveries (
    id uuid NOT NULL,
    outbox_id uuid NOT NULL,
    target character varying(20) NOT NULL,
    aggregate_type character varying(60) NOT NULL,
    aggregate_id character varying(200) NOT NULL,
    aggregate_version bigint NOT NULL,
    payload jsonb NOT NULL,
    endpoint_key character varying(80),
    delivered_at timestamp(6) with time zone,
    attempt_count integer NOT NULL,
    last_attempt_at timestamp(6) with time zone,
    last_error text,
    next_attempt_at timestamp(6) with time zone NOT NULL,
    lease_owner character varying(80),
    lease_token uuid,
    lease_expires_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone NOT NULL,
    CONSTRAINT event_outbox_deliveries_target_check CHECK (((target)::text = ANY ((ARRAY['KAFKA'::character varying, 'NOTI'::character varying, 'REALTIME'::character varying, 'SCORE'::character varying])::text[])))
);


--
-- Name: focus_live_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.focus_live_activities (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    activity_id character varying(128) NOT NULL,
    push_token character varying(1024) NOT NULL,
    environment character varying(16) NOT NULL,
    cat_color character varying(16) NOT NULL,
    sent_version bigint NOT NULL,
    sent_timestamp bigint NOT NULL,
    next_attempt_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT focus_live_activities_environment_check CHECK (((environment)::text = ANY ((ARRAY['development'::character varying, 'production'::character varying, 'android'::character varying])::text[])))
);


--
-- Name: focus_reward_accruals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.focus_reward_accruals (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    accrued_on date NOT NULL,
    earned_fish integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    golden_fish integer DEFAULT 0 NOT NULL,
    tutorial_fish integer DEFAULT 0 NOT NULL,
    CONSTRAINT focus_reward_accruals_fish_ck CHECK (((earned_fish >= 0) AND (golden_fish >= 0) AND ((tutorial_fish >= 0) AND (tutorial_fish <= 1)) AND (((earned_fish + golden_fish) + tutorial_fish) > 0)))
);


--
-- Name: focus_reward_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.focus_reward_policies (
    revision integer NOT NULL,
    seconds_per_fish integer NOT NULL,
    daily_cap_fish integer NOT NULL,
    personal_share_percent integer NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    golden_fish_reward integer DEFAULT 50 NOT NULL,
    golden_max_members integer DEFAULT 5 NOT NULL,
    golden_chance_ppm text DEFAULT '4000,12000,24000,40000'::text NOT NULL,
    CONSTRAINT focus_reward_policies_daily_cap_fish_check CHECK ((daily_cap_fish >= 0)),
    CONSTRAINT focus_reward_policies_personal_share_percent_check CHECK ((personal_share_percent = 0)),
    CONSTRAINT focus_reward_policies_seconds_per_fish_check CHECK ((seconds_per_fish > 0))
);


--
-- Name: TABLE focus_reward_policies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.focus_reward_policies IS 'GROMO-1924: 집중 보상 산식 revision(FR-D01 · D5 · D5-귀속-개정). 추가만 한다 — 세션은 시작 시 revision 을 고정.';


--
-- Name: COLUMN focus_reward_policies.personal_share_percent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.focus_reward_policies.personal_share_percent IS 'GROMO-2045: 0 고정(CHECK) — D5-귀속-개정으로 개인 지갑 적립은 폐기됐다. 열을 지우지 않는 것은 E=P+C 보존식의 P 자리를 응답 계약이 아직 쓰기 때문이다.';


--
-- Name: focus_session_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.focus_session_details (
    session_id uuid NOT NULL,
    user_id uuid,
    island_id uuid NOT NULL,
    membership_epoch_at_start bigint,
    subject character varying(200) NOT NULL,
    target_minutes integer,
    lifecycle character varying(20) NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    last_transition_at timestamp with time zone NOT NULL,
    policy_revision integer,
    rest_seat integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rewarded_seconds bigint DEFAULT 0 NOT NULL,
    kind character varying(10) DEFAULT 'ISLAND'::character varying NOT NULL,
    sailing_minutes integer,
    arrived boolean,
    CONSTRAINT focus_session_details_lifecycle_check CHECK (((lifecycle)::text = ANY ((ARRAY['ACTIVE'::character varying, 'PAUSED'::character varying, 'COMPLETED'::character varying, 'ABANDONED'::character varying, 'MEMBERSHIP_LOST'::character varying])::text[]))),
    CONSTRAINT focus_session_details_sea_sailing_ck CHECK ((((kind)::text <> 'SEA'::text) OR (sailing_minutes IS NOT NULL)))
);


--
-- Name: TABLE focus_session_details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.focus_session_details IS 'GROMO-1764: v0.3 집중 세션 상세(섬 귀속·subject·목표·lifecycle·낙관 버전). focus_sessions 1:1.';


--
-- Name: COLUMN focus_session_details.island_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.focus_session_details.island_id IS '세션의 섬. kind=SEA 면 목적지 섬이며 섬 기여가 아니다(섬 단위 집계는 kind=ISLAND 만 센다)';


--
-- Name: focus_session_intervals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.focus_session_intervals (
    id bigint NOT NULL,
    session_id uuid NOT NULL,
    ordinal integer NOT NULL,
    kind character varying(10) NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    CONSTRAINT focus_session_intervals_kind_check CHECK (((kind)::text = ANY ((ARRAY['ACTIVE'::character varying, 'REST'::character varying])::text[]))),
    CONSTRAINT focus_session_intervals_order_ck CHECK (((ended_at IS NULL) OR (ended_at >= started_at)))
);


--
-- Name: TABLE focus_session_intervals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.focus_session_intervals IS 'GROMO-1764: v0.3 세션의 ACTIVE/REST 실제 서버 시간 구간. ordinal 유일, 열린 구간 최대 1개.';


--
-- Name: focus_session_intervals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.focus_session_intervals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: focus_session_intervals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.focus_session_intervals_id_seq OWNED BY public.focus_session_intervals.id;


--
-- Name: focus_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.focus_sessions (
    id uuid NOT NULL,
    ended_at timestamp(6) with time zone,
    started_at timestamp(6) with time zone NOT NULL,
    total_distraction_seconds integer NOT NULL,
    user_id uuid,
    status character varying(255) DEFAULT 'ACTIVE'::character varying NOT NULL,
    focus_type character varying(255) DEFAULT 'INFINITE'::character varying NOT NULL,
    daily_focus_stat_id uuid,
    created_at timestamp(6) with time zone,
    stat_end_at timestamp with time zone,
    focus_seconds_by_date jsonb,
    client_started_at timestamp with time zone,
    presence_order bigint,
    CONSTRAINT focus_sessions_focus_type_check CHECK (((focus_type)::text = ANY (ARRAY[('INFINITE'::character varying)::text, ('RANGE'::character varying)::text, ('POMODORO'::character varying)::text]))),
    CONSTRAINT focus_sessions_status_check CHECK (((status)::text = ANY (ARRAY[('ACTIVE'::character varying)::text, ('COMPLETED'::character varying)::text, ('CANCELED'::character varying)::text, ('AUTO_CLOSED'::character varying)::text])))
);


--
-- Name: COLUMN focus_sessions.client_started_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.focus_sessions.client_started_at IS '시작 요청의 클램프 이전 클라 시각 — 마커 순서 판정 전용(GROMO-1287). 저장·집계·보상은 started_at 을 쓴다. 레거시 행은 NULL 이라 판정측이 started_at 으로 폴백한다.';


--
-- Name: COLUMN focus_sessions.presence_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.focus_sessions.presence_order IS 'GROMO-1743: 집중 프레즌스 리스의 순서 판정 키(DB 시퀀스). 인스턴스 시계에 묶인 UUID v7 대신 쓴다. V77 이전에 끝난 행은 NULL.';


--
-- Name: focus_sessions_presence_order_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.focus_sessions_presence_order_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: focus_sessions_presence_order_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.focus_sessions_presence_order_seq OWNED BY public.focus_sessions.presence_order;


--
-- Name: focus_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.focus_settlements (
    session_id uuid NOT NULL,
    contract_version integer DEFAULT 1 NOT NULL,
    policy_revision integer,
    active_seconds bigint NOT NULL,
    goal_achieved boolean NOT NULL,
    earned_fish integer DEFAULT 0 NOT NULL,
    personal_fish_added integer DEFAULT 0 NOT NULL,
    construction_fish_added integer DEFAULT 0 NOT NULL,
    quest_progress jsonb,
    events jsonb,
    completed_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    auto_closed boolean DEFAULT false NOT NULL,
    acknowledged_at timestamp with time zone,
    customization_reward_revision integer,
    customization_reward_product_id character varying(80),
    customization_reward_new boolean
);


--
-- Name: TABLE focus_settlements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.focus_settlements IS 'GROMO-1764: v0.3 세션당 정산 결과(금액 보존식 E=P+C). 보상 정책 확정 전까지 미사용 — 스키마만 선반영.';


--
-- Name: focus_statistics_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.focus_statistics_snapshots (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    payload text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: focus_tutorial_rewards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.focus_tutorial_rewards (
    user_id uuid NOT NULL,
    session_id uuid,
    claimed_at timestamp with time zone NOT NULL,
    island_id uuid
);


--
-- Name: friendships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.friendships (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone,
    deleted_at timestamp(6) with time zone,
    status character varying(255) NOT NULL,
    updated_at timestamp(6) with time zone,
    from_user_id uuid NOT NULL,
    to_user_id uuid NOT NULL,
    CONSTRAINT friendships_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'ACCEPTED'::character varying, 'REJECTED'::character varying, 'CANCELED'::character varying])::text[])))
);


--
-- Name: group_announcement_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_announcement_comments (
    id uuid NOT NULL,
    notice_id uuid,
    author_id uuid,
    text text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE group_announcement_comments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.group_announcement_comments IS '섬 게시판 공지 댓글 — 불변. notice_id 는 공지 삭제 시 CASCADE(V103), author_id 는 탈퇴자 댓글을 애플리케이션이 먼저 delete 하므로 SET NULL 이 발동하지 않는다(2026-09-25 결정 GROMO-2136). GROMO-1771';


--
-- Name: COLUMN group_announcement_comments.notice_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.group_announcement_comments.notice_id IS '공지 삭제 시 댓글도 함께 삭제된다(ON DELETE CASCADE, 2026-09-25 결정 GROMO-2136 — BQ02 확정). GROMO-1771';


--
-- Name: group_announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_announcements (
    id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp(6) with time zone NOT NULL,
    title character varying(100) NOT NULL,
    updated_at timestamp(6) with time zone,
    user_id uuid,
    group_id uuid NOT NULL,
    deleted_at timestamp(6) with time zone
);


--
-- Name: group_invite_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_invite_links (
    id uuid NOT NULL,
    slug character varying(12) NOT NULL,
    group_id uuid NOT NULL,
    inviter_id uuid,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    issuance_epoch bigint DEFAULT 0 NOT NULL
);


--
-- Name: COLUMN group_invite_links.issuance_epoch; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.group_invite_links.issuance_epoch IS '발급 시점 발급자의 group_members.membership_epoch — 이탈/강퇴/재가입으로 세대가 바뀌면 이 코드는 폐기(410). GROMO-1760';


--
-- Name: group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_members (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone,
    notification_enabled boolean NOT NULL,
    role character varying(10) NOT NULL,
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status character varying(255) DEFAULT 'INACTIVE'::character varying NOT NULL,
    is_left boolean DEFAULT false NOT NULL,
    updated_at timestamp(6) with time zone,
    announcement_permission character varying(255) DEFAULT 'DISALLOW'::character varying NOT NULL,
    left_reason character varying(10),
    membership_epoch bigint DEFAULT 1 NOT NULL,
    left_at timestamp with time zone,
    rejoined_at timestamp with time zone,
    CONSTRAINT group_members_announcement_permission_check CHECK (((announcement_permission)::text = ANY (ARRAY[('DISALLOW'::character varying)::text, ('ALLOW'::character varying)::text]))),
    CONSTRAINT group_members_left_reason_check CHECK (((left_reason IS NULL) OR ((left_reason)::text = ANY ((ARRAY['LEFT'::character varying, 'KICKED'::character varying])::text[])))),
    CONSTRAINT group_members_role_check CHECK (((role)::text = ANY (ARRAY[('OWNER'::character varying)::text, ('MEMBER'::character varying)::text]))),
    CONSTRAINT group_members_status_check CHECK (((status)::text = ANY (ARRAY[('INACTIVE'::character varying)::text, ('CHALLENGE'::character varying)::text, ('FOCUS'::character varying)::text])))
);


--
-- Name: COLUMN group_members.left_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.group_members.left_at IS '이탈 시각 — 자진 탈퇴·강퇴·계정 탈퇴가 모두 찍는다(GroupMember.leave/kick). is_left=false 면 항상 NULL (rejoin 이 비운다). V97 이전에 이탈한 행은 근거가 없어 NULL 이다. GROMO-2050';


--
-- Name: COLUMN group_members.rejoined_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.group_members.rejoined_at IS '재가입으로 멤버십이 다시 시작된 시각(GroupMember.rejoin). NULL 이면 최초 가입 그대로라 시작 시각은 created_at 이다 — 과거 시점 소속 판정의 시작 축은 COALESCE(rejoined_at, created_at). GROMO-2050';


--
-- Name: guest_device_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_device_claims (
    device_digest character varying(64) NOT NULL,
    user_id uuid NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    recovery_expires_at timestamp with time zone NOT NULL
);


--
-- Name: TABLE guest_device_claims; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.guest_device_claims IS '게스트 기기 점유 (GROMO-2036, V87) — 복구 창 안에서 같은 기기 digest 의 재시도가 같은 게스트 유저를 받게 하는 원장. 창이 지나면 점유가 풀려 다음 요청이 새 게스트를 만든다(계정 LLD §3 Q06 미결 보존)';


--
-- Name: COLUMN guest_device_claims.device_digest; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.guest_device_claims.device_digest IS 'Business 가 계산한 기기 식별자의 keyed HMAC-SHA256 hex. 원문 기기 식별자는 Data 에 도달하지 않는다';


--
-- Name: COLUMN guest_device_claims.recovery_expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.guest_device_claims.recovery_expires_at IS '이 점유가 같은 유저를 재생해 주는 마감. 지난 행은 다음 점유가 같은 PK 로 덮어 재사용한다';


--
-- Name: island_appearances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_appearances (
    island_id uuid NOT NULL,
    island_theme_id character varying(80) DEFAULT 'default'::character varying NOT NULL,
    building_themes jsonb DEFAULT '{}'::jsonb NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: island_arrivals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_arrivals (
    user_id uuid NOT NULL,
    island_id uuid NOT NULL,
    first_arrived_at timestamp with time zone NOT NULL,
    last_arrived_at timestamp with time zone NOT NULL,
    member_arrived_at timestamp with time zone
);


--
-- Name: COLUMN island_arrivals.member_arrived_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.island_arrivals.member_arrived_at IS '주민으로서 마지막 도착 시각 — NULL 이면 주민 도착 없음(방문자 도착만). 현 멤버십 시작보다 이르면 다음 도착이 주민 첫 도착(GROMO-2302)';


--
-- Name: island_construction_contributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_construction_contributions (
    island_id uuid NOT NULL,
    epoch bigint NOT NULL,
    user_id uuid NOT NULL,
    amount integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT island_construction_contributions_amount_check CHECK ((amount >= 0))
);


--
-- Name: island_construction_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_construction_states (
    island_id uuid NOT NULL,
    target_building_id character varying(30),
    target_epoch bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: island_facilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_facilities (
    island_id uuid NOT NULL,
    building_id character varying(30) NOT NULL,
    status character varying(20) NOT NULL,
    cost integer NOT NULL,
    cost_revision integer NOT NULL,
    started_by uuid,
    started_at timestamp with time zone,
    completes_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT island_facilities_cost_check CHECK ((cost >= 0)),
    CONSTRAINT island_facilities_status_check CHECK (((status)::text = ANY ((ARRAY['BUILDING'::character varying, 'COMPLETED'::character varying])::text[])))
);


--
-- Name: TABLE island_facilities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.island_facilities IS '섬 시설 (섬+buildingId 유일) — BUILDING 은 스케줄러가 completes_at 경과 시 COMPLETED 로 전이';


--
-- Name: island_focus_averages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_focus_averages (
    snapshot_date date NOT NULL,
    island_id uuid NOT NULL,
    member_count integer NOT NULL,
    avg_minutes_per_member_day integer,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: island_guestbook_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_guestbook_entries (
    id uuid NOT NULL,
    island_id uuid NOT NULL,
    author_id uuid NOT NULL,
    content character varying(80) NOT NULL,
    written_on date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: island_join_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_join_requests (
    id uuid NOT NULL,
    island_id uuid NOT NULL,
    applicant_id uuid NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    terminal_reason character varying(30),
    invite_link_id uuid,
    version bigint DEFAULT 0 NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp(6) with time zone,
    CONSTRAINT island_join_requests_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'APPROVED'::character varying, 'REJECTED'::character varying, 'CANCELLED'::character varying])::text[]))),
    CONSTRAINT island_join_requests_terminal_reason_check CHECK (((terminal_reason)::text = ANY ((ARRAY['APPLICANT_CANCELLED'::character varying, 'HOST_APPROVED'::character varying, 'HOST_REJECTED'::character varying, 'ISLAND_CLOSED'::character varying])::text[])))
);


--
-- Name: TABLE island_join_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.island_join_requests IS '섬 가입 요청 — 논리 모델 JoinRequest. PENDING 이 유일한 열린 상태이고 전이는 요청 행 잠금 아래서만. GROMO-1760, island-membership LLD §3.7';


--
-- Name: island_layouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_layouts (
    island_id uuid NOT NULL,
    layout_revision bigint DEFAULT 1 NOT NULL,
    layout jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT island_layouts_layout_revision_check CHECK ((layout_revision >= 1))
);


--
-- Name: island_news; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_news (
    id uuid NOT NULL,
    island_id uuid NOT NULL,
    kind character varying(20) NOT NULL,
    body character varying(200) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: island_playbacks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_playbacks (
    island_id uuid NOT NULL,
    track_id character varying(80),
    playing boolean DEFAULT false NOT NULL,
    position_seconds bigint DEFAULT 0 NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    changed_by uuid,
    version bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT island_playbacks_playing_needs_track CHECK (((track_id IS NOT NULL) OR (NOT playing))),
    CONSTRAINT island_playbacks_position_seconds_check CHECK ((position_seconds >= 0))
);


--
-- Name: island_promotion_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_promotion_reports (
    promotion_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    reason character varying(30) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT island_promotion_reports_reason_check CHECK (((reason)::text = ANY ((ARRAY['HARASSMENT'::character varying, 'HATE'::character varying, 'SPAM_FRAUD'::character varying, 'SEXUAL'::character varying, 'CHILD_SAFETY'::character varying, 'THREAT'::character varying, 'PRIVACY_IMPERSONATION'::character varying, 'OTHER'::character varying])::text[])))
);


--
-- Name: island_promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_promotions (
    id uuid NOT NULL,
    island_id uuid NOT NULL,
    issue_date date NOT NULL,
    applied_by uuid NOT NULL,
    applied_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    body character varying(60) NOT NULL,
    layout jsonb NOT NULL,
    snapshot jsonb,
    moderation character varying(10) DEFAULT 'NONE'::character varying NOT NULL,
    hidden_at timestamp with time zone,
    CONSTRAINT island_promotions_moderation_check CHECK (((moderation)::text = ANY ((ARRAY['NONE'::character varying, 'HIDDEN'::character varying, 'REMOVED'::character varying, 'CLEARED'::character varying])::text[])))
);


--
-- Name: island_quest_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_quest_claims (
    id uuid NOT NULL,
    island_id uuid NOT NULL,
    occurrence_id uuid NOT NULL,
    kind character varying(20) NOT NULL,
    amount integer NOT NULL,
    claimed_by uuid,
    wallet_idempotency_key character varying(200) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT island_quest_claims_amount_check CHECK ((amount > 0)),
    CONSTRAINT island_quest_claims_kind_check CHECK (((kind)::text = ANY ((ARRAY['ACHIEVER'::character varying, 'ALL_ACHIEVED_BONUS'::character varying])::text[])))
);


--
-- Name: island_quest_cohort_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_quest_cohort_members (
    occurrence_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: island_quest_occurrences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_quest_occurrences (
    id uuid NOT NULL,
    quest_id uuid NOT NULL,
    island_id uuid NOT NULL,
    occurrence_date date NOT NULL,
    definition_revision integer NOT NULL,
    type character varying(10) NOT NULL,
    title character varying(40) NOT NULL,
    target_minutes integer NOT NULL,
    window_start time without time zone,
    window_end time without time zone,
    reward_per_achiever integer NOT NULL,
    reward_bonus_per_member integer NOT NULL,
    version bigint NOT NULL,
    bonus_settled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT island_quest_occurrences_reward_bonus_per_member_check CHECK ((reward_bonus_per_member >= 0)),
    CONSTRAINT island_quest_occurrences_reward_per_achiever_check CHECK ((reward_per_achiever >= 0)),
    CONSTRAINT island_quest_occurrences_type_check CHECK (((type)::text = ANY ((ARRAY['FOCUS'::character varying, 'SCREEN'::character varying])::text[])))
);


--
-- Name: island_quests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_quests (
    id uuid NOT NULL,
    island_id uuid NOT NULL,
    type character varying(10) NOT NULL,
    title character varying(40) NOT NULL,
    target_minutes integer NOT NULL,
    window_start time without time zone,
    window_end time without time zone,
    revision integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT island_quests_target_check CHECK (((target_minutes >= 1) AND (target_minutes <= 1440))),
    CONSTRAINT island_quests_type_check CHECK (((type)::text = ANY ((ARRAY['FOCUS'::character varying, 'SCREEN'::character varying])::text[]))),
    CONSTRAINT island_quests_window_check CHECK (((((type)::text = 'FOCUS'::text) AND (window_start IS NOT NULL) AND (window_end IS NOT NULL) AND (window_start < window_end)) OR (((type)::text = 'SCREEN'::text) AND (window_start IS NULL) AND (window_end IS NULL))))
);


--
-- Name: island_wallet_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_wallet_transactions (
    id uuid NOT NULL,
    island_id uuid NOT NULL,
    amount integer NOT NULL,
    type character varying(40) NOT NULL,
    idempotency_key character varying(200),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT island_wallet_transactions_amount_check CHECK ((amount > 0))
);


--
-- Name: island_wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_wallets (
    island_id uuid NOT NULL,
    balance integer DEFAULT 0 NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone,
    CONSTRAINT island_wallets_balance_check CHECK ((balance >= 0))
);


--
-- Name: TABLE island_wallets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.island_wallets IS '섬 공동 지갑 (village_points) — GROMO-1767, island-construction 정책 C05/D1. 개인 user_wallets 와 다른 축';


--
-- Name: island_weekly_focus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_weekly_focus (
    week_start date NOT NULL,
    island_id uuid NOT NULL,
    active_micros bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT island_weekly_focus_micros_ck CHECK ((active_micros >= 0)),
    CONSTRAINT island_weekly_focus_sunday_ck CHECK ((EXTRACT(isodow FROM week_start) = (7)::numeric))
);


--
-- Name: TABLE island_weekly_focus; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.island_weekly_focus IS '주간 섬 랭킹 분자 read model — (UTC 일요일 주, 섬)의 끝난 섬 집중 ACTIVE μs 합. GROMO-2343, V130';


--
-- Name: island_weekly_member_counts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.island_weekly_member_counts (
    week_start date NOT NULL,
    island_id uuid NOT NULL,
    member_count integer NOT NULL,
    frozen_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT island_weekly_member_counts_count_ck CHECK ((member_count > 0)),
    CONSTRAINT island_weekly_member_counts_sunday_ck CHECK ((EXTRACT(isodow FROM week_start) = (7)::numeric))
);


--
-- Name: TABLE island_weekly_member_counts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.island_weekly_member_counts IS '주간 섬 랭킹의 동결된 분모 — 주 마감(일요일 00:00Z) 시점의 활성 주민 수. GROMO-1997, V85';


--
-- Name: islands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.islands (
    id uuid NOT NULL,
    is_chat_enabled boolean NOT NULL,
    chat_limit_per_person integer,
    created_at timestamp(6) with time zone,
    description character varying(200),
    invite_permission character varying(20) NOT NULL,
    max_members integer NOT NULL,
    name character varying(50) NOT NULL,
    password character varying(100),
    status character varying(255) NOT NULL,
    version bigint,
    deleted_at timestamp(6) with time zone,
    is_private boolean DEFAULT false NOT NULL,
    approval_required boolean DEFAULT false NOT NULL,
    shared_purchase_permission character varying(20) DEFAULT 'OWNER_ONLY'::character varying NOT NULL,
    greeting character varying(160),
    CONSTRAINT groups_invite_permission_check CHECK (((invite_permission)::text = ANY (ARRAY[('OWNER_ONLY'::character varying)::text, ('ALL_MEMBERS'::character varying)::text]))),
    CONSTRAINT groups_shared_purchase_permission_check CHECK (((shared_purchase_permission)::text = ANY ((ARRAY['OWNER_ONLY'::character varying, 'ALL_MEMBERS'::character varying])::text[]))),
    CONSTRAINT groups_status_check CHECK (((status)::text = ANY (ARRAY[('WAITING'::character varying)::text, ('ACTIVE'::character varying)::text, ('ENDED'::character varying)::text])))
);


--
-- Name: COLUMN islands.approval_required; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.islands.approval_required IS '가입에 방장 승인이 필요한지 — GROMO-1907, island-membership LLD §3.1. 기존 행은 전부 false(즉시가입)';


--
-- Name: letters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.letters (
    id uuid NOT NULL,
    sender_id uuid,
    receiver_id uuid NOT NULL,
    content character varying(500) NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    kind character varying(20) DEFAULT 'FRIEND'::character varying NOT NULL,
    island_id uuid,
    CONSTRAINT letters_kind_check CHECK (((kind)::text = ANY ((ARRAY['FRIEND'::character varying, 'KICK'::character varying, 'JOIN_APPROVED'::character varying])::text[])))
);


--
-- Name: TABLE letters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.letters IS '친구 사이 1:1 편지 — GROMO-1933, friend-letter LLD §1.12~1.14 · §2. 섬 공개 메시지(island-mailbox)와 다른 도메인';


--
-- Name: login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_attempts (
    attempt_id uuid NOT NULL,
    status character varying(24) NOT NULL,
    digest_key_id character varying(64),
    credential_digest character varying(64),
    provider character varying(32) NOT NULL,
    credential_kind character varying(32) NOT NULL,
    terms_version character varying(64) NOT NULL,
    user_id uuid,
    session_id uuid,
    onboarding_complete boolean,
    token_guest boolean,
    auth_generation bigint,
    access_issued_at timestamp with time zone,
    access_expires_at timestamp with time zone,
    refresh_issued_at timestamp with time zone,
    refresh_expires_at timestamp with time zone,
    refresh_jti uuid,
    claimed_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    recovery_expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_switch_confirmed boolean DEFAULT false NOT NULL,
    switch_phase character varying(24),
    switch_source_user_id uuid,
    switch_source_session_id uuid,
    switch_source_auth_generation bigint,
    switch_target_user_id uuid,
    switch_target_social_account_id uuid,
    switch_verified_at timestamp with time zone,
    CONSTRAINT ck_login_attempts_switch_state CHECK ((((switch_phase IS NULL) AND (switch_source_user_id IS NULL) AND (switch_source_session_id IS NULL) AND (switch_source_auth_generation IS NULL) AND (switch_target_user_id IS NULL) AND (switch_target_social_account_id IS NULL) AND (switch_verified_at IS NULL)) OR ((switch_phase IS NOT NULL) AND ((switch_phase)::text = ANY ((ARRAY['VERIFIED'::character varying, 'GUEST_WITHDRAWN'::character varying])::text[])) AND ((status)::text = ANY ((ARRAY['PENDING'::character varying, 'COMPLETED'::character varying])::text[])) AND (account_switch_confirmed = true) AND (switch_source_user_id IS NOT NULL) AND (switch_source_session_id IS NOT NULL) AND (switch_source_auth_generation IS NOT NULL) AND (switch_source_auth_generation >= 0) AND (switch_target_user_id IS NOT NULL) AND (switch_target_social_account_id IS NOT NULL) AND (switch_verified_at IS NOT NULL)) OR ((switch_phase IS NOT NULL) AND ((switch_phase)::text = ANY ((ARRAY['VERIFIED'::character varying, 'GUEST_WITHDRAWN'::character varying])::text[])) AND ((status)::text = 'INVALIDATED'::text) AND (account_switch_confirmed = true) AND (switch_source_user_id IS NULL) AND (switch_source_session_id IS NULL) AND (switch_source_auth_generation IS NULL) AND (switch_target_user_id IS NULL) AND (switch_target_social_account_id IS NULL) AND (switch_verified_at IS NULL)))),
    CONSTRAINT login_attempts_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'COMPLETED'::character varying, 'REPREPARE_REQUIRED'::character varying, 'INVALIDATED'::character varying])::text[])))
);


--
-- Name: TABLE login_attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.login_attempts IS 'GROMO-1908: POST /auth/sessions 의 내구 로그인 시도 원장. 토큰 원문 대신 고정 서명 재료를 보관한다.';


--
-- Name: magazine_asset_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.magazine_asset_meta (
    product_id character varying(80) NOT NULL,
    kind character varying(20) NOT NULL,
    bundle character varying(10) NOT NULL,
    drawer_tab character varying(10),
    sort_order integer NOT NULL,
    retired_at timestamp with time zone,
    CONSTRAINT magazine_asset_meta_bundle_check CHECK (((bundle)::text = ANY ((ARRAY['free'::character varying, 'season'::character varying])::text[]))),
    CONSTRAINT magazine_asset_meta_drawer_tab_check CHECK (((drawer_tab)::text = ANY ((ARRAY['cat'::character varying, 'sea'::character varying, 'friends'::character varying, 'deco'::character varying])::text[]))),
    CONSTRAINT magazine_asset_meta_kind_check CHECK (((kind)::text = ANY ((ARRAY['ad_frame'::character varying, 'ad_sticker'::character varying, 'ad_tape'::character varying])::text[]))),
    CONSTRAINT magazine_asset_meta_tab_check CHECK ((((kind)::text = 'ad_sticker'::text) = (drawer_tab IS NOT NULL)))
);


--
-- Name: magazine_editorial_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.magazine_editorial_notes (
    issue_date date NOT NULL,
    body character varying(80) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: magazine_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.magazine_issues (
    id uuid NOT NULL,
    issue_date date NOT NULL,
    slot character varying(10) DEFAULT 'MORNING'::character varying NOT NULL,
    issue_no integer NOT NULL,
    published_at timestamp with time zone NOT NULL,
    editorial jsonb NOT NULL,
    promotion_count integer NOT NULL,
    notified_at timestamp with time zone,
    CONSTRAINT magazine_issues_issue_no_check CHECK ((issue_no > 0)),
    CONSTRAINT magazine_issues_promotion_count_check CHECK ((promotion_count >= 0)),
    CONSTRAINT magazine_issues_slot_check CHECK (((slot)::text = 'MORNING'::text))
);


--
-- Name: COLUMN magazine_issues.notified_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.magazine_issues.notified_at IS '알림 펼치기 완료 시각 — NULL 이면 틱마다 재시도(GROMO-2307)';


--
-- Name: magazine_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.magazine_receipts (
    user_id uuid NOT NULL,
    issue_id uuid NOT NULL,
    received_place character varying(10) NOT NULL,
    received_at timestamp with time zone NOT NULL,
    deferred_at timestamp with time zone,
    opened_at timestamp with time zone,
    CONSTRAINT magazine_receipts_received_place_check CHECK (((received_place)::text = ANY ((ARRAY['SEA'::character varying, 'ISLAND'::character varying])::text[])))
);


--
-- Name: onboarding_islands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_islands (
    user_id uuid NOT NULL,
    island_id uuid NOT NULL
);


--
-- Name: owned_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owned_products (
    id uuid NOT NULL,
    owner_type character varying(10) NOT NULL,
    user_id uuid,
    group_id uuid,
    product_id character varying(80) NOT NULL,
    granted_ref character varying(120),
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT owned_products_owner_check CHECK (((((owner_type)::text = 'user'::text) AND (user_id IS NOT NULL) AND (group_id IS NULL)) OR (((owner_type)::text = 'island'::text) AND (group_id IS NOT NULL) AND (user_id IS NULL)))),
    CONSTRAINT owned_products_owner_type_check CHECK (((owner_type)::text = ANY ((ARRAY['user'::character varying, 'island'::character varying])::text[])))
);


--
-- Name: personal_appearances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personal_appearances (
    user_id uuid NOT NULL,
    clothes character varying(80),
    decor character varying(80),
    hull character varying(20) DEFAULT 'raft'::character varying NOT NULL,
    "position" character varying(10) DEFAULT 'front'::character varying NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    head character varying(80),
    neck character varying(80),
    shoes character varying(80),
    CONSTRAINT personal_appearances_hull_check CHECK (((hull)::text = 'raft'::text)),
    CONSTRAINT personal_appearances_position_check CHECK ((("position")::text = ANY ((ARRAY['front'::character varying, 'back'::character varying])::text[])))
);


--
-- Name: screen_time_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.screen_time_observations (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    device_id uuid NOT NULL,
    measured_date date NOT NULL,
    measured_at timestamp with time zone NOT NULL,
    minutes integer,
    measurement_status character varying(12) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finalized boolean DEFAULT false NOT NULL,
    timezone character varying(32) DEFAULT 'UTC'::character varying NOT NULL,
    CONSTRAINT screen_time_observations_minutes_check CHECK (((((measurement_status)::text = 'authorized'::text) = (minutes IS NOT NULL)) AND ((minutes IS NULL) OR ((minutes >= 0) AND (minutes <= 1440))))),
    CONSTRAINT screen_time_observations_status_check CHECK (((measurement_status)::text = ANY ((ARRAY['authorized'::character varying, 'denied'::character varying, 'unavailable'::character varying, 'pending'::character varying])::text[]))),
    CONSTRAINT screen_time_observations_timezone_check CHECK (((timezone)::text = ANY ((ARRAY['UTC'::character varying, 'Asia/Seoul'::character varying])::text[])))
);


--
-- Name: screen_time_observations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.screen_time_observations ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.screen_time_observations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sea_remarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sea_remarks (
    user_id uuid NOT NULL,
    remark character varying(20) NOT NULL,
    changed_at timestamp with time zone NOT NULL
);


--
-- Name: shedlock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shedlock (
    name character varying(64) NOT NULL,
    lock_until timestamp without time zone NOT NULL,
    locked_at timestamp without time zone NOT NULL,
    locked_by character varying(255) NOT NULL
);


--
-- Name: shop_catalog_active_publication; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shop_catalog_active_publication (
    singleton boolean DEFAULT true NOT NULL,
    publication_version bigint NOT NULL,
    activated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shop_catalog_active_publication_singleton_check CHECK (singleton)
);


--
-- Name: shop_catalog_publication_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shop_catalog_publication_entries (
    publication_version bigint NOT NULL,
    product_id character varying(80) NOT NULL,
    product_revision integer NOT NULL,
    category character varying(20) NOT NULL,
    display_order integer NOT NULL,
    CONSTRAINT shop_catalog_publication_entries_category_check CHECK (((category)::text = ANY ((ARRAY['personal'::character varying, 'island'::character varying, 'sound'::character varying])::text[])))
);


--
-- Name: shop_catalog_publications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shop_catalog_publications (
    version bigint NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    retired_at timestamp with time zone,
    invalidated_at timestamp with time zone,
    CONSTRAINT shop_catalog_publications_version_check CHECK ((version >= 1))
);


--
-- Name: shop_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shop_orders (
    id uuid NOT NULL,
    island_id uuid NOT NULL,
    requester_id uuid NOT NULL,
    owner_type character varying(10) NOT NULL,
    product_id character varying(80) NOT NULL,
    product_revision integer NOT NULL,
    paid_price integer NOT NULL,
    currency character varying(20) NOT NULL,
    payer_type character varying(10) DEFAULT 'island'::character varying NOT NULL,
    payer_user_id uuid,
    wallet_version_after bigint NOT NULL,
    balance_after integer NOT NULL,
    analytics_delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shop_orders_balance_after_check CHECK ((balance_after >= 0)),
    CONSTRAINT shop_orders_currency_check CHECK (((currency)::text = 'village_points'::text)),
    CONSTRAINT shop_orders_owner_type_check CHECK (((owner_type)::text = ANY ((ARRAY['user'::character varying, 'island'::character varying])::text[]))),
    CONSTRAINT shop_orders_paid_price_check CHECK ((paid_price > 0)),
    CONSTRAINT shop_orders_payer_check CHECK ((((payer_type)::text = 'island'::text) AND (payer_user_id IS NULL))),
    CONSTRAINT shop_orders_wallet_version_after_check CHECK ((wallet_version_after >= 0))
);


--
-- Name: TABLE shop_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.shop_orders IS '상점 주문 — GROMO-1781. 섬 귀속(BG18), 결제 snapshot 불변. 결제자는 섬 통장뿐(2026-09-19 결정)';


--
-- Name: shop_product_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shop_product_revisions (
    product_id character varying(80) NOT NULL,
    revision integer NOT NULL,
    currency character varying(20) DEFAULT 'village_points'::character varying NOT NULL,
    price integer,
    required_building character varying(30),
    required_product_id character varying(80),
    preview_media_key character varying(200),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shop_product_revisions_currency_check CHECK (((currency)::text = 'village_points'::text)),
    CONSTRAINT shop_product_revisions_price_check CHECK (((price IS NULL) OR (price > 0))),
    CONSTRAINT shop_product_revisions_required_self_check CHECK (((required_product_id)::text <> (product_id)::text)),
    CONSTRAINT shop_product_revisions_revision_check CHECK ((revision >= 1))
);


--
-- Name: TABLE shop_product_revisions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.shop_product_revisions IS '상점 판매 revision — GROMO-1781, island-shop LLD §3. 발행 후 불변. price NULL = 승인 가격 없음(구매 불가, 정책 S03)';


--
-- Name: social_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_accounts (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone,
    deleted_at timestamp(6) with time zone,
    provider character varying(255) NOT NULL,
    provider_id character varying(255) NOT NULL,
    user_id uuid NOT NULL,
    CONSTRAINT social_accounts_provider_check CHECK (((provider)::text = ANY (ARRAY[('APPLE'::character varying)::text, ('GOOGLE'::character varying)::text, ('KAKAO'::character varying)::text, ('LINE'::character varying)::text, ('INSTAGRAM'::character varying)::text, ('FACEBOOK'::character varying)::text])))
);


--
-- Name: telescope_buckets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telescope_buckets (
    user_id uuid NOT NULL,
    bucket_start timestamp with time zone NOT NULL,
    island_ids uuid[] NOT NULL,
    has_nearby boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE telescope_buckets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.telescope_buckets IS '망원경 1시간 목록 스냅샷(GROMO-2306) — 같은 버킷 안에서는 이 행이 정본이고 정원·가입 변동은 표시(full·membershipStatus)만 바꾼다';


--
-- Name: telescope_pins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telescope_pins (
    user_id uuid NOT NULL,
    island_id uuid NOT NULL,
    source character varying(20) NOT NULL,
    pinned_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    promotion_id uuid,
    CONSTRAINT telescope_pins_promotion_source_check CHECK (((promotion_id IS NULL) OR ((source)::text = 'magazine'::text))),
    CONSTRAINT telescope_pins_source_check CHECK (((source)::text = ANY ((ARRAY['magazine'::character varying, 'observatory'::character varying])::text[])))
);


--
-- Name: user_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_blocks (
    id uuid NOT NULL,
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_fish_wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_fish_wallets (
    user_id uuid NOT NULL,
    balance integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_fish_wallets_balance_check CHECK ((balance >= 0))
);


--
-- Name: TABLE user_fish_wallets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_fish_wallets IS 'GROMO-1924: 개인 물고기 지갑(D1). 코인(user_wallets)과 별개 — D11 로 코인 잔액을 옮기지 않는다.';


--
-- Name: user_island_contexts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_island_contexts (
    user_id uuid NOT NULL,
    current_island_id uuid,
    context_version bigint DEFAULT 0 NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    updated_at timestamp(6) with time zone,
    loss_reason character varying(20),
    CONSTRAINT user_island_contexts_loss_reason_check CHECK (((loss_reason IS NULL) OR ((loss_reason)::text = ANY ((ARRAY['LEFT'::character varying, 'KICKED'::character varying])::text[])))),
    CONSTRAINT user_island_contexts_loss_reason_exclusive CHECK (((current_island_id IS NULL) OR (loss_reason IS NULL)))
);


--
-- Name: TABLE user_island_contexts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_island_contexts IS '사용자의 현재 섬 컨텍스트(users 1:1) — 논리 모델 UserIslandContext. GROMO-1907, island-membership LLD §4';


--
-- Name: user_main_islands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_main_islands (
    user_id uuid NOT NULL,
    island_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone
);


--
-- Name: TABLE user_main_islands; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_main_islands IS '사용자가 고른 메인 섬(users 1:1) — 행이 없으면 가장 먼저 가입한 활성 섬으로 도출한다. 현재 섬(user_island_contexts.current_island_id)과 다른 축이다. GROMO-1971, V81';


--
-- Name: COLUMN user_main_islands.island_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_main_islands.island_id IS '메인 섬 groups.id — 이 행이 있는 동안 사용자는 그 섬의 활성 주민이다(이탈·강퇴·탈퇴가 같은 TX 에서 옮기거나 지운다). GROMO-1971';


--
-- Name: user_notification_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_notification_settings (
    user_id uuid NOT NULL,
    deleted_at timestamp(6) with time zone,
    night_end_time time(0) without time zone,
    night_mode_enabled boolean DEFAULT false NOT NULL,
    night_start_time time(0) without time zone,
    notification_enabled boolean DEFAULT true NOT NULL,
    sound_enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp(6) with time zone
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    country_code character varying(255),
    created_at timestamp(6) with time zone,
    is_guest boolean NOT NULL,
    nickname character varying(255),
    updated_at timestamp(6) with time zone,
    is_deleted boolean DEFAULT false NOT NULL,
    language character varying(8),
    auth_generation bigint DEFAULT 0 NOT NULL,
    cat_color character varying(16),
    CONSTRAINT ck_users_cat_color CHECK (((cat_color)::text = ANY ((ARRAY['black'::character varying, 'ginger'::character varying, 'cream'::character varying, 'gray'::character varying, 'white'::character varying, 'calico'::character varying])::text[])))
);


--
-- Name: COLUMN users.language; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.language IS '앱이 적용 중인 표시 언어(BCP-47: ko·en·ja·zh-Hant). 푸시 렌더 언어의 정본. NULL=미보고. GROMO-1659 D11, V50';


--
-- Name: COLUMN users.cat_color; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.cat_color IS '고양이 색 자산 ID(black·ginger·cream·gray·white·calico). NULL=미선택(온보딩 전). 탈퇴 시 파기. GROMO-1945 Q03, V80';


--
-- Name: focus_session_intervals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_session_intervals ALTER COLUMN id SET DEFAULT nextval('public.focus_session_intervals_id_seq'::regclass);


--
-- Name: focus_sessions presence_order; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_sessions ALTER COLUMN presence_order SET DEFAULT nextval('public.focus_sessions_presence_order_seq'::regclass);


--
-- Name: aggregate_versions aggregate_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aggregate_versions
    ADD CONSTRAINT aggregate_versions_pkey PRIMARY KEY (aggregate_type, aggregate_id);


--
-- Name: audio_tracks audio_tracks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_tracks
    ADD CONSTRAINT audio_tracks_pkey PRIMARY KEY (product_id);


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);


--
-- Name: catalog_assets catalog_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_assets
    ADD CONSTRAINT catalog_assets_pkey PRIMARY KEY (product_id);


--
-- Name: catalog_assets catalog_assets_product_kind_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_assets
    ADD CONSTRAINT catalog_assets_product_kind_key UNIQUE (product_id, kind);


--
-- Name: command_idempotency command_idempotency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_idempotency
    ADD CONSTRAINT command_idempotency_pkey PRIMARY KEY (idempotency_key);


--
-- Name: construction_cost_policies construction_cost_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.construction_cost_policies
    ADD CONSTRAINT construction_cost_policies_pkey PRIMARY KEY (revision, building_id);


--
-- Name: construction_cost_policy_publication construction_cost_policy_publication_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.construction_cost_policy_publication
    ADD CONSTRAINT construction_cost_policy_publication_pkey PRIMARY KEY (singleton);


--
-- Name: construction_guide_recipients construction_guide_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.construction_guide_recipients
    ADD CONSTRAINT construction_guide_recipients_pkey PRIMARY KEY (island_id, building_id, user_id);


--
-- Name: customization_asset_meta customization_asset_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customization_asset_meta
    ADD CONSTRAINT customization_asset_meta_pkey PRIMARY KEY (product_id);


--
-- Name: customization_reward_items customization_reward_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customization_reward_items
    ADD CONSTRAINT customization_reward_items_pkey PRIMARY KEY (revision, product_id);


--
-- Name: customization_reward_items customization_reward_items_revision_source_asset_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customization_reward_items
    ADD CONSTRAINT customization_reward_items_revision_source_asset_id_key UNIQUE (revision, source_asset_id);


--
-- Name: customization_reward_policies customization_reward_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customization_reward_policies
    ADD CONSTRAINT customization_reward_policies_pkey PRIMARY KEY (revision);


--
-- Name: daily_focus_stats daily_focus_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_focus_stats
    ADD CONSTRAINT daily_focus_stats_pkey PRIMARY KEY (id);


--
-- Name: event_outbox_deliveries event_outbox_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_outbox_deliveries
    ADD CONSTRAINT event_outbox_deliveries_pkey PRIMARY KEY (id);


--
-- Name: event_outbox event_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_outbox
    ADD CONSTRAINT event_outbox_pkey PRIMARY KEY (id);


--
-- Name: focus_live_activities focus_live_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_live_activities
    ADD CONSTRAINT focus_live_activities_pkey PRIMARY KEY (id);


--
-- Name: focus_live_activities focus_live_activities_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_live_activities
    ADD CONSTRAINT focus_live_activities_session_id_key UNIQUE (session_id);


--
-- Name: focus_reward_accruals focus_reward_accruals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_reward_accruals
    ADD CONSTRAINT focus_reward_accruals_pkey PRIMARY KEY (id);


--
-- Name: focus_reward_accruals focus_reward_accruals_session_day_uk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_reward_accruals
    ADD CONSTRAINT focus_reward_accruals_session_day_uk UNIQUE (session_id, accrued_on);


--
-- Name: focus_reward_policies focus_reward_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_reward_policies
    ADD CONSTRAINT focus_reward_policies_pkey PRIMARY KEY (revision);


--
-- Name: focus_session_details focus_session_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_session_details
    ADD CONSTRAINT focus_session_details_pkey PRIMARY KEY (session_id);


--
-- Name: focus_session_intervals focus_session_intervals_ordinal_uk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_session_intervals
    ADD CONSTRAINT focus_session_intervals_ordinal_uk UNIQUE (session_id, ordinal);


--
-- Name: focus_session_intervals focus_session_intervals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_session_intervals
    ADD CONSTRAINT focus_session_intervals_pkey PRIMARY KEY (id);


--
-- Name: focus_sessions focus_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_sessions
    ADD CONSTRAINT focus_sessions_pkey PRIMARY KEY (id);


--
-- Name: focus_settlements focus_settlements_customization_reward_new_pair; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.focus_settlements
    ADD CONSTRAINT focus_settlements_customization_reward_new_pair CHECK (((customization_reward_revision IS NULL) = (customization_reward_new IS NULL))) NOT VALID;


--
-- Name: focus_settlements focus_settlements_customization_reward_pair; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.focus_settlements
    ADD CONSTRAINT focus_settlements_customization_reward_pair CHECK (((customization_reward_revision IS NULL) = (customization_reward_product_id IS NULL))) NOT VALID;


--
-- Name: focus_settlements focus_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_settlements
    ADD CONSTRAINT focus_settlements_pkey PRIMARY KEY (session_id);


--
-- Name: focus_statistics_snapshots focus_statistics_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_statistics_snapshots
    ADD CONSTRAINT focus_statistics_snapshots_pkey PRIMARY KEY (id);


--
-- Name: focus_tutorial_rewards focus_tutorial_rewards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_tutorial_rewards
    ADD CONSTRAINT focus_tutorial_rewards_pkey PRIMARY KEY (user_id);


--
-- Name: friendships friendships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_pkey PRIMARY KEY (id);


--
-- Name: group_announcement_comments group_announcement_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_announcement_comments
    ADD CONSTRAINT group_announcement_comments_pkey PRIMARY KEY (id);


--
-- Name: group_announcements group_announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_announcements
    ADD CONSTRAINT group_announcements_pkey PRIMARY KEY (id);


--
-- Name: group_invite_links group_invite_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_invite_links
    ADD CONSTRAINT group_invite_links_pkey PRIMARY KEY (id);


--
-- Name: group_invite_links group_invite_links_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_invite_links
    ADD CONSTRAINT group_invite_links_slug_key UNIQUE (slug);


--
-- Name: group_members group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_pkey PRIMARY KEY (id);


--
-- Name: islands groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.islands
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: guest_device_claims guest_device_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_device_claims
    ADD CONSTRAINT guest_device_claims_pkey PRIMARY KEY (device_digest);


--
-- Name: island_appearances island_appearances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_appearances
    ADD CONSTRAINT island_appearances_pkey PRIMARY KEY (island_id);


--
-- Name: island_arrivals island_arrivals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_arrivals
    ADD CONSTRAINT island_arrivals_pkey PRIMARY KEY (user_id, island_id);


--
-- Name: island_construction_contributions island_construction_contributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_construction_contributions
    ADD CONSTRAINT island_construction_contributions_pkey PRIMARY KEY (island_id, epoch, user_id);


--
-- Name: island_construction_states island_construction_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_construction_states
    ADD CONSTRAINT island_construction_states_pkey PRIMARY KEY (island_id);


--
-- Name: island_facilities island_facilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_facilities
    ADD CONSTRAINT island_facilities_pkey PRIMARY KEY (island_id, building_id);


--
-- Name: island_focus_averages island_focus_averages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_focus_averages
    ADD CONSTRAINT island_focus_averages_pkey PRIMARY KEY (snapshot_date, island_id);


--
-- Name: island_guestbook_entries island_guestbook_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_guestbook_entries
    ADD CONSTRAINT island_guestbook_entries_pkey PRIMARY KEY (id);


--
-- Name: island_join_requests island_join_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_join_requests
    ADD CONSTRAINT island_join_requests_pkey PRIMARY KEY (id);


--
-- Name: island_layouts island_layouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_layouts
    ADD CONSTRAINT island_layouts_pkey PRIMARY KEY (island_id);


--
-- Name: island_news island_news_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_news
    ADD CONSTRAINT island_news_pkey PRIMARY KEY (id);


--
-- Name: island_playbacks island_playbacks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_playbacks
    ADD CONSTRAINT island_playbacks_pkey PRIMARY KEY (island_id);


--
-- Name: island_promotion_reports island_promotion_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_promotion_reports
    ADD CONSTRAINT island_promotion_reports_pkey PRIMARY KEY (promotion_id, reporter_id);


--
-- Name: island_promotions island_promotions_island_id_issue_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_promotions
    ADD CONSTRAINT island_promotions_island_id_issue_date_key UNIQUE (island_id, issue_date);


--
-- Name: island_promotions island_promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_promotions
    ADD CONSTRAINT island_promotions_pkey PRIMARY KEY (id);


--
-- Name: island_quest_claims island_quest_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_quest_claims
    ADD CONSTRAINT island_quest_claims_pkey PRIMARY KEY (id);


--
-- Name: island_quest_cohort_members island_quest_cohort_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_quest_cohort_members
    ADD CONSTRAINT island_quest_cohort_members_pkey PRIMARY KEY (occurrence_id, user_id);


--
-- Name: island_quest_occurrences island_quest_occurrences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_quest_occurrences
    ADD CONSTRAINT island_quest_occurrences_pkey PRIMARY KEY (id);


--
-- Name: island_quests island_quests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_quests
    ADD CONSTRAINT island_quests_pkey PRIMARY KEY (id);


--
-- Name: island_wallet_transactions island_wallet_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_wallet_transactions
    ADD CONSTRAINT island_wallet_transactions_pkey PRIMARY KEY (id);


--
-- Name: island_wallets island_wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_wallets
    ADD CONSTRAINT island_wallets_pkey PRIMARY KEY (island_id);


--
-- Name: island_weekly_focus island_weekly_focus_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_weekly_focus
    ADD CONSTRAINT island_weekly_focus_pk PRIMARY KEY (week_start, island_id);


--
-- Name: island_weekly_member_counts island_weekly_member_counts_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_weekly_member_counts
    ADD CONSTRAINT island_weekly_member_counts_pk PRIMARY KEY (week_start, island_id);


--
-- Name: letters letters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.letters
    ADD CONSTRAINT letters_pkey PRIMARY KEY (id);


--
-- Name: login_attempts login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (attempt_id);


--
-- Name: magazine_asset_meta magazine_asset_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.magazine_asset_meta
    ADD CONSTRAINT magazine_asset_meta_pkey PRIMARY KEY (product_id);


--
-- Name: magazine_editorial_notes magazine_editorial_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.magazine_editorial_notes
    ADD CONSTRAINT magazine_editorial_notes_pkey PRIMARY KEY (issue_date);


--
-- Name: magazine_issues magazine_issues_issue_date_slot_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.magazine_issues
    ADD CONSTRAINT magazine_issues_issue_date_slot_key UNIQUE (issue_date, slot);


--
-- Name: magazine_issues magazine_issues_issue_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.magazine_issues
    ADD CONSTRAINT magazine_issues_issue_no_key UNIQUE (issue_no);


--
-- Name: magazine_issues magazine_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.magazine_issues
    ADD CONSTRAINT magazine_issues_pkey PRIMARY KEY (id);


--
-- Name: magazine_receipts magazine_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.magazine_receipts
    ADD CONSTRAINT magazine_receipts_pkey PRIMARY KEY (user_id, issue_id);


--
-- Name: onboarding_islands onboarding_islands_island_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_islands
    ADD CONSTRAINT onboarding_islands_island_id_key UNIQUE (island_id);


--
-- Name: onboarding_islands onboarding_islands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_islands
    ADD CONSTRAINT onboarding_islands_pkey PRIMARY KEY (user_id);


--
-- Name: owned_products owned_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owned_products
    ADD CONSTRAINT owned_products_pkey PRIMARY KEY (id);


--
-- Name: personal_appearances personal_appearances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_appearances
    ADD CONSTRAINT personal_appearances_pkey PRIMARY KEY (user_id);


--
-- Name: screen_time_observations screen_time_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.screen_time_observations
    ADD CONSTRAINT screen_time_observations_pkey PRIMARY KEY (id);


--
-- Name: sea_remarks sea_remarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sea_remarks
    ADD CONSTRAINT sea_remarks_pkey PRIMARY KEY (user_id);


--
-- Name: shedlock shedlock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shedlock
    ADD CONSTRAINT shedlock_pkey PRIMARY KEY (name);


--
-- Name: shop_catalog_active_publication shop_catalog_active_publication_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_catalog_active_publication
    ADD CONSTRAINT shop_catalog_active_publication_pkey PRIMARY KEY (singleton);


--
-- Name: shop_catalog_publication_entries shop_catalog_publication_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_catalog_publication_entries
    ADD CONSTRAINT shop_catalog_publication_entries_pkey PRIMARY KEY (publication_version, product_id);


--
-- Name: shop_catalog_publications shop_catalog_publications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_catalog_publications
    ADD CONSTRAINT shop_catalog_publications_pkey PRIMARY KEY (version);


--
-- Name: shop_orders shop_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_orders
    ADD CONSTRAINT shop_orders_pkey PRIMARY KEY (id);


--
-- Name: shop_product_revisions shop_product_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_product_revisions
    ADD CONSTRAINT shop_product_revisions_pkey PRIMARY KEY (product_id, revision);


--
-- Name: social_accounts social_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_accounts
    ADD CONSTRAINT social_accounts_pkey PRIMARY KEY (id);


--
-- Name: telescope_buckets telescope_buckets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telescope_buckets
    ADD CONSTRAINT telescope_buckets_pkey PRIMARY KEY (user_id, bucket_start);


--
-- Name: telescope_pins telescope_pins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telescope_pins
    ADD CONSTRAINT telescope_pins_pkey PRIMARY KEY (user_id, island_id);


--
-- Name: daily_focus_stats uk3cc32qmltjr6ytfg4jdequoed; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_focus_stats
    ADD CONSTRAINT uk3cc32qmltjr6ytfg4jdequoed UNIQUE (user_id, date);


--
-- Name: user_blocks uk_user_blocks_blocker_blocked; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT uk_user_blocks_blocker_blocked UNIQUE (blocker_id, blocked_id);


--
-- Name: friendships ukcw1b2t1f9600yhvikefbpd1gn; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT ukcw1b2t1f9600yhvikefbpd1gn UNIQUE (from_user_id, to_user_id);


--
-- Name: group_members ukp940p7g0r9yihubnf6rtaheog; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT ukp940p7g0r9yihubnf6rtaheog UNIQUE (user_id, group_id);


--
-- Name: group_invite_links uq_invite_links_group_inviter; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_invite_links
    ADD CONSTRAINT uq_invite_links_group_inviter UNIQUE (group_id, inviter_id);


--
-- Name: island_guestbook_entries uq_island_guestbook_day; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_guestbook_entries
    ADD CONSTRAINT uq_island_guestbook_day UNIQUE (island_id, author_id, written_on);


--
-- Name: island_quest_claims uq_island_quest_claim; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_quest_claims
    ADD CONSTRAINT uq_island_quest_claim UNIQUE (island_id, occurrence_id, kind, claimed_by);


--
-- Name: island_quest_occurrences uq_island_quest_occurrence; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_quest_occurrences
    ADD CONSTRAINT uq_island_quest_occurrence UNIQUE (quest_id, occurrence_date);


--
-- Name: island_wallet_transactions uq_island_wallet_tx_idem; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_wallet_transactions
    ADD CONSTRAINT uq_island_wallet_tx_idem UNIQUE (island_id, type, idempotency_key);


--
-- Name: screen_time_observations uq_screen_time_observation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.screen_time_observations
    ADD CONSTRAINT uq_screen_time_observation UNIQUE (user_id, device_id, measured_date, timezone, measured_at);


--
-- Name: social_accounts uq_social_accounts_provider_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_accounts
    ADD CONSTRAINT uq_social_accounts_provider_id UNIQUE (provider, provider_id);


--
-- Name: users uq_users_nickname; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_nickname UNIQUE (nickname);


--
-- Name: user_blocks user_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (id);


--
-- Name: user_fish_wallets user_fish_wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_fish_wallets
    ADD CONSTRAINT user_fish_wallets_pkey PRIMARY KEY (user_id);


--
-- Name: user_island_contexts user_island_contexts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_island_contexts
    ADD CONSTRAINT user_island_contexts_pkey PRIMARY KEY (user_id);


--
-- Name: user_main_islands user_main_islands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_main_islands
    ADD CONSTRAINT user_main_islands_pkey PRIMARY KEY (user_id);


--
-- Name: user_notification_settings user_notification_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notification_settings
    ADD CONSTRAINT user_notification_settings_pkey PRIMARY KEY (user_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: focus_live_activities_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX focus_live_activities_due_idx ON public.focus_live_activities USING btree (next_attempt_at);


--
-- Name: focus_reward_accruals_accrued_on_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX focus_reward_accruals_accrued_on_idx ON public.focus_reward_accruals USING btree (accrued_on);


--
-- Name: focus_session_details_rest_seat_uk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX focus_session_details_rest_seat_uk ON public.focus_session_details USING btree (island_id, rest_seat) WHERE ((lifecycle)::text = 'PAUSED'::text);


--
-- Name: focus_session_details_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX focus_session_details_user_id_idx ON public.focus_session_details USING btree (user_id);


--
-- Name: focus_session_details_user_island_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX focus_session_details_user_island_idx ON public.focus_session_details USING btree (user_id, island_id, session_id);


--
-- Name: focus_session_details_user_progressing_uk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX focus_session_details_user_progressing_uk ON public.focus_session_details USING btree (user_id) WHERE ((lifecycle)::text = ANY (ARRAY[('ACTIVE'::character varying)::text, ('PAUSED'::character varying)::text]));


--
-- Name: focus_session_details_user_transition_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX focus_session_details_user_transition_idx ON public.focus_session_details USING btree (user_id, island_id, last_transition_at);


--
-- Name: focus_session_intervals_active_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX focus_session_intervals_active_window_idx ON public.focus_session_intervals USING btree (started_at, ended_at) WHERE (((kind)::text = 'ACTIVE'::text) AND (ended_at IS NOT NULL));


--
-- Name: focus_session_intervals_open_uk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX focus_session_intervals_open_uk ON public.focus_session_intervals USING btree (session_id) WHERE (ended_at IS NULL);


--
-- Name: focus_settlements_completed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX focus_settlements_completed_at_idx ON public.focus_settlements USING btree (completed_at);


--
-- Name: group_members_active_group_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX group_members_active_group_user_idx ON public.group_members USING btree (group_id, user_id) WHERE (is_left = false);


--
-- Name: idx_auth_sessions_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_sessions_user_active ON public.auth_sessions USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_construction_guide_recipient_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_construction_guide_recipient_user ON public.construction_guide_recipients USING btree (user_id);


--
-- Name: idx_customization_reward_items_draw; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customization_reward_items_draw ON public.customization_reward_items USING btree (revision, category, rarity);


--
-- Name: idx_daily_focus_stats_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_focus_stats_date ON public.daily_focus_stats USING btree (date);


--
-- Name: idx_event_outbox_deliveries_ordering; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_outbox_deliveries_ordering ON public.event_outbox_deliveries USING btree (target, aggregate_type, aggregate_id, aggregate_version) WHERE (delivered_at IS NULL);


--
-- Name: idx_event_outbox_deliveries_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_outbox_deliveries_pending ON public.event_outbox_deliveries USING btree (target, next_attempt_at, lease_expires_at) WHERE (delivered_at IS NULL);


--
-- Name: idx_focus_sessions_live_marker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_focus_sessions_live_marker ON public.focus_sessions USING btree (user_id, started_at DESC) WHERE (ended_at IS NULL);


--
-- Name: idx_focus_statistics_snapshots_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_focus_statistics_snapshots_user ON public.focus_statistics_snapshots USING btree (user_id);


--
-- Name: idx_groups_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_groups_name_trgm ON public.islands USING gin (name public.gin_trgm_ops);


--
-- Name: idx_island_facilities_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_island_facilities_due ON public.island_facilities USING btree (completes_at) WHERE ((status)::text = 'BUILDING'::text);


--
-- Name: idx_island_quest_occurrences_bonus_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_island_quest_occurrences_bonus_pending ON public.island_quest_occurrences USING btree (occurrence_date) WHERE (bonus_settled_at IS NULL);


--
-- Name: idx_island_quest_occurrences_island_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_island_quest_occurrences_island_date ON public.island_quest_occurrences USING btree (island_id, occurrence_date);


--
-- Name: idx_island_quests_island; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_island_quests_island ON public.island_quests USING btree (island_id);


--
-- Name: idx_letters_receiver_cursor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_letters_receiver_cursor ON public.letters USING btree (receiver_id, id DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_letters_sender_cursor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_letters_sender_cursor ON public.letters USING btree (sender_id, id DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_owned_products_island; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_owned_products_island ON public.owned_products USING btree (group_id) WHERE ((owner_type)::text = 'island'::text);


--
-- Name: idx_owned_products_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_owned_products_user ON public.owned_products USING btree (user_id) WHERE ((owner_type)::text = 'user'::text);


--
-- Name: idx_screen_time_observations_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_screen_time_observations_user_date ON public.screen_time_observations USING btree (user_id, measured_date);


--
-- Name: idx_shop_catalog_entries_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shop_catalog_entries_page ON public.shop_catalog_publication_entries USING btree (publication_version, category, display_order, product_id);


--
-- Name: idx_shop_orders_island; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shop_orders_island ON public.shop_orders USING btree (island_id, created_at DESC, id DESC);


--
-- Name: idx_shop_orders_island_requester; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shop_orders_island_requester ON public.shop_orders USING btree (island_id, requester_id, created_at DESC, id DESC);


--
-- Name: idx_users_nickname_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_nickname_trgm ON public.users USING gin (nickname public.gin_trgm_ops);


--
-- Name: island_arrivals_island_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX island_arrivals_island_idx ON public.island_arrivals USING btree (island_id);


--
-- Name: island_focus_averages_island_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX island_focus_averages_island_date_idx ON public.island_focus_averages USING btree (island_id, snapshot_date DESC);


--
-- Name: island_guestbook_island_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX island_guestbook_island_created_idx ON public.island_guestbook_entries USING btree (island_id, created_at DESC);


--
-- Name: island_guestbook_live_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX island_guestbook_live_recent_idx ON public.island_guestbook_entries USING btree (island_id, created_at DESC, id DESC) WHERE (deleted_at IS NULL);


--
-- Name: island_news_island_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX island_news_island_created_idx ON public.island_news USING btree (island_id, created_at DESC);


--
-- Name: island_promotions_issue_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX island_promotions_issue_order_idx ON public.island_promotions USING btree (issue_date, applied_at, id);


--
-- Name: ix_focus_tutorial_rewards_island; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_focus_tutorial_rewards_island ON public.focus_tutorial_rewards USING btree (island_id) WHERE (session_id IS NULL);


--
-- Name: ix_group_announcement_comments_notice_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_group_announcement_comments_notice_created ON public.group_announcement_comments USING btree (notice_id, created_at, id);


--
-- Name: ix_group_announcements_group_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_group_announcements_group_created ON public.group_announcements USING btree (group_id, created_at, id);


--
-- Name: ix_island_join_requests_applicant_island; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_island_join_requests_applicant_island ON public.island_join_requests USING btree (applicant_id, island_id, created_at);


--
-- Name: letters_receiver_system_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX letters_receiver_system_idx ON public.letters USING btree (receiver_id, id DESC) WHERE ((deleted_at IS NULL) AND ((kind)::text <> 'FRIEND'::text));


--
-- Name: magazine_receipts_issue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX magazine_receipts_issue_idx ON public.magazine_receipts USING btree (issue_id);


--
-- Name: telescope_pins_user_pinned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telescope_pins_user_pinned_idx ON public.telescope_pins USING btree (user_id, pinned_at);


--
-- Name: uq_auth_sessions_bootstrap_nonce_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_auth_sessions_bootstrap_nonce_hash ON public.auth_sessions USING btree (bootstrap_nonce_hash) WHERE (bootstrap_nonce_hash IS NOT NULL);


--
-- Name: uq_auth_sessions_refresh_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_auth_sessions_refresh_token_hash ON public.auth_sessions USING btree (refresh_token_hash);


--
-- Name: uq_event_outbox_aggregate_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_event_outbox_aggregate_version ON public.event_outbox USING btree (aggregate_type, aggregate_id, version);


--
-- Name: uq_event_outbox_deliveries_outbox_target; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_event_outbox_deliveries_outbox_target ON public.event_outbox_deliveries USING btree (outbox_id, target);


--
-- Name: uq_event_outbox_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_event_outbox_event_id ON public.event_outbox USING btree (event_id);


--
-- Name: uq_friendships_pending_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_friendships_pending_pair ON public.friendships USING btree (LEAST(from_user_id, to_user_id), GREATEST(from_user_id, to_user_id)) WHERE (((status)::text = 'PENDING'::text) AND (deleted_at IS NULL));


--
-- Name: INDEX uq_friendships_pending_pair; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_friendships_pending_pair IS '살아 있는 PENDING 요청은 두 사람당 한 건 (GROMO-2042). 방향 무관 — A→B 와 B→A 동시 요청의 마지막 방어선이다. 같은 방향 중복은 V1 의 unique(from_user_id, to_user_id) 가 막는다.';


--
-- Name: uq_island_join_requests_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_island_join_requests_pending ON public.island_join_requests USING btree (island_id, applicant_id) WHERE ((status)::text = 'PENDING'::text);


--
-- Name: uq_owned_products_island; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_owned_products_island ON public.owned_products USING btree (group_id, product_id) WHERE ((owner_type)::text = 'island'::text);


--
-- Name: uq_owned_products_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_owned_products_user ON public.owned_products USING btree (user_id, product_id) WHERE ((owner_type)::text = 'user'::text);


--
-- Name: uq_users_nickname_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_users_nickname_lower ON public.users USING btree (lower((nickname)::text));


--
-- Name: INDEX uq_users_nickname_lower; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_users_nickname_lower IS '닉네임 대소문자 무시 유일성 + 친구 검색(정확 일치) 인덱스 (GROMO-1996). 탈퇴자는 nickname=NULL 이라 걸리지 않는다.';


--
-- Name: focus_settlements focus_settlements_mirror_accrual_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER focus_settlements_mirror_accrual_trg AFTER INSERT ON public.focus_settlements FOR EACH ROW EXECUTE FUNCTION public.focus_settlements_mirror_accrual();


--
-- Name: audio_tracks audio_tracks_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_tracks
    ADD CONSTRAINT audio_tracks_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.catalog_assets(product_id) ON DELETE RESTRICT;


--
-- Name: construction_guide_recipients construction_guide_recipients_island_id_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.construction_guide_recipients
    ADD CONSTRAINT construction_guide_recipients_island_id_building_id_fkey FOREIGN KEY (island_id, building_id) REFERENCES public.island_facilities(island_id, building_id) ON DELETE CASCADE;


--
-- Name: construction_guide_recipients construction_guide_recipients_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.construction_guide_recipients
    ADD CONSTRAINT construction_guide_recipients_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: customization_asset_meta customization_asset_meta_catalog_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customization_asset_meta
    ADD CONSTRAINT customization_asset_meta_catalog_fk FOREIGN KEY (product_id, kind) REFERENCES public.catalog_assets(product_id, kind) ON DELETE RESTRICT;


--
-- Name: customization_reward_items customization_reward_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customization_reward_items
    ADD CONSTRAINT customization_reward_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.catalog_assets(product_id) ON DELETE RESTRICT;


--
-- Name: customization_reward_items customization_reward_items_revision_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customization_reward_items
    ADD CONSTRAINT customization_reward_items_revision_fkey FOREIGN KEY (revision) REFERENCES public.customization_reward_policies(revision) ON DELETE RESTRICT;


--
-- Name: daily_focus_stats fk4xfwxti5vn20h1pnqy7hqn1fl; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_focus_stats
    ADD CONSTRAINT fk4xfwxti5vn20h1pnqy7hqn1fl FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: social_accounts fk6rmxxiton5yuvu7ph2hcq2xn7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_accounts
    ADD CONSTRAINT fk6rmxxiton5yuvu7ph2hcq2xn7 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: friendships fk7wivqdjj4f0brp5prrcanq26y; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT fk7wivqdjj4f0brp5prrcanq26y FOREIGN KEY (to_user_id) REFERENCES public.users(id);


--
-- Name: event_outbox_deliveries fk_event_outbox_deliveries_outbox; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_outbox_deliveries
    ADD CONSTRAINT fk_event_outbox_deliveries_outbox FOREIGN KEY (outbox_id) REFERENCES public.event_outbox(id) ON DELETE CASCADE;


--
-- Name: focus_sessions fkcjt1qit8ck1qmkfpjiocf322d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_sessions
    ADD CONSTRAINT fkcjt1qit8ck1qmkfpjiocf322d FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: group_announcements fkfhcs6ts17lpswq2bp0u15946m; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_announcements
    ADD CONSTRAINT fkfhcs6ts17lpswq2bp0u15946m FOREIGN KEY (group_id) REFERENCES public.islands(id);


--
-- Name: group_members fkkv9vlrye4rmhqjq4qohy2n5a6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT fkkv9vlrye4rmhqjq4qohy2n5a6 FOREIGN KEY (group_id) REFERENCES public.islands(id);


--
-- Name: group_announcements fkl9c1ccy9jc5b8mbgygtmynn0j; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_announcements
    ADD CONSTRAINT fkl9c1ccy9jc5b8mbgygtmynn0j FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: friendships fkm3dq1nlwax8uwswk9sk6lli7e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT fkm3dq1nlwax8uwswk9sk6lli7e FOREIGN KEY (from_user_id) REFERENCES public.users(id);


--
-- Name: group_members fknr9qg33qt2ovmv29g4vc3gtdx; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT fknr9qg33qt2ovmv29g4vc3gtdx FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: focus_live_activities focus_live_activities_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_live_activities
    ADD CONSTRAINT focus_live_activities_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.focus_session_details(session_id) ON DELETE CASCADE;


--
-- Name: focus_live_activities focus_live_activities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_live_activities
    ADD CONSTRAINT focus_live_activities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: focus_reward_accruals focus_reward_accruals_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_reward_accruals
    ADD CONSTRAINT focus_reward_accruals_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.focus_session_details(session_id) ON DELETE CASCADE;


--
-- Name: focus_session_details focus_session_details_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_session_details
    ADD CONSTRAINT focus_session_details_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE RESTRICT;


--
-- Name: focus_session_details focus_session_details_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_session_details
    ADD CONSTRAINT focus_session_details_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.focus_sessions(id) ON DELETE CASCADE;


--
-- Name: focus_session_details focus_session_details_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_session_details
    ADD CONSTRAINT focus_session_details_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: focus_session_intervals focus_session_intervals_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_session_intervals
    ADD CONSTRAINT focus_session_intervals_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.focus_session_details(session_id) ON DELETE CASCADE;


--
-- Name: focus_settlements focus_settlements_customization_reward_item_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_settlements
    ADD CONSTRAINT focus_settlements_customization_reward_item_fk FOREIGN KEY (customization_reward_revision, customization_reward_product_id) REFERENCES public.customization_reward_items(revision, product_id) ON DELETE RESTRICT NOT VALID;


--
-- Name: focus_settlements focus_settlements_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_settlements
    ADD CONSTRAINT focus_settlements_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.focus_session_details(session_id) ON DELETE RESTRICT;


--
-- Name: focus_statistics_snapshots focus_statistics_snapshots_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_statistics_snapshots
    ADD CONSTRAINT focus_statistics_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: focus_tutorial_rewards focus_tutorial_rewards_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_tutorial_rewards
    ADD CONSTRAINT focus_tutorial_rewards_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE SET NULL;


--
-- Name: focus_tutorial_rewards focus_tutorial_rewards_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_tutorial_rewards
    ADD CONSTRAINT focus_tutorial_rewards_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: group_announcement_comments group_announcement_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_announcement_comments
    ADD CONSTRAINT group_announcement_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: group_announcement_comments group_announcement_comments_notice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_announcement_comments
    ADD CONSTRAINT group_announcement_comments_notice_id_fkey FOREIGN KEY (notice_id) REFERENCES public.group_announcements(id) ON DELETE CASCADE;


--
-- Name: group_invite_links group_invite_links_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_invite_links
    ADD CONSTRAINT group_invite_links_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.islands(id);


--
-- Name: group_invite_links group_invite_links_inviter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_invite_links
    ADD CONSTRAINT group_invite_links_inviter_id_fkey FOREIGN KEY (inviter_id) REFERENCES public.users(id);


--
-- Name: guest_device_claims guest_device_claims_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_device_claims
    ADD CONSTRAINT guest_device_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: island_appearances island_appearances_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_appearances
    ADD CONSTRAINT island_appearances_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE RESTRICT;


--
-- Name: island_arrivals island_arrivals_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_arrivals
    ADD CONSTRAINT island_arrivals_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE CASCADE;


--
-- Name: island_arrivals island_arrivals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_arrivals
    ADD CONSTRAINT island_arrivals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: island_construction_contributions island_construction_contributions_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_construction_contributions
    ADD CONSTRAINT island_construction_contributions_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.island_construction_states(island_id) ON DELETE RESTRICT;


--
-- Name: island_construction_contributions island_construction_contributions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_construction_contributions
    ADD CONSTRAINT island_construction_contributions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: island_construction_states island_construction_states_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_construction_states
    ADD CONSTRAINT island_construction_states_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE RESTRICT;


--
-- Name: island_facilities island_facilities_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_facilities
    ADD CONSTRAINT island_facilities_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE RESTRICT;


--
-- Name: island_focus_averages island_focus_averages_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_focus_averages
    ADD CONSTRAINT island_focus_averages_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE CASCADE;


--
-- Name: island_guestbook_entries island_guestbook_entries_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_guestbook_entries
    ADD CONSTRAINT island_guestbook_entries_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: island_guestbook_entries island_guestbook_entries_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_guestbook_entries
    ADD CONSTRAINT island_guestbook_entries_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE CASCADE;


--
-- Name: island_join_requests island_join_requests_applicant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_join_requests
    ADD CONSTRAINT island_join_requests_applicant_id_fkey FOREIGN KEY (applicant_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: island_join_requests island_join_requests_invite_link_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_join_requests
    ADD CONSTRAINT island_join_requests_invite_link_id_fkey FOREIGN KEY (invite_link_id) REFERENCES public.group_invite_links(id) ON DELETE RESTRICT;


--
-- Name: island_join_requests island_join_requests_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_join_requests
    ADD CONSTRAINT island_join_requests_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE RESTRICT;


--
-- Name: island_layouts island_layouts_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_layouts
    ADD CONSTRAINT island_layouts_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE RESTRICT;


--
-- Name: island_news island_news_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_news
    ADD CONSTRAINT island_news_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE CASCADE;


--
-- Name: island_playbacks island_playbacks_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_playbacks
    ADD CONSTRAINT island_playbacks_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: island_playbacks island_playbacks_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_playbacks
    ADD CONSTRAINT island_playbacks_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE RESTRICT;


--
-- Name: island_playbacks island_playbacks_track_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_playbacks
    ADD CONSTRAINT island_playbacks_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.audio_tracks(product_id) ON DELETE RESTRICT;


--
-- Name: island_promotion_reports island_promotion_reports_promotion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_promotion_reports
    ADD CONSTRAINT island_promotion_reports_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.island_promotions(id) ON DELETE CASCADE;


--
-- Name: island_promotion_reports island_promotion_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_promotion_reports
    ADD CONSTRAINT island_promotion_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: island_promotions island_promotions_applied_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_promotions
    ADD CONSTRAINT island_promotions_applied_by_fkey FOREIGN KEY (applied_by) REFERENCES public.users(id);


--
-- Name: island_promotions island_promotions_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_promotions
    ADD CONSTRAINT island_promotions_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE CASCADE;


--
-- Name: island_quest_claims island_quest_claims_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_quest_claims
    ADD CONSTRAINT island_quest_claims_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE RESTRICT;


--
-- Name: island_quest_claims island_quest_claims_occurrence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_quest_claims
    ADD CONSTRAINT island_quest_claims_occurrence_id_fkey FOREIGN KEY (occurrence_id) REFERENCES public.island_quest_occurrences(id) ON DELETE RESTRICT;


--
-- Name: island_quest_cohort_members island_quest_cohort_members_occurrence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_quest_cohort_members
    ADD CONSTRAINT island_quest_cohort_members_occurrence_id_fkey FOREIGN KEY (occurrence_id) REFERENCES public.island_quest_occurrences(id) ON DELETE RESTRICT;


--
-- Name: island_quest_occurrences island_quest_occurrences_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_quest_occurrences
    ADD CONSTRAINT island_quest_occurrences_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE RESTRICT;


--
-- Name: island_quest_occurrences island_quest_occurrences_quest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_quest_occurrences
    ADD CONSTRAINT island_quest_occurrences_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES public.island_quests(id) ON DELETE RESTRICT;


--
-- Name: island_quests island_quests_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_quests
    ADD CONSTRAINT island_quests_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE RESTRICT;


--
-- Name: island_wallet_transactions island_wallet_transactions_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_wallet_transactions
    ADD CONSTRAINT island_wallet_transactions_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.island_wallets(island_id) ON DELETE RESTRICT;


--
-- Name: island_wallets island_wallets_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_wallets
    ADD CONSTRAINT island_wallets_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE RESTRICT;


--
-- Name: island_weekly_member_counts island_weekly_member_counts_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.island_weekly_member_counts
    ADD CONSTRAINT island_weekly_member_counts_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE CASCADE;


--
-- Name: letters letters_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.letters
    ADD CONSTRAINT letters_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE SET NULL;


--
-- Name: letters letters_receiver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.letters
    ADD CONSTRAINT letters_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: letters letters_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.letters
    ADD CONSTRAINT letters_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: magazine_asset_meta magazine_asset_meta_catalog_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.magazine_asset_meta
    ADD CONSTRAINT magazine_asset_meta_catalog_fk FOREIGN KEY (product_id, kind) REFERENCES public.catalog_assets(product_id, kind) ON DELETE RESTRICT;


--
-- Name: magazine_receipts magazine_receipts_issue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.magazine_receipts
    ADD CONSTRAINT magazine_receipts_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.magazine_issues(id) ON DELETE CASCADE;


--
-- Name: magazine_receipts magazine_receipts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.magazine_receipts
    ADD CONSTRAINT magazine_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: onboarding_islands onboarding_islands_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_islands
    ADD CONSTRAINT onboarding_islands_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE CASCADE;


--
-- Name: onboarding_islands onboarding_islands_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_islands
    ADD CONSTRAINT onboarding_islands_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: owned_products owned_products_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owned_products
    ADD CONSTRAINT owned_products_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.islands(id) ON DELETE RESTRICT;


--
-- Name: owned_products owned_products_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owned_products
    ADD CONSTRAINT owned_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.catalog_assets(product_id) ON DELETE RESTRICT;


--
-- Name: owned_products owned_products_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owned_products
    ADD CONSTRAINT owned_products_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: personal_appearances personal_appearances_clothes_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_appearances
    ADD CONSTRAINT personal_appearances_clothes_fkey FOREIGN KEY (clothes) REFERENCES public.catalog_assets(product_id) ON DELETE RESTRICT;


--
-- Name: personal_appearances personal_appearances_decor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_appearances
    ADD CONSTRAINT personal_appearances_decor_fkey FOREIGN KEY (decor) REFERENCES public.catalog_assets(product_id) ON DELETE RESTRICT;


--
-- Name: personal_appearances personal_appearances_head_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_appearances
    ADD CONSTRAINT personal_appearances_head_fkey FOREIGN KEY (head) REFERENCES public.catalog_assets(product_id) ON DELETE RESTRICT;


--
-- Name: personal_appearances personal_appearances_neck_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_appearances
    ADD CONSTRAINT personal_appearances_neck_fkey FOREIGN KEY (neck) REFERENCES public.catalog_assets(product_id) ON DELETE RESTRICT;


--
-- Name: personal_appearances personal_appearances_shoes_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_appearances
    ADD CONSTRAINT personal_appearances_shoes_fkey FOREIGN KEY (shoes) REFERENCES public.catalog_assets(product_id) ON DELETE RESTRICT;


--
-- Name: personal_appearances personal_appearances_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_appearances
    ADD CONSTRAINT personal_appearances_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: screen_time_observations screen_time_observations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.screen_time_observations
    ADD CONSTRAINT screen_time_observations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: sea_remarks sea_remarks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sea_remarks
    ADD CONSTRAINT sea_remarks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: shop_catalog_active_publication shop_catalog_active_publication_publication_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_catalog_active_publication
    ADD CONSTRAINT shop_catalog_active_publication_publication_version_fkey FOREIGN KEY (publication_version) REFERENCES public.shop_catalog_publications(version) ON DELETE RESTRICT;


--
-- Name: shop_catalog_publication_entries shop_catalog_publication_entri_product_id_product_revision_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_catalog_publication_entries
    ADD CONSTRAINT shop_catalog_publication_entri_product_id_product_revision_fkey FOREIGN KEY (product_id, product_revision) REFERENCES public.shop_product_revisions(product_id, revision) ON DELETE RESTRICT;


--
-- Name: shop_catalog_publication_entries shop_catalog_publication_entries_publication_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_catalog_publication_entries
    ADD CONSTRAINT shop_catalog_publication_entries_publication_version_fkey FOREIGN KEY (publication_version) REFERENCES public.shop_catalog_publications(version) ON DELETE RESTRICT;


--
-- Name: shop_orders shop_orders_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_orders
    ADD CONSTRAINT shop_orders_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE RESTRICT;


--
-- Name: shop_orders shop_orders_payer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_orders
    ADD CONSTRAINT shop_orders_payer_user_id_fkey FOREIGN KEY (payer_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: shop_orders shop_orders_product_id_product_revision_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_orders
    ADD CONSTRAINT shop_orders_product_id_product_revision_fkey FOREIGN KEY (product_id, product_revision) REFERENCES public.shop_product_revisions(product_id, revision) ON DELETE RESTRICT;


--
-- Name: shop_orders shop_orders_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_orders
    ADD CONSTRAINT shop_orders_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: shop_product_revisions shop_product_revisions_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_product_revisions
    ADD CONSTRAINT shop_product_revisions_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.catalog_assets(product_id) ON DELETE RESTRICT;


--
-- Name: shop_product_revisions shop_product_revisions_required_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_product_revisions
    ADD CONSTRAINT shop_product_revisions_required_product_id_fkey FOREIGN KEY (required_product_id) REFERENCES public.catalog_assets(product_id) ON DELETE RESTRICT;


--
-- Name: telescope_buckets telescope_buckets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telescope_buckets
    ADD CONSTRAINT telescope_buckets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: telescope_pins telescope_pins_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telescope_pins
    ADD CONSTRAINT telescope_pins_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE CASCADE;


--
-- Name: telescope_pins telescope_pins_promotion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telescope_pins
    ADD CONSTRAINT telescope_pins_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.island_promotions(id) ON DELETE SET NULL;


--
-- Name: telescope_pins telescope_pins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telescope_pins
    ADD CONSTRAINT telescope_pins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_blocks user_blocks_blocked_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.users(id);


--
-- Name: user_blocks user_blocks_blocker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.users(id);


--
-- Name: user_fish_wallets user_fish_wallets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_fish_wallets
    ADD CONSTRAINT user_fish_wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_island_contexts user_island_contexts_current_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_island_contexts
    ADD CONSTRAINT user_island_contexts_current_island_id_fkey FOREIGN KEY (current_island_id) REFERENCES public.islands(id) ON DELETE SET NULL;


--
-- Name: user_island_contexts user_island_contexts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_island_contexts
    ADD CONSTRAINT user_island_contexts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_main_islands user_main_islands_island_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_main_islands
    ADD CONSTRAINT user_main_islands_island_id_fkey FOREIGN KEY (island_id) REFERENCES public.islands(id) ON DELETE CASCADE;


--
-- Name: user_main_islands user_main_islands_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_main_islands
    ADD CONSTRAINT user_main_islands_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--
