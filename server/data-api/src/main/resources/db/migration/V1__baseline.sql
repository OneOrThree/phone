-- V1 베이스라인 (GROMO-670) — 현재 실 DB 스냅샷.
-- 생성: 빈 로컬 DB 에 엔티티(ddl-auto=update)로 스키마 생성 + pg_trgm 확장·닉네임 trgm 인덱스(GROMO-460) 수동 추가
--       → pg_dump --schema-only --no-owner --no-privileges. dev/prod 를 만드는 방식과 동일(엔티티 파생 + 아티팩트).
-- 정리: pg_dump 의 \restrict / \unrestrict psql 메타명령 제거(Flyway 는 JDBC 실행이라 백슬래시 명령 불가).
-- ※ 베이스라인 특성상 한 번 배포되면 수정 금지 — 오류는 V2 로 보정. dbml 정합은 후속 티켓 671~676(V2+).

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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: character_equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.character_equipment (
    id uuid NOT NULL,
    equipped_at timestamp(6) with time zone,
    slot_type character varying(255) NOT NULL,
    item_id uuid NOT NULL,
    user_id uuid NOT NULL,
    CONSTRAINT character_equipment_slot_type_check CHECK (((slot_type)::text = ANY ((ARRAY['HAIR'::character varying, 'TOP'::character varying, 'BOTTOM'::character varying, 'SHOES'::character varying])::text[])))
);


--
-- Name: currency_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currency_transactions (
    id uuid NOT NULL,
    amount integer NOT NULL,
    reason character varying(255) NOT NULL,
    transacted_at timestamp(6) with time zone,
    type character varying(255) NOT NULL,
    user_id uuid NOT NULL,
    CONSTRAINT currency_transactions_reason_check CHECK (((reason)::text = ANY ((ARRAY['SESSION_COMPLETE'::character varying, 'STREAK_BONUS'::character varying, 'PURCHASE'::character varying])::text[]))),
    CONSTRAINT currency_transactions_type_check CHECK (((type)::text = ANY ((ARRAY['EARN'::character varying, 'SPEND'::character varying])::text[])))
);


--
-- Name: daily_focus_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_focus_stats (
    id uuid NOT NULL,
    date date NOT NULL,
    distraction_count integer NOT NULL,
    focus_goal_achieved boolean NOT NULL,
    session_count integer NOT NULL,
    total_focus_seconds integer NOT NULL,
    updated_at timestamp(6) with time zone,
    user_id uuid
);


--
-- Name: daily_screen_time_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_screen_time_stats (
    id uuid NOT NULL,
    actual_screen_time_minutes integer NOT NULL,
    created_at timestamp(6) with time zone,
    date date NOT NULL,
    screen_time_goal_achieved boolean NOT NULL,
    updated_at timestamp(6) with time zone,
    user_id uuid
);


--
-- Name: focus_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.focus_sessions (
    id uuid NOT NULL,
    deleted_at timestamp(6) with time zone,
    distraction_count integer NOT NULL,
    ended_at timestamp(6) with time zone,
    local_date date,
    started_at timestamp(6) with time zone NOT NULL,
    subject character varying(255),
    total_distraction_seconds integer NOT NULL,
    focus_tag_id uuid,
    user_id uuid
);


--
-- Name: focus_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.focus_tags (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone,
    deleted_at timestamp(6) with time zone,
    name character varying(255) NOT NULL,
    user_id uuid NOT NULL
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
    CONSTRAINT friendships_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'ACCEPTED'::character varying, 'REJECTED'::character varying])::text[])))
);


--
-- Name: group_announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_announcements (
    id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp(6) with time zone NOT NULL,
    title character varying(100) NOT NULL,
    updated_at timestamp(6) with time zone,
    author_id uuid,
    group_id uuid NOT NULL
);


--
-- Name: group_challenge_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_challenge_members (
    id uuid NOT NULL,
    achieved_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone NOT NULL,
    deleted_at timestamp(6) with time zone,
    is_achieved boolean NOT NULL,
    progress_minutes integer NOT NULL,
    updated_at timestamp(6) with time zone,
    group_challenge_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: group_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_challenges (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone NOT NULL,
    duration_minutes integer,
    mission_category character varying(255) NOT NULL,
    mission_type character varying(255) NOT NULL,
    status character varying(255) NOT NULL,
    time_zone character varying(255),
    window_end timestamp(6) with time zone,
    window_start timestamp(6) with time zone,
    group_id uuid NOT NULL,
    CONSTRAINT group_challenges_mission_category_check CHECK (((mission_category)::text = ANY ((ARRAY['FOCUS'::character varying, 'SCREEN_TIME'::character varying])::text[]))),
    CONSTRAINT group_challenges_mission_type_check CHECK (((mission_type)::text = ANY ((ARRAY['TIME_WINDOW'::character varying, 'DURATION'::character varying])::text[]))),
    CONSTRAINT group_challenges_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'ENDED'::character varying])::text[])))
);


--
-- Name: group_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_invites (
    id uuid NOT NULL,
    invited_at timestamp(6) with time zone,
    responded_at timestamp(6) with time zone,
    status character varying(255) NOT NULL,
    group_id uuid NOT NULL,
    invitee_id uuid NOT NULL,
    inviter_id uuid NOT NULL,
    CONSTRAINT group_invites_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'ACCEPTED'::character varying, 'DECLINED'::character varying])::text[])))
);


--
-- Name: group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_members (
    id uuid NOT NULL,
    completed_at timestamp(6) with time zone,
    joined_at timestamp(6) with time zone,
    notification_enabled boolean NOT NULL,
    role character varying(10) NOT NULL,
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    CONSTRAINT group_members_role_check CHECK (((role)::text = ANY ((ARRAY['OWNER'::character varying, 'MEMBER'::character varying])::text[])))
);


--
-- Name: group_notice_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_notice_grants (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    group_id uuid NOT NULL
);


--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id uuid NOT NULL,
    bet_type character varying(255) NOT NULL,
    chat_enabled boolean NOT NULL,
    chat_limit_per_person integer,
    code character varying(8),
    code_expires_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone,
    description character varying(200),
    duration_minutes integer,
    ended_at timestamp(6) with time zone,
    host_id uuid,
    invite_permission character varying(20) NOT NULL,
    max_members integer NOT NULL,
    mission_category character varying(255) NOT NULL,
    mission_type character varying(255) NOT NULL,
    name character varying(50) NOT NULL,
    notice_permission character varying(20) NOT NULL,
    password character varying(100),
    started_at timestamp(6) with time zone,
    status character varying(255) NOT NULL,
    version bigint,
    window_end timestamp(6) with time zone,
    window_start timestamp(6) with time zone,
    CONSTRAINT groups_bet_type_check CHECK (((bet_type)::text = ANY ((ARRAY['CASH'::character varying, 'CURRENCY'::character varying, 'NONE'::character varying])::text[]))),
    CONSTRAINT groups_invite_permission_check CHECK (((invite_permission)::text = ANY ((ARRAY['OWNER_ONLY'::character varying, 'ALL_MEMBERS'::character varying])::text[]))),
    CONSTRAINT groups_mission_category_check CHECK (((mission_category)::text = ANY ((ARRAY['FOCUS'::character varying, 'SCREEN_TIME'::character varying])::text[]))),
    CONSTRAINT groups_mission_type_check CHECK (((mission_type)::text = ANY ((ARRAY['TIME_WINDOW'::character varying, 'DURATION'::character varying])::text[]))),
    CONSTRAINT groups_notice_permission_check CHECK (((notice_permission)::text = ANY ((ARRAY['OWNER_ONLY'::character varying, 'ALL_MEMBERS'::character varying])::text[]))),
    CONSTRAINT groups_status_check CHECK (((status)::text = ANY ((ARRAY['WAITING'::character varying, 'ACTIVE'::character varying, 'ENDED'::character varying, 'CLOSED'::character varying])::text[])))
);


--
-- Name: items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.items (
    id uuid NOT NULL,
    asset_address character varying(255),
    currency_price integer,
    item_type character varying(255) NOT NULL,
    name character varying(255),
    premium_price integer,
    price_type character varying(255) NOT NULL,
    rarity character varying(255) NOT NULL,
    slot_type character varying(255),
    CONSTRAINT items_item_type_check CHECK (((item_type)::text = ANY ((ARRAY['EQUIPPABLE'::character varying, 'DECORATIVE'::character varying])::text[]))),
    CONSTRAINT items_price_type_check CHECK (((price_type)::text = ANY ((ARRAY['CURRENCY'::character varying, 'PREMIUM'::character varying, 'BOTH'::character varying])::text[]))),
    CONSTRAINT items_rarity_check CHECK (((rarity)::text = ANY ((ARRAY['COMMON'::character varying, 'UNCOMMON'::character varying, 'RARE'::character varying, 'LEGENDARY'::character varying])::text[]))),
    CONSTRAINT items_slot_type_check CHECK (((slot_type)::text = ANY ((ARRAY['HAIR'::character varying, 'TOP'::character varying, 'BOTTOM'::character varying, 'SHOES'::character varying])::text[])))
);


--
-- Name: league_arena_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_arena_users (
    id uuid NOT NULL,
    rank integer,
    result character varying(255),
    tier_level integer NOT NULL,
    total_focus_minutes integer NOT NULL,
    league_arena_id uuid NOT NULL,
    user_id uuid NOT NULL,
    CONSTRAINT league_arena_users_result_check CHECK (((result)::text = ANY ((ARRAY['PROMOTED'::character varying, 'STAY'::character varying, 'RELEGATE_WARNING'::character varying, 'RELEGATED'::character varying])::text[])))
);


--
-- Name: league_arenas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_arenas (
    id uuid NOT NULL,
    ended_at timestamp(6) with time zone,
    status character varying(255) NOT NULL,
    week_start_at timestamp(6) with time zone NOT NULL,
    tier_level integer NOT NULL,
    CONSTRAINT league_arenas_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'ENDED'::character varying])::text[])))
);


--
-- Name: league_rank_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_rank_snapshots (
    id uuid NOT NULL,
    arena_id uuid NOT NULL,
    captured_on date NOT NULL,
    rank integer NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: league_tier_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_tier_configs (
    tier_level integer NOT NULL,
    arena_size integer NOT NULL,
    badge_id character varying(255) NOT NULL,
    created_at timestamp(6) with time zone,
    deleted_at timestamp(6) with time zone,
    promote_count integer NOT NULL,
    relegate_count integer NOT NULL,
    relegate_warning_count integer NOT NULL,
    updated_at timestamp(6) with time zone
);


--
-- Name: notification_sent_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_sent_logs (
    id uuid NOT NULL,
    sent_at timestamp(6) with time zone NOT NULL,
    target_user_id uuid,
    type character varying(255) NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: occupation_default_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.occupation_default_tags (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone,
    name character varying(255) NOT NULL,
    occupation character varying(255) NOT NULL,
    sort_order integer NOT NULL,
    CONSTRAINT occupation_default_tags_occupation_check CHECK (((occupation)::text = ANY ((ARRAY['LABOR_ATTORNEY'::character varying, 'PATENT_ATTORNEY'::character varying, 'TAX_ACCOUNTANT'::character varying, 'CPA'::character varying, 'APPRAISER'::character varying, 'CIVIL_SERVANT'::character varying, 'POLICE_FIRE'::character varying, 'ADMIN_EXAM'::character varying, 'CERTIFICATION'::character varying, 'MIDDLE_SCHOOL'::character varying, 'HIGH_SCHOOL'::character varying, 'CSAT'::character varying, 'UNIVERSITY'::character varying, 'JOB_PREP'::character varying, 'ENGLISH_TEST'::character varying, 'CODING'::character varying, 'SELF_DEVELOPMENT'::character varying, 'FOCUS_BUILDING'::character varying, 'ETC'::character varying])::text[])))
);


--
-- Name: occupations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.occupations (
    code character varying(255) NOT NULL,
    created_at timestamp(6) with time zone NOT NULL,
    deleted_at timestamp(6) with time zone,
    display_name character varying(255) NOT NULL,
    sort_order integer NOT NULL,
    CONSTRAINT occupations_code_check CHECK (((code)::text = ANY ((ARRAY['LABOR_ATTORNEY'::character varying, 'PATENT_ATTORNEY'::character varying, 'TAX_ACCOUNTANT'::character varying, 'CPA'::character varying, 'APPRAISER'::character varying, 'CIVIL_SERVANT'::character varying, 'POLICE_FIRE'::character varying, 'ADMIN_EXAM'::character varying, 'CERTIFICATION'::character varying, 'MIDDLE_SCHOOL'::character varying, 'HIGH_SCHOOL'::character varying, 'CSAT'::character varying, 'UNIVERSITY'::character varying, 'JOB_PREP'::character varying, 'ENGLISH_TEST'::character varying, 'CODING'::character varying, 'SELF_DEVELOPMENT'::character varying, 'FOCUS_BUILDING'::character varying, 'ETC'::character varying])::text[])))
);


--
-- Name: pinned_friends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pinned_friends (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone,
    friend_user_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: share_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.share_cards (
    id uuid NOT NULL,
    created_at timestamp(6) with time zone,
    image_url character varying(255) NOT NULL,
    shared_at timestamp(6) with time zone,
    group_id uuid NOT NULL,
    user_id uuid NOT NULL
);


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
    CONSTRAINT social_accounts_provider_check CHECK (((provider)::text = ANY ((ARRAY['APPLE'::character varying, 'GOOGLE'::character varying, 'KAKAO'::character varying, 'LINE'::character varying, 'INSTAGRAM'::character varying, 'FACEBOOK'::character varying])::text[])))
);


--
-- Name: user_focus_time_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_focus_time_settings (
    user_id uuid NOT NULL,
    daily_focus_time_goal_minutes integer NOT NULL,
    deleted_at timestamp(6) with time zone,
    updated_at timestamp(6) with time zone
);


--
-- Name: user_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_items (
    id uuid NOT NULL,
    acquired_at timestamp(6) with time zone,
    item_id uuid NOT NULL,
    user_id uuid NOT NULL
);


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
-- Name: user_screen_time_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_screen_time_settings (
    user_id uuid NOT NULL,
    created_at timestamp(6) with time zone,
    daily_screen_time_goal_minutes integer NOT NULL,
    deleted_at timestamp(6) with time zone,
    is_screen_time_permission_granted boolean NOT NULL,
    updated_at timestamp(6) with time zone
);


--
-- Name: user_streaks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_streaks (
    id uuid NOT NULL,
    deleted_at timestamp(6) with time zone,
    last_session_date date,
    longest_streak integer NOT NULL,
    streak_count integer NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: user_wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_wallets (
    user_id uuid NOT NULL,
    balance integer NOT NULL,
    deleted_at timestamp(6) with time zone,
    updated_at timestamp(6) with time zone,
    version bigint
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    birth_date date,
    country_code character varying(255),
    created_at timestamp(6) with time zone,
    current_tier integer,
    deleted_at timestamp(6) with time zone,
    device_token character varying(512),
    gender character varying(255),
    is_guest boolean NOT NULL,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL,
    nickname character varying(255),
    occupation character varying(255),
    refresh_token character varying(255),
    report_time time(0) without time zone,
    stat_visibility character varying(20) DEFAULT 'FRIENDS'::character varying NOT NULL,
    updated_at timestamp(6) with time zone,
    CONSTRAINT users_gender_check CHECK (((gender)::text = ANY ((ARRAY['MALE'::character varying, 'FEMALE'::character varying, 'UNKNOWN'::character varying])::text[]))),
    CONSTRAINT users_occupation_check CHECK (((occupation)::text = ANY ((ARRAY['LABOR_ATTORNEY'::character varying, 'PATENT_ATTORNEY'::character varying, 'TAX_ACCOUNTANT'::character varying, 'CPA'::character varying, 'APPRAISER'::character varying, 'CIVIL_SERVANT'::character varying, 'POLICE_FIRE'::character varying, 'ADMIN_EXAM'::character varying, 'CERTIFICATION'::character varying, 'MIDDLE_SCHOOL'::character varying, 'HIGH_SCHOOL'::character varying, 'CSAT'::character varying, 'UNIVERSITY'::character varying, 'JOB_PREP'::character varying, 'ENGLISH_TEST'::character varying, 'CODING'::character varying, 'SELF_DEVELOPMENT'::character varying, 'FOCUS_BUILDING'::character varying, 'ETC'::character varying])::text[]))),
    CONSTRAINT users_stat_visibility_check CHECK (((stat_visibility)::text = ANY ((ARRAY['FRIENDS'::character varying, 'PUBLIC'::character varying])::text[])))
);


--
-- Name: weekly_feedbacks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weekly_feedbacks (
    id uuid NOT NULL,
    content text NOT NULL,
    delivered_at timestamp(6) with time zone,
    generated_at timestamp(6) with time zone,
    week_start timestamp(6) with time zone NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: character_equipment character_equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_equipment
    ADD CONSTRAINT character_equipment_pkey PRIMARY KEY (id);


--
-- Name: currency_transactions currency_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency_transactions
    ADD CONSTRAINT currency_transactions_pkey PRIMARY KEY (id);


--
-- Name: daily_focus_stats daily_focus_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_focus_stats
    ADD CONSTRAINT daily_focus_stats_pkey PRIMARY KEY (id);


--
-- Name: daily_screen_time_stats daily_screen_time_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_screen_time_stats
    ADD CONSTRAINT daily_screen_time_stats_pkey PRIMARY KEY (id);


--
-- Name: focus_sessions focus_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_sessions
    ADD CONSTRAINT focus_sessions_pkey PRIMARY KEY (id);


--
-- Name: focus_tags focus_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_tags
    ADD CONSTRAINT focus_tags_pkey PRIMARY KEY (id);


--
-- Name: friendships friendships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_pkey PRIMARY KEY (id);


--
-- Name: group_announcements group_announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_announcements
    ADD CONSTRAINT group_announcements_pkey PRIMARY KEY (id);


--
-- Name: group_challenge_members group_challenge_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_challenge_members
    ADD CONSTRAINT group_challenge_members_pkey PRIMARY KEY (id);


--
-- Name: group_challenges group_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_challenges
    ADD CONSTRAINT group_challenges_pkey PRIMARY KEY (id);


--
-- Name: group_invites group_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_invites
    ADD CONSTRAINT group_invites_pkey PRIMARY KEY (id);


--
-- Name: group_members group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_pkey PRIMARY KEY (id);


--
-- Name: group_notice_grants group_notice_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_notice_grants
    ADD CONSTRAINT group_notice_grants_pkey PRIMARY KEY (id);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);


--
-- Name: league_arena_users league_arena_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_arena_users
    ADD CONSTRAINT league_arena_users_pkey PRIMARY KEY (id);


--
-- Name: league_arenas league_arenas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_arenas
    ADD CONSTRAINT league_arenas_pkey PRIMARY KEY (id);


--
-- Name: league_rank_snapshots league_rank_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_rank_snapshots
    ADD CONSTRAINT league_rank_snapshots_pkey PRIMARY KEY (id);


--
-- Name: league_tier_configs league_tier_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_tier_configs
    ADD CONSTRAINT league_tier_configs_pkey PRIMARY KEY (tier_level);


--
-- Name: notification_sent_logs notification_sent_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_sent_logs
    ADD CONSTRAINT notification_sent_logs_pkey PRIMARY KEY (id);


--
-- Name: occupation_default_tags occupation_default_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.occupation_default_tags
    ADD CONSTRAINT occupation_default_tags_pkey PRIMARY KEY (id);


--
-- Name: occupations occupations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.occupations
    ADD CONSTRAINT occupations_pkey PRIMARY KEY (code);


--
-- Name: pinned_friends pinned_friends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pinned_friends
    ADD CONSTRAINT pinned_friends_pkey PRIMARY KEY (id);


--
-- Name: share_cards share_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_cards
    ADD CONSTRAINT share_cards_pkey PRIMARY KEY (id);


--
-- Name: social_accounts social_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_accounts
    ADD CONSTRAINT social_accounts_pkey PRIMARY KEY (id);


--
-- Name: groups uk16fame6je5oyjncqmbl1n5177; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT uk16fame6je5oyjncqmbl1n5177 UNIQUE (code);


--
-- Name: daily_focus_stats uk3cc32qmltjr6ytfg4jdequoed; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_focus_stats
    ADD CONSTRAINT uk3cc32qmltjr6ytfg4jdequoed UNIQUE (user_id, date);


--
-- Name: group_notice_grants ukalk4mv62keg5q4paqypyphdn3; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_notice_grants
    ADD CONSTRAINT ukalk4mv62keg5q4paqypyphdn3 UNIQUE (group_id, user_id);


--
-- Name: pinned_friends ukavn3tw9d97lh47pph7t2slkgj; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pinned_friends
    ADD CONSTRAINT ukavn3tw9d97lh47pph7t2slkgj UNIQUE (user_id, friend_user_id);


--
-- Name: friendships ukcw1b2t1f9600yhvikefbpd1gn; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT ukcw1b2t1f9600yhvikefbpd1gn UNIQUE (from_user_id, to_user_id);


--
-- Name: league_arena_users ukd6hmogi84gok5l3evkm7oae8w; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_arena_users
    ADD CONSTRAINT ukd6hmogi84gok5l3evkm7oae8w UNIQUE (league_arena_id, user_id);


--
-- Name: group_challenge_members ukiwe9880osh6noglltq8seipts; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_challenge_members
    ADD CONSTRAINT ukiwe9880osh6noglltq8seipts UNIQUE (group_challenge_id, user_id);


--
-- Name: daily_screen_time_stats ukjnb8sd46si5cwfhbiw7gw8480; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_screen_time_stats
    ADD CONSTRAINT ukjnb8sd46si5cwfhbiw7gw8480 UNIQUE (user_id, date);


--
-- Name: user_streaks ukohm7b8slvdgmrmgisi5sg2uye; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_streaks
    ADD CONSTRAINT ukohm7b8slvdgmrmgisi5sg2uye UNIQUE (user_id);


--
-- Name: group_members ukp940p7g0r9yihubnf6rtaheog; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT ukp940p7g0r9yihubnf6rtaheog UNIQUE (user_id, group_id);


--
-- Name: character_equipment ukqomy0c5u54virxcybgvqoc6t1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_equipment
    ADD CONSTRAINT ukqomy0c5u54virxcybgvqoc6t1 UNIQUE (user_id, slot_type);


--
-- Name: user_items ukt1fm75442g6mqcekt9ojereou; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_items
    ADD CONSTRAINT ukt1fm75442g6mqcekt9ojereou UNIQUE (user_id, item_id);


--
-- Name: league_rank_snapshots uq_league_rank_snapshots_arena_user_day; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_rank_snapshots
    ADD CONSTRAINT uq_league_rank_snapshots_arena_user_day UNIQUE (arena_id, user_id, captured_on);


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
-- Name: user_focus_time_settings user_focus_time_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_focus_time_settings
    ADD CONSTRAINT user_focus_time_settings_pkey PRIMARY KEY (user_id);


--
-- Name: user_items user_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_items
    ADD CONSTRAINT user_items_pkey PRIMARY KEY (id);


--
-- Name: user_notification_settings user_notification_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notification_settings
    ADD CONSTRAINT user_notification_settings_pkey PRIMARY KEY (user_id);


--
-- Name: user_screen_time_settings user_screen_time_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_screen_time_settings
    ADD CONSTRAINT user_screen_time_settings_pkey PRIMARY KEY (user_id);


--
-- Name: user_streaks user_streaks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_streaks
    ADD CONSTRAINT user_streaks_pkey PRIMARY KEY (id);


--
-- Name: user_wallets user_wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_wallets
    ADD CONSTRAINT user_wallets_pkey PRIMARY KEY (user_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: weekly_feedbacks weekly_feedbacks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_feedbacks
    ADD CONSTRAINT weekly_feedbacks_pkey PRIMARY KEY (id);


--
-- Name: idx_notification_sent_logs_user_type_sent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_sent_logs_user_type_sent ON public.notification_sent_logs USING btree (user_id, type, sent_at);


--
-- Name: idx_users_nickname_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_nickname_trgm ON public.users USING gin (nickname public.gin_trgm_ops);


--
-- Name: share_cards fk2vaptb24wwn9y9ffkb8reua03; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_cards
    ADD CONSTRAINT fk2vaptb24wwn9y9ffkb8reua03 FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: league_arenas fk3de78wwwltoqep2obk7i44olx; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_arenas
    ADD CONSTRAINT fk3de78wwwltoqep2obk7i44olx FOREIGN KEY (tier_level) REFERENCES public.league_tier_configs(tier_level);


--
-- Name: daily_screen_time_stats fk3wkjel3n65i9btb9b9jlmm15u; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_screen_time_stats
    ADD CONSTRAINT fk3wkjel3n65i9btb9b9jlmm15u FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: daily_focus_stats fk4xfwxti5vn20h1pnqy7hqn1fl; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_focus_stats
    ADD CONSTRAINT fk4xfwxti5vn20h1pnqy7hqn1fl FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_items fk55mpmb46vtbmw6xljldr2wvvf; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_items
    ADD CONSTRAINT fk55mpmb46vtbmw6xljldr2wvvf FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: focus_sessions fk5b795b8k404efrrkf6fnxdhf9; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_sessions
    ADD CONSTRAINT fk5b795b8k404efrrkf6fnxdhf9 FOREIGN KEY (focus_tag_id) REFERENCES public.focus_tags(id);


--
-- Name: league_arena_users fk6lmkxjhfdqlmayfrsxj9664pn; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_arena_users
    ADD CONSTRAINT fk6lmkxjhfdqlmayfrsxj9664pn FOREIGN KEY (user_id) REFERENCES public.users(id);


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
-- Name: weekly_feedbacks fk8r3aw7rxi9wl9ktgsglas5okm; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_feedbacks
    ADD CONSTRAINT fk8r3aw7rxi9wl9ktgsglas5okm FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: league_arena_users fk8yplcwwabiy2pq57uuha67l0h; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_arena_users
    ADD CONSTRAINT fk8yplcwwabiy2pq57uuha67l0h FOREIGN KEY (league_arena_id) REFERENCES public.league_arenas(id);


--
-- Name: share_cards fkanqh4r76ojmm4ka7ac4w645hn; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_cards
    ADD CONSTRAINT fkanqh4r76ojmm4ka7ac4w645hn FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: focus_sessions fkcjt1qit8ck1qmkfpjiocf322d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_sessions
    ADD CONSTRAINT fkcjt1qit8ck1qmkfpjiocf322d FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: group_invites fkcmtrve4ny2p6fiegiyrr9s6b8; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_invites
    ADD CONSTRAINT fkcmtrve4ny2p6fiegiyrr9s6b8 FOREIGN KEY (inviter_id) REFERENCES public.users(id);


--
-- Name: focus_tags fkdos8okyn7xds843ko09xpoh2n; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.focus_tags
    ADD CONSTRAINT fkdos8okyn7xds843ko09xpoh2n FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: group_challenge_members fkdvr0qls9yul8s9y877vjmp7rj; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_challenge_members
    ADD CONSTRAINT fkdvr0qls9yul8s9y877vjmp7rj FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: group_invites fke13kevpt9l9reh40holrpij1i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_invites
    ADD CONSTRAINT fke13kevpt9l9reh40holrpij1i FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: group_challenge_members fke94yh6a3xeobsxtw4chko6yh8; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_challenge_members
    ADD CONSTRAINT fke94yh6a3xeobsxtw4chko6yh8 FOREIGN KEY (group_challenge_id) REFERENCES public.group_challenges(id);


--
-- Name: group_announcements fkfhcs6ts17lpswq2bp0u15946m; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_announcements
    ADD CONSTRAINT fkfhcs6ts17lpswq2bp0u15946m FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: user_streaks fkheh91lxslxss2h8mhvtsp0aog; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_streaks
    ADD CONSTRAINT fkheh91lxslxss2h8mhvtsp0aog FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: pinned_friends fkjows8lp8qeiph44syym43cd6v; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pinned_friends
    ADD CONSTRAINT fkjows8lp8qeiph44syym43cd6v FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_items fkkfadft0bfnq5ck87h9jrg74o1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_items
    ADD CONSTRAINT fkkfadft0bfnq5ck87h9jrg74o1 FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: group_members fkkv9vlrye4rmhqjq4qohy2n5a6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT fkkv9vlrye4rmhqjq4qohy2n5a6 FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: character_equipment fkkx9pyoyoto5ryglidv562pwbn; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_equipment
    ADD CONSTRAINT fkkx9pyoyoto5ryglidv562pwbn FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: group_announcements fkl9c1ccy9jc5b8mbgygtmynn0j; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_announcements
    ADD CONSTRAINT fkl9c1ccy9jc5b8mbgygtmynn0j FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: currency_transactions fkljkqaus2rgo9jclt4bxevx4m; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency_transactions
    ADD CONSTRAINT fkljkqaus2rgo9jclt4bxevx4m FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: friendships fkm3dq1nlwax8uwswk9sk6lli7e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT fkm3dq1nlwax8uwswk9sk6lli7e FOREIGN KEY (from_user_id) REFERENCES public.users(id);


--
-- Name: pinned_friends fkmio7wbdsrkrvxgvxadm4qvtl4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pinned_friends
    ADD CONSTRAINT fkmio7wbdsrkrvxgvxadm4qvtl4 FOREIGN KEY (friend_user_id) REFERENCES public.users(id);


--
-- Name: group_invites fkn1euirqsuchoa0fv2lcfprtvw; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_invites
    ADD CONSTRAINT fkn1euirqsuchoa0fv2lcfprtvw FOREIGN KEY (invitee_id) REFERENCES public.users(id);


--
-- Name: group_members fknr9qg33qt2ovmv29g4vc3gtdx; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT fknr9qg33qt2ovmv29g4vc3gtdx FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: group_notice_grants fkqeqnddpktihq810n10260cth2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_notice_grants
    ADD CONSTRAINT fkqeqnddpktihq810n10260cth2 FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: group_challenges fksnbkbw2nud702m8gln9opam00; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_challenges
    ADD CONSTRAINT fksnbkbw2nud702m8gln9opam00 FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: character_equipment fkupmr9l0hbqq52tlpfjjobfql; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_equipment
    ADD CONSTRAINT fkupmr9l0hbqq52tlpfjjobfql FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- PostgreSQL database dump complete
--


