-- 쓰기 시나리오 slot fixture 보충(로컬 전용 DB). psql 세션에서 write_slots(actor,partner,island,hub)를 먼저 COPY 한다.
-- · actor·partner 를 회원으로 전환 — 편지 보내기는 게스트에게 소셜 로그인을 요구한다(GuestAccountGuards).
-- · actor↔partner 친구(ACCEPTED) — 편지는 친구에게만 간다.
-- · island·hub 전망대(tower) 완공 — 섬 이동의 출발 섬 조건(construction.facility-gates.enforce=true 일 때만 의미).
\set ON_ERROR_STOP on
BEGIN;
UPDATE users SET is_guest = false WHERE id IN (SELECT actor FROM write_slots UNION SELECT partner FROM write_slots);
INSERT INTO friendships (id, from_user_id, to_user_id, status, created_at)
SELECT md5('write-friend-'||actor||'-'||partner)::uuid, actor, partner, 'ACCEPTED', now() - interval '7 days'
FROM write_slots ON CONFLICT DO NOTHING;
INSERT INTO island_facilities (island_id, building_id, status, cost, cost_revision, completed_at)
SELECT i, b, 'COMPLETED', 0, 1, now() - interval '7 days'
FROM (SELECT island AS i FROM write_slots UNION SELECT hub FROM write_slots) s
CROSS JOIN unnest(ARRAY['hall','board','gram','library','mail','tower','shop']) b
ON CONFLICT (island_id, building_id) DO UPDATE SET status = 'COMPLETED', completed_at = EXCLUDED.completed_at;
COMMIT;
ANALYZE;
