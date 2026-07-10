-- V2 — 공통 테이블 컬럼 dbml 정합 (GROMO-671)
-- 방향: dbml(target)/엔티티 권위, 전면 정합. 데이터: 기존 값 폐기 가능(백필 불필요).
-- 검증: 빈 postgres:16 컨테이너에 V1+V2 적용 → validate 프로필 기동으로 Hibernate validate 통과 확인.
--   커플링 변경(groups 챌린지/코드/notice/host, focus_sessions.focus_tag_id, occupation_default_tags.name,
--   신규 테이블 등)은 671 범위 아님 → 672~676 의 V3~ 에서. 여기엔 넣지 말 것.
-- enum 계열은 varchar(255) + CHECK 관례(네이티브 enum 미사용). enum 스토리지는 @Enumerated(STRING).

-- ════════════════════════════════════════════════════════════════════
-- 커밋 1: 순수 리네임 + 추가 컬럼 (데이터 손실 0)
-- ════════════════════════════════════════════════════════════════════

-- RENAME — 엔티티 컬럼명 정합
ALTER TABLE character_equipment RENAME COLUMN equipped_at TO created_at;
ALTER TABLE currency_transactions RENAME COLUMN transacted_at TO created_at;
ALTER TABLE daily_focus_stats RENAME COLUMN focus_goal_achieved TO is_focus_time_goal_achieved;
ALTER TABLE daily_screen_time_stats RENAME COLUMN actual_screen_time_minutes TO total_screen_time_minutes;
ALTER TABLE daily_screen_time_stats RENAME COLUMN screen_time_goal_achieved TO is_screen_time_goal_achieved;
ALTER TABLE group_announcements RENAME COLUMN author_id TO user_id;
ALTER TABLE group_challenges RENAME COLUMN mission_type TO type;
ALTER TABLE group_challenges RENAME COLUMN mission_category TO category;
ALTER TABLE group_members RENAME COLUMN joined_at TO created_at;
ALTER TABLE groups RENAME COLUMN chat_enabled TO is_chat_enabled;
ALTER TABLE items RENAME COLUMN price_type TO payment_type;
ALTER TABLE items RENAME COLUMN asset_address TO asset_url;
ALTER TABLE league_arenas RENAME COLUMN week_start_at TO started_at;
ALTER TABLE league_rank_snapshots RENAME COLUMN captured_on TO created_at;
ALTER TABLE user_items RENAME COLUMN acquired_at TO created_at;
ALTER TABLE user_streaks RENAME COLUMN longest_streak TO longest_streak_count;

-- ADD — 엔티티에 추가된 컬럼
ALTER TABLE currency_transactions ADD COLUMN idempotency_key character varying(255);
ALTER TABLE currency_transactions ADD CONSTRAINT uq_currency_transactions_idempotency_key UNIQUE (idempotency_key);

-- focus_sessions: status/focus_type(enum, NOT NULL), daily_focus_stat_id(직접 uuid), created_at
ALTER TABLE focus_sessions ADD COLUMN status character varying(255) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE focus_sessions ADD COLUMN focus_type character varying(255) NOT NULL DEFAULT 'INFINITE';
ALTER TABLE focus_sessions ADD COLUMN daily_focus_stat_id uuid;
ALTER TABLE focus_sessions ADD COLUMN created_at timestamp(6) with time zone;
ALTER TABLE focus_sessions
    ADD CONSTRAINT focus_sessions_status_check
    CHECK ((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'COMPLETED'::character varying, 'CANCELED'::character varying])::text[]));
ALTER TABLE focus_sessions
    ADD CONSTRAINT focus_sessions_focus_type_check
    CHECK ((focus_type)::text = ANY ((ARRAY['INFINITE'::character varying, 'RANGE'::character varying, 'POMODORO'::character varying])::text[]));

ALTER TABLE group_announcements ADD COLUMN deleted_at timestamp(6) with time zone;

ALTER TABLE group_challenges ADD COLUMN deleted_at timestamp(6) with time zone;

-- group_members: status(enum, NOT NULL), is_left, updated_at
ALTER TABLE group_members ADD COLUMN status character varying(255) NOT NULL DEFAULT 'INACTIVE';
ALTER TABLE group_members ADD COLUMN is_left boolean NOT NULL DEFAULT false;
ALTER TABLE group_members ADD COLUMN updated_at timestamp(6) with time zone;
ALTER TABLE group_members
    ADD CONSTRAINT group_members_status_check
    CHECK ((status)::text = ANY ((ARRAY['INACTIVE'::character varying, 'CHALLENGE'::character varying, 'FOCUS'::character varying])::text[]));

ALTER TABLE groups ADD COLUMN deleted_at timestamp(6) with time zone;

-- items: description(text), is_active, created_at(NOT NULL), updated_at
ALTER TABLE items ADD COLUMN description text;
ALTER TABLE items ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE items ADD COLUMN created_at timestamp(6) with time zone NOT NULL DEFAULT now();
ALTER TABLE items ADD COLUMN updated_at timestamp(6) with time zone;

-- league_arenas: created_at(NOT NULL), updated_at
ALTER TABLE league_arenas ADD COLUMN created_at timestamp(6) with time zone NOT NULL DEFAULT now();
ALTER TABLE league_arenas ADD COLUMN updated_at timestamp(6) with time zone;

ALTER TABLE user_items ADD COLUMN is_used boolean NOT NULL DEFAULT false;

ALTER TABLE user_streaks ADD COLUMN updated_at timestamp(6) with time zone;

-- 자기완결 DROP
--   ※ user_wallets.version / groups.version 은 dbml 에 없지만 낙관락(동시성) 필요로 유지 — 드롭하지 않음.
ALTER TABLE occupations DROP COLUMN sort_order;
ALTER TABLE group_members DROP COLUMN completed_at;

-- ════════════════════════════════════════════════════════════════════
-- 커밋 2: 의미 변경 컬럼 교체 (기존 값 폐기 — drop+add / CHECK 교체)
-- ════════════════════════════════════════════════════════════════════
-- ※ 값 폐기라 백필 UPDATE 없음. 빈 DB 검증이라 기존 위반행 없음.

-- daily_focus_stats: distraction_count(횟수) → total_distraction_seconds(초) 의미 변경(값 폐기).
ALTER TABLE daily_focus_stats DROP COLUMN distraction_count;
ALTER TABLE daily_focus_stats ADD COLUMN total_distraction_seconds integer NOT NULL DEFAULT 0;

-- users: 소프트딜리트 표현을 timestamp(deleted_at) → boolean(is_deleted) 으로 교체(값 폐기).
ALTER TABLE users DROP COLUMN deleted_at;
ALTER TABLE users ADD COLUMN is_deleted boolean NOT NULL DEFAULT false;

-- currency_transactions: reason 컬럼 제거(+ CHECK 동반 제거) / type CHECK 를 신규 도메인으로 교체.
--   기존 type CHECK(EARN/SPEND) → SESSION_COMPLETE/STREAK_BONUS/PURCHASE.
-- 기존 행 정규화(GROMO-671 배포 실패 보정): 구 type CHECK(EARN/SPEND) 를 먼저 제거한 뒤
--   reason(이미 신규 도메인 값 보유) 을 type 으로 이관하고 reason 을 드롭한다. 이관 없이 신규 CHECK 를
--   붙이면 레거시 type=EARN/SPEND 행이 위반해 ADD CONSTRAINT 가 23514(check_violation)로 실패한다.
--   ※ 구 CHECK 제거를 UPDATE 앞에 둬야 신규 도메인 값이 아직 살아있는 구 CHECK 에 걸리지 않는다.
ALTER TABLE currency_transactions DROP CONSTRAINT currency_transactions_type_check;
UPDATE currency_transactions SET type = reason;
ALTER TABLE currency_transactions DROP COLUMN reason;
ALTER TABLE currency_transactions
    ADD CONSTRAINT currency_transactions_type_check
    CHECK ((type)::text = ANY ((ARRAY['SESSION_COMPLETE'::character varying, 'STREAK_BONUS'::character varying, 'PURCHASE'::character varying])::text[]));

-- items: rarity → grade RENAME + rarity CHECK 제거(grade 는 varchar, CHECK 없음).
ALTER TABLE items DROP CONSTRAINT items_rarity_check;
ALTER TABLE items RENAME COLUMN rarity TO grade;
-- payment_type CHECK 은 컬럼 리네임 후에도 유효(값 도메인 동일: CURRENCY/PREMIUM/BOTH). 제약명만 정합.
ALTER TABLE items RENAME CONSTRAINT items_price_type_check TO items_payment_type_check;

-- group_challenges: status CHECK ACTIVE/ENDED → ACTIVE/INACTIVE.
ALTER TABLE group_challenges DROP CONSTRAINT group_challenges_status_check;
-- 기존 행 정규화(GROMO-671 배포 실패 보정): 신규 도메인(ACTIVE/INACTIVE) 밖의 모든 레거시 값을 INACTIVE 로
--   이관(구 도메인 ENDED 포함 — NOT IN 이라 예상 밖 값도 포괄). 구 CHECK 제거 후 UPDATE 해야 구 CHECK 에 안 걸린다.
UPDATE group_challenges SET status = 'INACTIVE' WHERE status NOT IN ('ACTIVE', 'INACTIVE');
ALTER TABLE group_challenges
    ADD CONSTRAINT group_challenges_status_check
    CHECK ((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'INACTIVE'::character varying])::text[]));
-- type/category CHECK 제약명 정합(컬럼 리네임에 맞춤; 값 도메인 동일).
ALTER TABLE group_challenges RENAME CONSTRAINT group_challenges_mission_type_check TO group_challenges_type_check;
ALTER TABLE group_challenges RENAME CONSTRAINT group_challenges_mission_category_check TO group_challenges_category_check;

-- groups: status CHECK 에서 CLOSED 제거(WAITING/ACTIVE/ENDED).
ALTER TABLE groups DROP CONSTRAINT groups_status_check;
-- 기존 행 정규화(GROMO-671 배포 실패 보정): 구 도메인 status=CLOSED(그룹 종료) → ENDED 이관.
--   신규 CHECK(WAITING/ACTIVE/ENDED) 밖의 값을 ENDED 로 포괄(NOT IN — 예상 밖 값도 안전).
--   구 CHECK 제거 후 UPDATE 해야 신규 값이 아직 살아있는 구 CHECK 에 걸리지 않는다.
UPDATE groups SET status = 'ENDED' WHERE status NOT IN ('WAITING', 'ACTIVE', 'ENDED');
ALTER TABLE groups
    ADD CONSTRAINT groups_status_check
    CHECK ((status)::text = ANY ((ARRAY['WAITING'::character varying, 'ACTIVE'::character varying, 'ENDED'::character varying])::text[]));

-- user_streaks: PK id → user_id. id 컬럼 드롭, user_id 를 PK 로.
--   기존 UNIQUE(user_id)(ukohm7b8slvdgmrmgisi5sg2uye) 는 PK 로 대체되므로 제거.
ALTER TABLE user_streaks DROP CONSTRAINT user_streaks_pkey;
ALTER TABLE user_streaks DROP CONSTRAINT ukohm7b8slvdgmrmgisi5sg2uye;
ALTER TABLE user_streaks DROP COLUMN id;
ALTER TABLE user_streaks ADD CONSTRAINT user_streaks_pkey PRIMARY KEY (user_id);

-- ════════════════════════════════════════════════════════════════════
-- 커밋 3: 기능 제거 드롭 (엔티티+DTO+서비스+API 동반 제거)
-- ════════════════════════════════════════════════════════════════════

-- focus_sessions: 기능 제거 드롭. deleted_at 은 커밋1의 status=CANCELED 로 대체.
ALTER TABLE focus_sessions DROP COLUMN subject;
ALTER TABLE focus_sessions DROP COLUMN local_date;
ALTER TABLE focus_sessions DROP COLUMN distraction_count;
ALTER TABLE focus_sessions DROP COLUMN deleted_at;

-- users: 기능 제거 드롭. gender·birth_date·report_time·current_tier 삭제.
--   gender CHECK 제약(users_gender_check)도 컬럼 DROP 시 함께 제거됨.
ALTER TABLE users DROP COLUMN gender;
ALTER TABLE users DROP COLUMN birth_date;
ALTER TABLE users DROP COLUMN report_time;
ALTER TABLE users DROP COLUMN current_tier;
