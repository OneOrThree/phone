-- 팩트 테이블 서버사이드 생성 (post-V7 스키마) — psql -d golden -v scale=1 -f 20_facts.sql
-- 결정론: setseed 고정 + md5 UUID 공식(10_dimensions.mjs 와 공유). 볼륨 근거: volume.md
\set ON_ERROR_STOP on
SET synchronous_commit = off; -- 시드 세션 한정 — 유실 나면 재시드
SET work_mem = '256MB';
SELECT setseed(0.548);

-- 쿼리 관측 계층 ①(설계 §4) — shared_preload 는 수집만 하고, reset()/뷰 노출은 확장 생성이 필요.
-- golden 에 만들어 두면 TEMPLATE 복제된 loadtest/analysis 가 그대로 물려받는다.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 시간순 UUID — 상위 6바이트 = epoch ms → id DESC ≒ 시간 역순 (커서 페이지네이션 특성 보존)
CREATE OR REPLACE FUNCTION seed_uuid_v7(p_ts timestamptz) RETURNS uuid
LANGUAGE sql VOLATILE AS $$
  SELECT encode(
    overlay(uuid_send(gen_random_uuid())
      placing substring(int8send((extract(epoch FROM p_ts)*1000)::bigint) FROM 3)
      FROM 1 FOR 6), 'hex')::uuid
$$;

-- 차원 CSV 의 md5('user-'||n) 공식을 SQL 에서 재사용하기 위한 번호 매핑
CREATE TEMP TABLE seed_users AS SELECT id, row_number() OVER (ORDER BY id) AS n FROM users;
CREATE INDEX ON seed_users (n);
CREATE INDEX ON seed_users (id);
CREATE TEMP TABLE seed_groups AS SELECT id, row_number() OVER (ORDER BY id) AS n, status FROM groups;
ANALYZE seed_users; ANALYZE seed_groups;
SELECT max(n) AS n_users FROM seed_users \gset

-- ═══ 1. 유저 위성 1:1 ×5 ═══════════════════════════════════
INSERT INTO user_wallets (user_id, balance, version)
SELECT id, (random()*5000)::int, 0 FROM users;

INSERT INTO user_streaks (user_id, streak_count, longest_streak_count, last_session_date)
SELECT id, (random()*30)::int, (random()*120)::int, DATE '2026-07-01' - (random()*7)::int FROM users;

INSERT INTO user_focus_time_settings (user_id, daily_focus_time_goal_minutes)
SELECT id, 60 + ((random()*8)::int)*30 FROM users;

INSERT INTO user_notification_settings (user_id, notification_enabled, night_mode_enabled, sound_enabled)
SELECT id, true, random() < 0.3, true FROM users;

INSERT INTO user_screen_time_settings (user_id, daily_screen_time_goal_minutes, is_screen_time_permission_granted)
SELECT id, 120 + (random()*240)::int, random() < 0.8 FROM users;

-- ═══ 2. user_focus_tags (V4 — 유저×4, partial unique 충족: i별 상이한 default_tag) ═══
INSERT INTO user_focus_tags (id, user_id, default_tag_id, created_at)
SELECT md5('utag-'||u.n||'-'||i)::uuid, u.id,
       md5('dtag-'||((u.n + i) % 40))::uuid,
       timestamptz '2026-07-01' - interval '150 days'
FROM seed_users u CROSS JOIN generate_series(1, 4) i;

-- ═══ 3. currency_transactions (유저×50 = 500만) ═══
INSERT INTO currency_transactions (id, user_id, type, amount, idempotency_key, created_at)
SELECT md5('ct-'||u.n||'-'||i)::uuid, u.id,
       CASE WHEN t.r < 0.6 THEN 'SESSION_COMPLETE' WHEN t.r < 0.8 THEN 'STREAK_BONUS' ELSE 'PURCHASE' END,
       CASE WHEN t.r < 0.8 THEN 10 + (random()*90)::int ELSE -(100 + (random()*400)::int) END,
       md5('ct-'||u.n||'-'||i),
       timestamptz '2026-07-01' - random() * interval '180 days'
FROM seed_users u
CROSS JOIN generate_series(1, 50) i
CROSS JOIN LATERAL (SELECT random() AS r) t;

-- ═══ 4. friendships (유저×20 ≈ 200만, deleted_at 5%) + pinned_users ═══
INSERT INTO friendships (id, from_user_id, to_user_id, status, created_at, deleted_at)
SELECT md5('fr-'||u.n||'-'||i)::uuid, u.id, t2.id,
       CASE WHEN t.r < 0.85 THEN 'ACCEPTED' WHEN t.r < 0.95 THEN 'PENDING' ELSE 'REJECTED' END,
       timestamptz '2026-07-01' - random() * interval '180 days',
       CASE WHEN random() < 0.05 THEN timestamptz '2026-07-01' - random() * interval '30 days' END
FROM seed_users u
CROSS JOIN generate_series(1, 20) i
JOIN seed_users t2 ON t2.n = ((u.n * 31 + i * 7919) % :n_users) + 1
CROSS JOIN LATERAL (SELECT random() AS r) t
WHERE t2.id <> u.id
ON CONFLICT DO NOTHING;

-- V3 리네임 반영: pinned_users(pinned_user_id) — ACCEPTED 친구의 10% 고정핀 (~20만)
INSERT INTO pinned_users (id, user_id, pinned_user_id, created_at)
SELECT md5('pin-'||f.id)::uuid, f.from_user_id, f.to_user_id, timestamptz '2026-07-01' - interval '10 days'
FROM friendships f
WHERE f.status = 'ACCEPTED' AND f.deleted_at IS NULL AND random() < 0.1
ON CONFLICT DO NOTHING;

-- ═══ 5. 그룹 멤버·챌린지 (V5 CTI · V7 멤버 공지권한) ═══
-- memberIdx(g,i) = (g*17 + i*53) % n_users + 1. V7 로 groups.host_id 가 사라져
-- 방장의 단일 원천은 여기 i=1 의 role=OWNER (announcement_permission 도 OWNER 만 ALLOW).
INSERT INTO group_members (id, group_id, user_id, role, status, is_left,
                           notification_enabled, announcement_permission, created_at)
SELECT md5('gm-'||g.n||'-'||i)::uuid, g.id, su.id,
       CASE WHEN i = 1 THEN 'OWNER' ELSE 'MEMBER' END,
       CASE WHEN t.r < 0.6 THEN 'INACTIVE' WHEN t.r < 0.85 THEN 'CHALLENGE' ELSE 'FOCUS' END,
       random() < 0.05, true,
       CASE WHEN i = 1 THEN 'ALLOW' ELSE 'DISALLOW' END,
       timestamptz '2026-07-01' - random() * interval '120 days'
FROM seed_groups g
CROSS JOIN generate_series(1, 20) i
JOIN seed_users su ON su.n = ((g.n * 17 + i * 53) % :n_users) + 1
CROSS JOIN LATERAL (SELECT random() AS r) t
ON CONFLICT DO NOTHING;

-- 챌린지 (그룹×4 = 20만) — V5: 파라미터는 CTI 상세 테이블 소유.
-- V34~V36 정합(GROMO-1260·1261·1405·1422): repeat_days(1~127)·started_at NOT NULL, 종료 상태는
-- INACTIVE 가 아니라 ENDED(+ended_at), durations 는 부모 category 복사(복합 FK)와 카테고리별
-- 상한 CHECK(FOCUS ≤1080·SCREEN_TIME ≤720), windows 는 time 타입(window_start < window_end).
INSERT INTO group_challenges (id, group_id, type, category, status, created_at,
                              repeat_days, started_at, ended_at)
SELECT md5('gch-'||g.n||'-'||i)::uuid, g.id,
       CASE WHEN (g.n + i) % 2 = 0 THEN 'DURATION' ELSE 'TIME_WINDOW' END,
       CASE WHEN (g.n + i) % 3 = 0 THEN 'SCREEN_TIME' ELSE 'FOCUS' END,
       CASE WHEN i = 4 AND g.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'ENDED' END,
       c.created_at,
       -- 요일 분포: 평일(31)·월수금(21)·매일(127) — 활성(i=4)은 매일이라 부하 시나리오가 결정적이다
       CASE i WHEN 1 THEN 31 WHEN 2 THEN 21 ELSE 127 END,
       c.created_at,   -- V34 백필과 같은 의미: 생성 즉시 시작
       CASE WHEN i = 4 AND g.status = 'ACTIVE' THEN NULL
            ELSE c.created_at + interval '14 days' END
FROM seed_groups g
CROSS JOIN generate_series(1, 4) i
-- LATERAL 하위 쿼리는 외부 행을 참조해야 행마다 재평가된다 — 무상관이면 PG 가 1회만 평가해
-- 20만 행의 created_at 이 한 시각에 몰린다. WHERE 의 i 참조가 상관을 강제한다(항상 참).
CROSS JOIN LATERAL (SELECT timestamptz '2026-07-01' - random() * interval '90 days' AS created_at
                    WHERE i > 0) c;

INSERT INTO group_challenge_durations (challenge_id, category, duration_minutes)
SELECT id, category, 30 + ((random()*6)::int)*15 FROM group_challenges WHERE type = 'DURATION';

-- 창은 KST 벽시계 time — 06~15시 시작 + 4시간 창이라 항상 start < end (자정 걸침 금지, V35 CHECK)
INSERT INTO group_challenge_windows (challenge_id, window_start, window_end)
SELECT id,
       make_time(6 + (abs(hashtext(id::text)) % 10), 0, 0),
       make_time(6 + (abs(hashtext(id::text)) % 10) + 4, 0, 0)
FROM group_challenges WHERE type = 'TIME_WINDOW';

-- 챌린지 멤버 (챌린지×10 = 200만) — 그룹 멤버 공식의 부분집합이라 FK·유저 정합 보장
INSERT INTO group_challenge_members (id, group_challenge_id, user_id, is_achieved, progress_minutes, created_at)
SELECT md5('gcm-'||g.n||'-'||ci||'-'||i)::uuid, md5('gch-'||g.n||'-'||ci)::uuid, su.id,
       random() < 0.5, (random()*120)::int,
       timestamptz '2026-07-01' - random() * interval '60 days'
FROM seed_groups g
CROSS JOIN generate_series(1, 4) ci
CROSS JOIN generate_series(1, 10) i
JOIN seed_users su ON su.n = ((g.n * 17 + (((i * 3) % 20) + 1) * 53) % :n_users) + 1
ON CONFLICT DO NOTHING;

-- ═══ 6. 리그 (12주 히스토리 — arena ≈ 4만, arena_users ≈ 120만) ═══
CREATE TEMP TABLE seed_arenas AS
SELECT md5('arena-'||w||'-'||a)::uuid AS id, w, a, (a % 5) + 1 AS tier
FROM generate_series(0, 11) w, generate_series(0, (:n_users / 30) - 1) a;

INSERT INTO league_arenas (id, tier_level, status, started_at, ended_at, created_at)
SELECT id, tier,
       CASE WHEN w = 0 THEN 'ACTIVE' ELSE 'ENDED' END,
       timestamptz '2026-06-29' - w * interval '7 days',
       CASE WHEN w = 0 THEN NULL ELSE timestamptz '2026-06-29' - (w - 1) * interval '7 days' END,
       timestamptz '2026-06-29' - w * interval '7 days'
FROM seed_arenas;

INSERT INTO league_arena_users (id, league_arena_id, user_id, tier_level, rank, total_focus_minutes, result)
SELECT md5('lau-'||ar.w||'-'||ar.a||'-'||s)::uuid, ar.id, su.id, ar.tier,
       CASE WHEN ar.w = 0 THEN NULL ELSE s + 1 END,
       (random()*1200)::int,
       CASE WHEN ar.w = 0 THEN NULL
            WHEN s < 5 THEN 'PROMOTED'
            WHEN s >= 25 THEN 'RELEGATED'
            WHEN s >= 22 THEN 'RELEGATE_WARNING'
            ELSE 'STAY' END
FROM seed_arenas ar
CROSS JOIN generate_series(0, 29) s
JOIN seed_users su ON su.n = ((ar.a * 30 + s + ar.w * 13) % :n_users) + 1;

-- ═══ 7. 인벤토리·장비 ═══
INSERT INTO user_items (id, user_id, item_id, created_at, is_used)
SELECT md5('ui-'||u.n||'-'||i)::uuid, u.id, md5('item-'||((u.n * 7 + i * 13) % 500))::uuid,
       timestamptz '2026-07-01' - random() * interval '90 days', false
FROM seed_users u CROSS JOIN generate_series(1, 10) i
ON CONFLICT DO NOTHING;

-- 슬롯 일치 보장: items.csv 에서 slot = SLOTS[idx%4], 여기서 idx = (i-1) + 4k → idx%4 = i-1
INSERT INTO character_equipment (id, user_id, item_id, slot_type, created_at)
SELECT md5('ce-'||u.n||'-'||i)::uuid, u.id,
       md5('item-'||((i - 1) + 4 * (u.n % 100)))::uuid,
       (ARRAY['HAIR','TOP','BOTTOM','SHOES'])[i],
       timestamptz '2026-07-01' - interval '30 days'
FROM seed_users u CROSS JOIN generate_series(1, 4) i;

-- ═══ 8. 포모도로 프리셋 (V6 마스터) ═══
INSERT INTO focus_sessions_pomodoro_setting (id, name, focus_minutes, break_minutes, is_default)
VALUES (md5('pomoset-1')::uuid, '클래식 25/5', 25, 5, true),
       (md5('pomoset-2')::uuid, '딥워크 50/10', 50, 10, false),
       (md5('pomoset-3')::uuid, '스프린트 15/3', 15, 3, false);

-- ═══ 9. 대형 4테이블 — 제약 저장→드롭→적재 (복원은 30_constraints_indexes.sql) ═══
DROP TABLE IF EXISTS seed_saved_constraints;
CREATE TABLE seed_saved_constraints AS
SELECT c.conrelid::regclass::text AS tbl, c.conname,
       pg_get_constraintdef(c.oid) AS def,
       CASE c.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 ELSE 2 END AS ord
FROM pg_constraint c
WHERE c.contype IN ('p', 'u', 'f')
  AND (c.conrelid::regclass::text IN ('daily_focus_stats','daily_screen_time_stats','focus_sessions','focus_session_pomodoros')
       OR (c.confrelid <> 0 AND c.confrelid::regclass::text IN ('daily_focus_stats','daily_screen_time_stats','focus_sessions','focus_session_pomodoros')));

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tbl, conname FROM seed_saved_constraints ORDER BY ord DESC LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
  END LOOP;
END $$;

-- 9-1. daily_focus_stats (~1,200만 — 유저별 활동일 60~180, 평균 120)
INSERT INTO daily_focus_stats (id, user_id, date, is_focus_time_goal_achieved,
                               total_focus_seconds, total_distraction_seconds, session_count, updated_at)
SELECT md5('dfs-'||u.n||'-'||d)::uuid, u.id, DATE '2026-07-01' - d,
       random() < 0.4,
       s.sc * (1200 + (random()*2400)::int),
       (random()*1800)::int,
       s.sc,
       timestamptz '2026-07-01'
FROM (SELECT id, n, 60 + (random()*120)::int AS active_days FROM seed_users) u
CROSS JOIN generate_series(0, 179) d
CROSS JOIN LATERAL (SELECT 1 + (random()*3.0)::int AS sc) s -- 1~4회/일, 평균 2.5
WHERE random() < u.active_days / 180.0;

-- 9-2. daily_screen_time_stats (~1,200만)
INSERT INTO daily_screen_time_stats (id, user_id, date, total_screen_time_minutes,
                                     is_screen_time_goal_achieved, created_at, updated_at)
SELECT md5('dsts-'||u.n||'-'||d)::uuid, u.id, DATE '2026-07-01' - d,
       60 + (random()*480)::int, random() < 0.5,
       timestamptz '2026-07-01', timestamptz '2026-07-01'
FROM (SELECT id, n, 60 + (random()*120)::int AS active_days FROM seed_users) u
CROSS JOIN generate_series(0, 179) d
WHERE random() < u.active_days / 180.0;

-- 9-3. focus_sessions (~3,000만 = dfs 행 × session_count) ⭐ Phase 1 표적
--   id = seed_uuid_v7(started_at) — 커서(ORDER BY id DESC) 특성 보존
--   focus_tag_id = 유저 채택 태그 4개 중 결정론 유도 (V4: user_focus_tags FK)
INSERT INTO focus_sessions (id, user_id, focus_tag_id, daily_focus_stat_id, status, focus_type,
                            started_at, ended_at, total_distraction_seconds, created_at)
SELECT seed_uuid_v7(st.started_at), dfs.user_id,
       md5('utag-'||su.n||'-'||(1 + (random()*3)::int))::uuid,
       dfs.id,
       CASE WHEN random() < 0.97 THEN 'COMPLETED' ELSE 'CANCELED' END,
       CASE WHEN t.r < 0.6 THEN 'INFINITE' WHEN t.r < 0.85 THEN 'RANGE' ELSE 'POMODORO' END,
       st.started_at, st.started_at + st.dur,
       (random() * extract(epoch FROM st.dur) * 0.2)::int,
       st.started_at + st.dur
FROM daily_focus_stats dfs
JOIN seed_users su ON su.id = dfs.user_id
CROSS JOIN LATERAL generate_series(1, dfs.session_count) g
CROSS JOIN LATERAL (
  SELECT dfs.date::timestamptz + interval '6 hours' + (g * 2 || ' hours')::interval
           + random() * interval '90 minutes' AS started_at,
         (15 + random()*75) * interval '1 minute' AS dur
) st
CROSS JOIN LATERAL (SELECT random() AS r) t;

-- 9-4. focus_session_pomodoros (V6 — POMODORO 세션 1:1, ~450만)
INSERT INTO focus_session_pomodoros (id, focus_session_id, pomodoro_setting_id,
                                     focus_minutes, break_minutes, set_count, created_at)
SELECT md5('pomo-'||fs.id)::uuid, fs.id,
       md5('pomoset-'||p.k)::uuid,
       CASE p.k WHEN 1 THEN 25 WHEN 2 THEN 50 ELSE 15 END,
       CASE p.k WHEN 1 THEN 5 WHEN 2 THEN 10 ELSE 3 END,
       1 + (random()*5)::int,
       fs.started_at
FROM focus_sessions fs
CROSS JOIN LATERAL (SELECT 1 + (random()*2.0)::int AS k) p
WHERE fs.focus_type = 'POMODORO';

-- 다음 단계: 30_constraints_indexes.sql (제약 복원 + VACUUM ANALYZE)
