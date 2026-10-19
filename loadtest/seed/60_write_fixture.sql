-- 쓰기 시나리오 slot fixture 보충(로컬 전용 DB). psql 세션에서 write_slots(actor,partner,island,hub)를 먼저 COPY 한다.
-- · actor·partner 를 회원으로 전환 — 편지 보내기는 게스트에게 소셜 로그인을 요구한다(GuestAccountGuards).
-- · actor↔partner 친구(ACCEPTED) — 편지는 친구에게만 간다.
-- · island·hub 전망대(tower) 완공 — 섬 이동의 출발 섬 조건(construction.facility-gates.enforce=true 일 때만 의미).
\set ON_ERROR_STOP on
BEGIN;
UPDATE users SET is_guest = false WHERE id IN (SELECT actor FROM write_slots UNION SELECT partner FROM write_slots);
-- 양방향 기존 행(PENDING/REJECTED/CANCELED, 소프트 삭제 포함)을 ACCEPTED 로 되살린다 — 로컬 fixture 전용, 운영 데이터엔 쓰지 않는다. status CHECK 는 이 넷만 허용하고 별도 차단 상태는 없다.
-- 유니크 (from,to) 는 정방향만 막는다 — 반대 방향 행이 이미 있으면 그 행을 ACCEPTED 로 되살리고, 없을 때만 새로 넣는다(쌍 중복 방지).
UPDATE friendships f SET status = 'ACCEPTED', deleted_at = NULL
FROM write_slots w
WHERE (f.from_user_id = w.actor AND f.to_user_id = w.partner) OR (f.from_user_id = w.partner AND f.to_user_id = w.actor);
INSERT INTO friendships (id, from_user_id, to_user_id, status, created_at)
SELECT md5('write-friend-'||w.actor||'-'||w.partner)::uuid, w.actor, w.partner, 'ACCEPTED', now() - interval '7 days'
FROM write_slots w
WHERE NOT EXISTS (SELECT 1 FROM friendships f WHERE (f.from_user_id = w.actor AND f.to_user_id = w.partner) OR (f.from_user_id = w.partner AND f.to_user_id = w.actor))
ON CONFLICT DO NOTHING;
INSERT INTO island_facilities (island_id, building_id, status, cost, cost_revision, completed_at)
SELECT i, b, 'COMPLETED', 0, 1, now() - interval '7 days'
FROM (SELECT island AS i FROM write_slots UNION SELECT hub FROM write_slots) s
CROSS JOIN unnest(ARRAY['hall','board','gram','library','mail','tower','shop']) b
ON CONFLICT (island_id, building_id) DO UPDATE SET status = 'COMPLETED', completed_at = EXCLUDED.completed_at;
COMMIT;
ANALYZE;
