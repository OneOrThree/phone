-- TC016 전용 두 신규 게스트 사이의 친구 관계만 초기 조건으로 준비한다.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE smoke_friend_input AS SELECT :'user_id'::uuid user_id,
  :'peer_id'::uuid peer_id, :'session_id'::uuid session_id,
  :'peer_session_id'::uuid peer_session_id, :'island_id'::uuid island_id;
SELECT pg_advisory_xact_lock(hashtextextended(island_id::text,0)) FROM smoke_friend_input;
DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM smoke_friend_input;
  IF f.user_id=f.peer_id OR f.session_id=f.peer_session_id THEN
    RAISE EXCEPTION '서로 다른 신규 게스트 두 명 필요';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users u JOIN auth_sessions s ON s.user_id=u.id
      WHERE u.id=f.user_id AND s.id=f.session_id AND s.revoked_at IS NULL
      AND u.is_guest AND NOT u.is_deleted AND u.created_at>now()-interval '30 minutes')
    OR NOT EXISTS (SELECT 1 FROM users u JOIN auth_sessions s ON s.user_id=u.id
      WHERE u.id=f.peer_id AND s.id=f.peer_session_id AND s.revoked_at IS NULL
      AND u.is_guest AND NOT u.is_deleted AND u.created_at>now()-interval '30 minutes') THEN
    RAISE EXCEPTION '신규 게스트 두 명 / 로그인 세션 대조 실패';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM islands g WHERE g.id=f.island_id AND g.deleted_at IS NULL
      AND g.name ~ '^smoke-friends-[0-9a-fA-F-]{36}$'
      AND g.created_at>now()-interval '30 minutes')
    OR (SELECT count(*) FROM group_members m WHERE m.group_id=f.island_id AND NOT m.is_left)<>2
    OR NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id=f.island_id
      AND m.user_id=f.user_id AND m.role='OWNER' AND NOT m.is_left)
    OR NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id=f.island_id
      AND m.user_id=f.peer_id AND m.role='MEMBER' AND NOT m.is_left) THEN
    RAISE EXCEPTION '전용 섬 / 방장·주민 두 명 대조 실패';
  END IF;
  -- 둘 중 누구라도 기존 관계를 갖고 있으면 임의로 덮어쓰지 않는다.
  IF EXISTS (SELECT 1 FROM friendships WHERE from_user_id IN (f.user_id,f.peer_id)
      OR to_user_id IN (f.user_id,f.peer_id)) THEN
    RAISE EXCEPTION '이미 친구 관계가 있는 fixture는 변경하지 않는다';
  END IF;
  INSERT INTO friendships(id,from_user_id,to_user_id,status,created_at,updated_at)
    VALUES(gen_random_uuid(),f.user_id,f.peer_id,'ACCEPTED',now(),now());
END $$;
COMMIT;
