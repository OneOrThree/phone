-- 로컬 웹 디버깅용 풍부한 시드. 고정 UUID + ON CONFLICT로 반복 실행해도 같은 상태를 유지한다.

-- 그룹 이름 유사도 검색(GroupRepository의 %, <-> 연산자)에 필요하다.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

INSERT INTO occupations (code, display_name, created_at)
VALUES
    ('LABOR_ATTORNEY', '노무사', now()),
    ('PATENT_ATTORNEY', '변리사', now()),
    ('TAX_ACCOUNTANT', '세무사', now()),
    ('CPA', '회계사', now()),
    ('APPRAISER', '감정평가사', now()),
    ('CIVIL_SERVANT', '공무원', now()),
    ('POLICE_FIRE', '경찰·소방', now()),
    ('ADMIN_EXAM', '행정고시', now()),
    ('CERTIFICATION', '자격증', now()),
    ('MIDDLE_SCHOOL', '중학생', now()),
    ('HIGH_SCHOOL', '고등학생', now()),
    ('CSAT', '수능·N수', now()),
    ('UNIVERSITY', '대학생', now()),
    ('JOB_PREP', '취업 준비', now()),
    ('ENGLISH_TEST', '토익·토플', now()),
    ('CODING', '코딩', now()),
    ('SELF_DEVELOPMENT', '자기계발', now()),
    ('FOCUS_BUILDING', '집중력 키우기', now()),
    ('ETC', '기타', now())
ON CONFLICT (code) DO UPDATE SET display_name = EXCLUDED.display_name, deleted_at = NULL;

INSERT INTO default_tags (id, name, created_at)
SELECT md5('local-debug-tag-' || name)::uuid, name, now()
FROM (VALUES
    ('이론 공부'), ('문제 풀이'), ('오답 정리'), ('복습'),
    ('암기'), ('실습'), ('프로젝트'), ('면접 준비')
) AS tags(name)
ON CONFLICT (name) DO NOTHING;

INSERT INTO occupation_default_tags (id, occupation, sort_order, created_at, default_tag_id)
SELECT
    md5('local-debug-occupation-tag-' || occupation.code || '-' || tags.name)::uuid,
    occupation.code,
    tags.sort_order,
    now(),
    default_tags.id
FROM occupations AS occupation
CROSS JOIN (VALUES
    ('이론 공부', 0), ('문제 풀이', 1), ('오답 정리', 2), ('복습', 3)
) AS tags(name, sort_order)
JOIN default_tags ON default_tags.name = tags.name
ON CONFLICT (id)
DO UPDATE SET sort_order = EXCLUDED.sort_order;

INSERT INTO league_tier_configs
    (tier_level, badge_id, promotion_time, relegation_time, created_at, updated_at)
VALUES
    (1, 'bbosirae', 50400, 0, now(), now()),
    (2, 'preheat', 100800, 50400, now(), now()),
    (3, 'hyperfocus', 151200, 100800, now(), now()),
    (4, 'gatsaeng', 201600, 151200, now(), now()),
    (5, 'conqueror', 252000, 201600, now(), now())
ON CONFLICT (tier_level) DO UPDATE SET
    badge_id = EXCLUDED.badge_id,
    promotion_time = EXCLUDED.promotion_time,
    relegation_time = EXCLUDED.relegation_time,
    deleted_at = NULL,
    updated_at = now();

WITH debug_users(id, nickname, occupation, tier_level) AS (
    VALUES
        ('10000000-0000-7000-8000-000000000001'::uuid, '모각코장인', 'CODING', 4),
        ('10000000-0000-7000-8000-000000000002'::uuid, '오늘도열공', 'CODING', 3),
        ('10000000-0000-7000-8000-000000000003'::uuid, '미라클모닝', 'UNIVERSITY', 3),
        ('10000000-0000-7000-8000-000000000004'::uuid, '합격한다', 'CIVIL_SERVANT', 2),
        ('10000000-0000-7000-8000-000000000005'::uuid, '집중왕', 'CSAT', 5),
        ('10000000-0000-7000-8000-000000000006'::uuid, '푸두푸두', 'JOB_PREP', 2),
        ('10000000-0000-7000-8000-000000000007'::uuid, '새벽공부', 'ENGLISH_TEST', 4),
        ('10000000-0000-7000-8000-000000000008'::uuid, '꾸준함이답', 'SELF_DEVELOPMENT', 3),
        ('10000000-0000-7000-8000-000000000009'::uuid, '알고리즘러', 'CODING', 2),
        ('10000000-0000-7000-8000-000000000010'::uuid, '합격루틴', 'CIVIL_SERVANT', 4),
        ('10000000-0000-7000-8000-000000000011'::uuid, '캠퍼스생활', 'UNIVERSITY', 2),
        ('10000000-0000-7000-8000-000000000012'::uuid, '토익만점', 'ENGLISH_TEST', 3),
        ('10000000-0000-7000-8000-000000000013'::uuid, '면접준비중', 'JOB_PREP', 3),
        ('10000000-0000-7000-8000-000000000014'::uuid, '수능올인', 'CSAT', 4),
        ('10000000-0000-7000-8000-000000000015'::uuid, '자격증콜렉터', 'CERTIFICATION', 2),
        ('10000000-0000-7000-8000-000000000016'::uuid, '아침집중', 'FOCUS_BUILDING', 3),
        ('10000000-0000-7000-8000-000000000017'::uuid, '꾸준한성장', 'SELF_DEVELOPMENT', 4),
        ('10000000-0000-7000-8000-000000000018'::uuid, '고등공부', 'HIGH_SCHOOL', 2),
        ('10000000-0000-7000-8000-000000000019'::uuid, '중등공부', 'MIDDLE_SCHOOL', 1),
        ('10000000-0000-7000-8000-000000000020'::uuid, '변리사도전', 'PATENT_ATTORNEY', 4),
        ('10000000-0000-7000-8000-000000000021'::uuid, '노무사준비', 'LABOR_ATTORNEY', 3),
        ('10000000-0000-7000-8000-000000000022'::uuid, '세무회계', 'TAX_ACCOUNTANT', 5),
        ('10000000-0000-7000-8000-000000000023'::uuid, '감평합격', 'APPRAISER', 4),
        ('10000000-0000-7000-8000-000000000024'::uuid, '행시도전', 'ADMIN_EXAM', 5),
        ('10000000-0000-7000-8000-000000000025'::uuid, '코드한줄더', 'CODING', 3)
)
INSERT INTO users
    (id, nickname, occupation, country_code, is_guest, is_deleted, stat_visibility,
     tier_level, last_active_at, created_at, updated_at)
SELECT id, nickname, occupation, 'KR', false, false, 'PUBLIC', tier_level,
       now() - interval '1 hour', now() - interval '90 days', now()
FROM debug_users
ON CONFLICT (id) DO UPDATE SET
    nickname = EXCLUDED.nickname,
    occupation = EXCLUDED.occupation,
    is_deleted = false,
    stat_visibility = 'PUBLIC',
    tier_level = EXCLUDED.tier_level,
    last_active_at = EXCLUDED.last_active_at,
    updated_at = now();

WITH debug_users AS (
    SELECT id, row_number() OVER (ORDER BY id)::integer AS user_no
    FROM users
    WHERE nickname IS NOT NULL AND is_deleted = false
), days AS (
    SELECT generate_series(0, 89) AS day_no
)
INSERT INTO daily_focus_stats
    (id, user_id, date, total_focus_seconds, total_distraction_seconds,
     session_count, is_focus_time_goal_achieved, updated_at)
SELECT
    md5('local-focus-' || users.id || '-' || days.day_no)::uuid,
    users.id,
    current_date - days.day_no,
    1800 + users.user_no * 420 + (days.day_no % 5) * 300,
    30 + (users.user_no * days.day_no % 240),
    1 + (days.day_no % 4),
    (1800 + users.user_no * 420 + (days.day_no % 5) * 300) >= 3600,
    now()
FROM debug_users AS users
CROSS JOIN days
ON CONFLICT (user_id, date) DO UPDATE SET
    total_focus_seconds = EXCLUDED.total_focus_seconds,
    total_distraction_seconds = EXCLUDED.total_distraction_seconds,
    session_count = EXCLUDED.session_count,
    is_focus_time_goal_achieved = EXCLUDED.is_focus_time_goal_achieved,
    updated_at = now();

WITH debug_users AS (
    SELECT id, row_number() OVER (ORDER BY id)::integer AS user_no
    FROM users
    WHERE nickname IS NOT NULL AND is_deleted = false
), days AS (
    SELECT generate_series(0, 89) AS day_no
)
INSERT INTO daily_screen_time_stats
    (id, user_id, date, total_screen_time_minutes, is_screen_time_goal_achieved,
     is_screen_time_finalized, created_at, updated_at)
SELECT
    md5('local-screen-' || users.id || '-' || days.day_no)::uuid,
    users.id,
    current_date - days.day_no,
    120 + users.user_no * 12 + (days.day_no % 6) * 8,
    (120 + users.user_no * 12 + (days.day_no % 6) * 8) <= 180,
    true,
    now(),
    now()
FROM debug_users AS users
CROSS JOIN days
ON CONFLICT (user_id, date) DO UPDATE SET
    total_screen_time_minutes = EXCLUDED.total_screen_time_minutes,
    is_screen_time_goal_achieved = EXCLUDED.is_screen_time_goal_achieved,
    is_screen_time_finalized = true,
    updated_at = now();

WITH debug_groups(id, name, description, owner_id) AS (
    VALUES
        ('20000000-0000-7000-8000-000000000001'::uuid, '새벽 6시 모각공', '아침 루틴을 같이 만들어요.', '10000000-0000-7000-8000-000000000001'::uuid),
        ('20000000-0000-7000-8000-000000000002'::uuid, '코딩테스트 스터디', '매일 한 문제씩 풀어요.', '10000000-0000-7000-8000-000000000002'::uuid),
        ('20000000-0000-7000-8000-000000000003'::uuid, '수능 D-Day 집중방', '공부 시간을 같이 채워요.', '10000000-0000-7000-8000-000000000005'::uuid),
        ('20000000-0000-7000-8000-000000000004'::uuid, '자격증 합격 메이트', '전문 자격증 수험생 모임입니다.', '10000000-0000-7000-8000-000000000015'::uuid),
        ('20000000-0000-7000-8000-000000000005'::uuid, '대학생 과제방', '과제와 시험 기간을 함께 달려요.', '10000000-0000-7000-8000-000000000011'::uuid),
        ('20000000-0000-7000-8000-000000000006'::uuid, '취준 집중 캠프', '자소서부터 면접까지 같이 준비해요.', '10000000-0000-7000-8000-000000000013'::uuid),
        ('20000000-0000-7000-8000-000000000007'::uuid, '토익 900+', '매일 LC와 RC를 인증해요.', '10000000-0000-7000-8000-000000000012'::uuid),
        ('20000000-0000-7000-8000-000000000008'::uuid, '자기계발 습관방', '작은 습관을 꾸준히 쌓아요.', '10000000-0000-7000-8000-000000000017'::uuid)
)
INSERT INTO groups
    (id, name, description, max_members, status, is_private, is_chat_enabled,
     invite_permission, version, created_at)
SELECT id, name, description, 50, 'ACTIVE', false, true, 'ALL_MEMBERS', 0, now()
FROM debug_groups
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    max_members = EXCLUDED.max_members,
    deleted_at = NULL;

WITH debug_groups(id, owner_id) AS (
    VALUES
        ('20000000-0000-7000-8000-000000000001'::uuid, '10000000-0000-7000-8000-000000000001'::uuid),
        ('20000000-0000-7000-8000-000000000002'::uuid, '10000000-0000-7000-8000-000000000002'::uuid),
        ('20000000-0000-7000-8000-000000000003'::uuid, '10000000-0000-7000-8000-000000000005'::uuid),
        ('20000000-0000-7000-8000-000000000004'::uuid, '10000000-0000-7000-8000-000000000015'::uuid),
        ('20000000-0000-7000-8000-000000000005'::uuid, '10000000-0000-7000-8000-000000000011'::uuid),
        ('20000000-0000-7000-8000-000000000006'::uuid, '10000000-0000-7000-8000-000000000013'::uuid),
        ('20000000-0000-7000-8000-000000000007'::uuid, '10000000-0000-7000-8000-000000000012'::uuid),
        ('20000000-0000-7000-8000-000000000008'::uuid, '10000000-0000-7000-8000-000000000017'::uuid)
)
INSERT INTO group_members
    (id, user_id, group_id, role, status, announcement_permission,
     notification_enabled, is_left, created_at, updated_at)
SELECT md5('local-group-owner-' || id)::uuid, owner_id, id, 'OWNER', 'INACTIVE',
       'ALLOW', true, false, now(), now()
FROM debug_groups
ON CONFLICT (user_id, group_id) DO UPDATE SET
    role = 'OWNER',
    is_left = false,
    left_reason = NULL,
    updated_at = now();

-- 웹은 소셜 SDK가 없으므로 온보딩을 끝낸 로컬 게스트를 전체 기능 확인용 일반 유저로 승격한다.
UPDATE users
SET is_guest = false,
    stat_visibility = 'PUBLIC',
    tier_level = GREATEST(tier_level, 3),
    updated_at = now()
WHERE nickname IS NOT NULL
  AND id::text NOT LIKE '10000000-0000-7000-8000-%';

WITH eligible_users AS (
    SELECT id, row_number() OVER (ORDER BY id)::integer AS user_no
    FROM users
    WHERE nickname IS NOT NULL AND is_deleted = false
)
INSERT INTO user_screen_time_settings
    (user_id, daily_screen_time_goal_minutes, is_screen_time_permission_granted,
     goal_effective_from, updated_at)
SELECT id, 150 + (user_no % 4) * 30, true, current_date - 30, now()
FROM eligible_users
ON CONFLICT (user_id) DO NOTHING;

WITH eligible_users AS (
    SELECT id, row_number() OVER (ORDER BY id)::integer AS user_no
    FROM users
    WHERE nickname IS NOT NULL AND is_deleted = false
)
INSERT INTO user_focus_time_settings
    (user_id, daily_focus_time_goal_minutes, goal_effective_from, updated_at)
SELECT id, 60 + (user_no % 5) * 30, current_date - 30, now()
FROM eligible_users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_notification_settings
    (user_id, notification_enabled, sound_enabled, night_mode_enabled,
     night_start_time, night_end_time, updated_at)
SELECT id, true, true, true, '23:00'::time, '07:00'::time, now()
FROM users
WHERE nickname IS NOT NULL AND is_deleted = false
ON CONFLICT (user_id) DO NOTHING;

WITH eligible_users AS (
    SELECT id, row_number() OVER (ORDER BY id)::integer AS user_no
    FROM users
    WHERE nickname IS NOT NULL AND is_deleted = false
)
INSERT INTO user_wallets (user_id, balance, version, updated_at)
SELECT id, 4500 + user_no * 125, 0, now()
FROM eligible_users
ON CONFLICT (user_id) DO UPDATE SET
    balance = GREATEST(user_wallets.balance, EXCLUDED.balance),
    deleted_at = NULL,
    updated_at = now();

WITH eligible_users AS (
    SELECT id, row_number() OVER (ORDER BY id)::integer AS user_no
    FROM users
    WHERE nickname IS NOT NULL AND is_deleted = false
)
INSERT INTO user_streaks
    (user_id, streak_count, longest_streak_count, last_session_date, updated_at)
SELECT id, 3 + (user_no % 18), 14 + (user_no % 40), current_date, now()
FROM eligible_users
ON CONFLICT (user_id) DO UPDATE SET
    streak_count = EXCLUDED.streak_count,
    longest_streak_count = EXCLUDED.longest_streak_count,
    last_session_date = EXCLUDED.last_session_date,
    deleted_at = NULL,
    updated_at = now();

WITH eligible_users AS (
    SELECT id
    FROM users
    WHERE nickname IS NOT NULL AND is_deleted = false
), ledger_events AS (
    SELECT generate_series(0, 19) AS event_no
)
INSERT INTO currency_transactions
    (id, user_id, amount, type, idempotency_key, created_at)
SELECT
    md5('local-ledger-' || users.id || '-' || events.event_no)::uuid,
    users.id,
    CASE WHEN events.event_no % 6 = 0 THEN 300 ELSE 20 + (events.event_no % 5) * 10 END,
    CASE
        WHEN events.event_no % 6 = 0 THEN 'PURCHASE'
        WHEN events.event_no % 5 = 0 THEN 'STREAK_BONUS'
        WHEN events.event_no % 4 = 0 THEN 'FOCUS_GOAL'
        WHEN events.event_no % 3 = 0 THEN 'SCREEN_TIME_GOAL'
        ELSE 'SESSION_COMPLETE'
    END,
    'local-debug-ledger:' || users.id || ':' || events.event_no,
    now() - events.event_no * interval '18 hours'
FROM eligible_users AS users
CROSS JOIN ledger_events AS events
ON CONFLICT (id) DO UPDATE SET
    amount = EXCLUDED.amount,
    type = EXCLUDED.type,
    created_at = EXCLUDED.created_at;

-- 현재 브라우저에서 온보딩한 유저마다 친구 10명, 받은 요청 4명, 고정 친구 3명을 제공한다.
WITH viewer_users AS (
    SELECT id
    FROM users
    WHERE nickname IS NOT NULL
      AND is_deleted = false
      AND id::text NOT LIKE '10000000-0000-7000-8000-%'
), friend_users AS (
    SELECT id
    FROM users
    WHERE id::text BETWEEN
        '10000000-0000-7000-8000-000000000001'
        AND '10000000-0000-7000-8000-000000000010'
)
INSERT INTO friendships
    (id, from_user_id, to_user_id, status, created_at, updated_at)
SELECT md5('local-friend-' || viewers.id || '-' || friends.id)::uuid,
       viewers.id, friends.id, 'ACCEPTED', now() - interval '20 days', now()
FROM viewer_users AS viewers
CROSS JOIN friend_users AS friends
ON CONFLICT (from_user_id, to_user_id) DO UPDATE SET
    status = 'ACCEPTED',
    deleted_at = NULL,
    updated_at = now();

WITH viewer_users AS (
    SELECT id
    FROM users
    WHERE nickname IS NOT NULL
      AND is_deleted = false
      AND id::text NOT LIKE '10000000-0000-7000-8000-%'
), requester_users AS (
    SELECT id
    FROM users
    WHERE id::text BETWEEN
        '10000000-0000-7000-8000-000000000011'
        AND '10000000-0000-7000-8000-000000000014'
)
INSERT INTO friendships
    (id, from_user_id, to_user_id, status, created_at, updated_at)
SELECT md5('local-request-' || requesters.id || '-' || viewers.id)::uuid,
       requesters.id, viewers.id, 'PENDING', now() - interval '2 days', now()
FROM viewer_users AS viewers
CROSS JOIN requester_users AS requesters
ON CONFLICT (from_user_id, to_user_id) DO UPDATE SET
    status = 'PENDING',
    deleted_at = NULL,
    updated_at = now();

WITH viewer_users AS (
    SELECT id
    FROM users
    WHERE nickname IS NOT NULL
      AND is_deleted = false
      AND id::text NOT LIKE '10000000-0000-7000-8000-%'
), pinned_friends AS (
    SELECT id
    FROM users
    WHERE id::text BETWEEN
        '10000000-0000-7000-8000-000000000001'
        AND '10000000-0000-7000-8000-000000000003'
)
INSERT INTO pinned_users (id, user_id, pinned_user_id, created_at)
SELECT md5('local-pin-' || viewers.id || '-' || friends.id)::uuid,
       viewers.id, friends.id, now()
FROM viewer_users AS viewers
CROSS JOIN pinned_friends AS friends
ON CONFLICT (user_id, pinned_user_id) DO NOTHING;

-- 전체 로컬 유저를 대표 그룹에 넣어 멤버·집중 상태·랭킹 화면이 빈 화면이 되지 않게 한다.
INSERT INTO group_members
    (id, user_id, group_id, role, status, announcement_permission,
     notification_enabled, is_left, created_at, updated_at)
SELECT md5('local-main-group-' || users.id)::uuid,
       users.id,
       '20000000-0000-7000-8000-000000000001'::uuid,
       'MEMBER',
       CASE WHEN row_number() OVER (ORDER BY users.id) % 7 = 0 THEN 'FOCUS' ELSE 'INACTIVE' END,
       'DISALLOW', true, false, now() - interval '20 days', now()
FROM users
WHERE users.nickname IS NOT NULL AND users.is_deleted = false
ON CONFLICT (user_id, group_id) DO UPDATE SET
    status = EXCLUDED.status,
    notification_enabled = true,
    is_left = false,
    left_reason = NULL,
    updated_at = now();

WITH announcements(id, title, content, author_id, age) AS (
    VALUES
        ('30000000-0000-7000-8000-000000000001'::uuid, '이번 주 집중 목표', '평일에는 하루 2시간, 주말에는 하루 3시간을 함께 채워봐요.', '10000000-0000-7000-8000-000000000001'::uuid, interval '1 hour'),
        ('30000000-0000-7000-8000-000000000002'::uuid, '아침 인증 안내', '오전 6시부터 9시 사이에 집중 세션을 시작하면 됩니다.', '10000000-0000-7000-8000-000000000001'::uuid, interval '1 day'),
        ('30000000-0000-7000-8000-000000000003'::uuid, '새 멤버 환영해요', '각자 준비하는 목표와 이번 주 계획을 소개해주세요.', '10000000-0000-7000-8000-000000000002'::uuid, interval '3 days'),
        ('30000000-0000-7000-8000-000000000004'::uuid, '주말 모각공', '토요일 오전 10시에 두 시간 동안 같이 집중해요.', '10000000-0000-7000-8000-000000000003'::uuid, interval '5 days'),
        ('30000000-0000-7000-8000-000000000005'::uuid, '집중 팁 공유', '알림을 잠시 끄고 시작 전에 오늘 할 일을 한 줄로 적어보세요.', '10000000-0000-7000-8000-000000000004'::uuid, interval '7 days')
)
INSERT INTO group_announcements
    (id, group_id, user_id, title, content, created_at, updated_at)
SELECT id, '20000000-0000-7000-8000-000000000001'::uuid,
       author_id, title, content, now() - age, now() - age
FROM announcements
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    deleted_at = NULL,
    updated_at = EXCLUDED.updated_at;

-- 기본 태그 4개와 최근 30일의 실제 세션 내역을 만들어 통계 상세·히트맵·프로필을 채운다.
WITH eligible_users AS (
    SELECT id
    FROM users
    WHERE nickname IS NOT NULL AND is_deleted = false
), chosen_tags AS (
    SELECT id
    FROM default_tags
    WHERE name IN ('이론 공부', '문제 풀이', '복습', '프로젝트')
)
INSERT INTO user_focus_tags (id, user_id, default_tag_id, created_at)
SELECT md5('local-user-tag-' || users.id || '-' || tags.id)::uuid,
       users.id, tags.id, now() - interval '60 days'
FROM eligible_users AS users
CROSS JOIN chosen_tags AS tags
WHERE NOT EXISTS (
    SELECT 1
    FROM user_focus_tags existing
    WHERE existing.user_id = users.id
      AND existing.default_tag_id = tags.id
      AND existing.deleted_at IS NULL
)
ON CONFLICT (id) DO UPDATE SET deleted_at = NULL;

WITH eligible_users AS (
    SELECT id, row_number() OVER (ORDER BY id)::integer AS user_no
    FROM users
    WHERE nickname IS NOT NULL AND is_deleted = false
), days AS (
    SELECT generate_series(0, 29) AS day_no
), session_numbers AS (
    SELECT generate_series(0, 1) AS session_no
), session_rows AS (
    SELECT
        users.id AS user_id,
        users.user_no,
        days.day_no,
        sessions.session_no,
        current_date - days.day_no AS focus_date,
        (((current_date - days.day_no)::date + time '08:00') AT TIME ZONE 'Asia/Seoul')
            + sessions.session_no * interval '5 hours' AS started_at,
        1500 + users.user_no * 35 + sessions.session_no * 600 + (days.day_no % 4) * 180
            AS duration_seconds
    FROM eligible_users AS users
    CROSS JOIN days
    CROSS JOIN session_numbers AS sessions
)
INSERT INTO focus_sessions
    (id, user_id, focus_tag_id, daily_focus_stat_id, status, focus_type,
     started_at, ended_at, stat_end_at, focus_seconds_by_date,
     total_distraction_seconds, created_at)
SELECT
    md5('local-session-' || sessions.user_id || '-' || sessions.day_no || '-' || sessions.session_no)::uuid,
    sessions.user_id,
    tags.id,
    stats.id,
    'COMPLETED',
    CASE sessions.session_no WHEN 0 THEN 'POMODORO' ELSE 'RANGE' END,
    sessions.started_at,
    sessions.started_at + sessions.duration_seconds * interval '1 second',
    sessions.started_at + sessions.duration_seconds * interval '1 second',
    jsonb_build_object(sessions.focus_date::text, sessions.duration_seconds),
    30 + (sessions.day_no % 6) * 15,
    sessions.started_at
FROM session_rows AS sessions
JOIN daily_focus_stats AS stats
  ON stats.user_id = sessions.user_id AND stats.date = sessions.focus_date
LEFT JOIN LATERAL (
    SELECT tag.id
    FROM user_focus_tags AS tag
    WHERE tag.user_id = sessions.user_id AND tag.deleted_at IS NULL
    ORDER BY tag.id
    LIMIT 1
) AS tags ON true
ON CONFLICT (id) DO UPDATE SET
    focus_tag_id = EXCLUDED.focus_tag_id,
    daily_focus_stat_id = EXCLUDED.daily_focus_stat_id,
    status = 'COMPLETED',
    focus_type = EXCLUDED.focus_type,
    started_at = EXCLUDED.started_at,
    ended_at = EXCLUDED.ended_at,
    stat_end_at = EXCLUDED.stat_end_at,
    focus_seconds_by_date = EXCLUDED.focus_seconds_by_date,
    total_distraction_seconds = EXCLUDED.total_distraction_seconds;

WITH live_users AS (
    SELECT id, row_number() OVER (ORDER BY id) AS user_no
    FROM users
    WHERE id::text BETWEEN
        '10000000-0000-7000-8000-000000000001'
        AND '10000000-0000-7000-8000-000000000006'
)
INSERT INTO focus_sessions
    (id, user_id, focus_tag_id, status, focus_type, started_at,
     total_distraction_seconds, created_at)
SELECT md5('local-live-session-' || users.id)::uuid,
       users.id,
       tags.id,
       'ACTIVE',
       CASE WHEN users.user_no % 2 = 0 THEN 'POMODORO' ELSE 'INFINITE' END,
       now() - (10 + users.user_no * 3) * interval '1 minute',
       0,
       now() - (10 + users.user_no * 3) * interval '1 minute'
FROM live_users AS users
LEFT JOIN LATERAL (
    SELECT tag.id
    FROM user_focus_tags AS tag
    WHERE tag.user_id = users.id AND tag.deleted_at IS NULL
    ORDER BY tag.id
    LIMIT 1
) AS tags ON true
ON CONFLICT (id) DO UPDATE SET
    focus_tag_id = EXCLUDED.focus_tag_id,
    status = 'ACTIVE',
    focus_type = EXCLUDED.focus_type,
    started_at = EXCLUDED.started_at,
    ended_at = NULL,
    stat_end_at = NULL,
    total_distraction_seconds = 0;

-- 실행기 시작 뒤 새로 온보딩한 계정도 재시드 없이 즉시 풍부한 화면을 볼 수 있게 한다.
-- local DB에만 설치되며, nickname NULL→값 전이(프로필 등록)에서 정확히 한 번 실행된다.
CREATE OR REPLACE FUNCTION local_debug_enrich_profiled_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE users
    SET is_guest = false,
        stat_visibility = 'PUBLIC',
        tier_level = 3,
        updated_at = now()
    WHERE id = NEW.id;

    UPDATE user_wallets
    SET balance = GREATEST(balance, 5000), deleted_at = NULL, updated_at = now()
    WHERE user_id = NEW.id;

    INSERT INTO user_streaks
        (user_id, streak_count, longest_streak_count, last_session_date, updated_at)
    VALUES (NEW.id, 7, 21, current_date, now())
    ON CONFLICT (user_id) DO UPDATE SET
        streak_count = EXCLUDED.streak_count,
        longest_streak_count = EXCLUDED.longest_streak_count,
        last_session_date = EXCLUDED.last_session_date,
        deleted_at = NULL,
        updated_at = now();

    INSERT INTO daily_focus_stats
        (id, user_id, date, total_focus_seconds, total_distraction_seconds,
         session_count, is_focus_time_goal_achieved, updated_at)
    SELECT md5('local-focus-' || NEW.id || '-' || days.day_no)::uuid,
           NEW.id,
           current_date - days.day_no,
           2400 + (days.day_no % 7) * 360,
           45 + (days.day_no % 5) * 20,
           2 + (days.day_no % 3),
           (2400 + (days.day_no % 7) * 360) >= 3600,
           now()
    FROM generate_series(0, 89) AS days(day_no)
    ON CONFLICT (user_id, date) DO NOTHING;

    INSERT INTO daily_screen_time_stats
        (id, user_id, date, total_screen_time_minutes, is_screen_time_goal_achieved,
         is_screen_time_finalized, created_at, updated_at)
    SELECT md5('local-screen-' || NEW.id || '-' || days.day_no)::uuid,
           NEW.id,
           current_date - days.day_no,
           145 + (days.day_no % 6) * 9,
           (145 + (days.day_no % 6) * 9) <= 180,
           true,
           now(),
           now()
    FROM generate_series(0, 89) AS days(day_no)
    ON CONFLICT (user_id, date) DO NOTHING;

    INSERT INTO friendships
        (id, from_user_id, to_user_id, status, created_at, updated_at)
    SELECT md5('local-friend-' || NEW.id || '-' || friends.id)::uuid,
           NEW.id, friends.id, 'ACCEPTED', now() - interval '20 days', now()
    FROM users AS friends
    WHERE friends.id::text BETWEEN
        '10000000-0000-7000-8000-000000000001'
        AND '10000000-0000-7000-8000-000000000010'
    ON CONFLICT (from_user_id, to_user_id) DO UPDATE SET
        status = 'ACCEPTED', deleted_at = NULL, updated_at = now();

    INSERT INTO friendships
        (id, from_user_id, to_user_id, status, created_at, updated_at)
    SELECT md5('local-request-' || requesters.id || '-' || NEW.id)::uuid,
           requesters.id, NEW.id, 'PENDING', now() - interval '2 days', now()
    FROM users AS requesters
    WHERE requesters.id::text BETWEEN
        '10000000-0000-7000-8000-000000000011'
        AND '10000000-0000-7000-8000-000000000014'
    ON CONFLICT (from_user_id, to_user_id) DO UPDATE SET
        status = 'PENDING', deleted_at = NULL, updated_at = now();

    INSERT INTO pinned_users (id, user_id, pinned_user_id, created_at)
    SELECT md5('local-pin-' || NEW.id || '-' || friends.id)::uuid,
           NEW.id, friends.id, now()
    FROM users AS friends
    WHERE friends.id::text BETWEEN
        '10000000-0000-7000-8000-000000000001'
        AND '10000000-0000-7000-8000-000000000003'
    ON CONFLICT (user_id, pinned_user_id) DO NOTHING;

    INSERT INTO group_members
        (id, user_id, group_id, role, status, announcement_permission,
         notification_enabled, is_left, created_at, updated_at)
    VALUES (
        md5('local-main-group-' || NEW.id)::uuid,
        NEW.id,
        '20000000-0000-7000-8000-000000000001'::uuid,
        'MEMBER', 'INACTIVE', 'DISALLOW', true, false, now(), now()
    )
    ON CONFLICT (user_id, group_id) DO UPDATE SET
        status = 'INACTIVE', notification_enabled = true,
        is_left = false, left_reason = NULL, updated_at = now();

    INSERT INTO currency_transactions
        (id, user_id, amount, type, idempotency_key, created_at)
    SELECT md5('local-ledger-' || NEW.id || '-' || events.event_no)::uuid,
           NEW.id,
           CASE WHEN events.event_no % 6 = 0 THEN 300 ELSE 20 + (events.event_no % 5) * 10 END,
           CASE
               WHEN events.event_no % 6 = 0 THEN 'PURCHASE'
               WHEN events.event_no % 5 = 0 THEN 'STREAK_BONUS'
               WHEN events.event_no % 4 = 0 THEN 'FOCUS_GOAL'
               WHEN events.event_no % 3 = 0 THEN 'SCREEN_TIME_GOAL'
               ELSE 'SESSION_COMPLETE'
           END,
           'local-debug-ledger:' || NEW.id || ':' || events.event_no,
           now() - events.event_no * interval '18 hours'
    FROM generate_series(0, 19) AS events(event_no)
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS local_debug_profile_enrichment ON users;
CREATE CONSTRAINT TRIGGER local_debug_profile_enrichment
AFTER UPDATE OF nickname ON users
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD.nickname IS NULL AND NEW.nickname IS NOT NULL)
EXECUTE FUNCTION local_debug_enrich_profiled_user();
