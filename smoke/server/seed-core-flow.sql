-- TC014 신규 전용 게스트·섬만 준비한다. 기존 fixture / 사용자 / 사건을 reset하지 않는다.
-- psql -v user_id=UUID -v island_id=UUID -v session_id=UUID -v fixture_name=smoke-core-UUID
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE smoke_fixture_input AS SELECT :'user_id'::uuid user_id,
  :'island_id'::uuid island_id, :'session_id'::uuid session_id, :'fixture_name'::text fixture_name, :'fixture_mode'::text fixture_mode;
SELECT pg_advisory_xact_lock(hashtextextended(island_id::text, 0)) FROM smoke_fixture_input;
DO $$
DECLARE f record; funding integer; price_revision integer;
BEGIN
  SELECT * INTO f FROM smoke_fixture_input;
  IF NOT EXISTS (SELECT 1 FROM users u JOIN auth_sessions s ON s.user_id=u.id
      WHERE u.id=f.user_id AND u.is_guest AND NOT u.is_deleted AND s.id=f.session_id
      AND s.revoked_at IS NULL AND u.created_at > now()-interval '30 minutes') THEN
    RAISE EXCEPTION '신규 게스트 / 로그인 세션 대조 실패';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM islands g JOIN group_members m ON m.group_id=g.id
      WHERE g.id=f.island_id AND g.name=f.fixture_name AND g.name LIKE 'smoke-core-%'
      AND g.deleted_at IS NULL AND m.user_id=f.user_id AND m.role='OWNER' AND NOT m.is_left)
      OR (SELECT count(*) FROM group_members WHERE group_id=f.island_id AND NOT is_left)<>1 THEN
    RAISE EXCEPTION '전용 단독 섬 / 방장 대조 실패';
  END IF;
  IF EXISTS (SELECT 1 FROM focus_session_details WHERE user_id=f.user_id)
      OR EXISTS (SELECT 1 FROM island_wallet_transactions WHERE island_id=f.island_id)
      OR EXISTS (SELECT 1 FROM shop_orders WHERE island_id=f.island_id)
      OR EXISTS (SELECT 1 FROM owned_products WHERE user_id=f.user_id)
      OR EXISTS (SELECT 1 FROM island_facilities WHERE island_id=f.island_id)
      OR NOT EXISTS (SELECT 1 FROM island_wallets WHERE island_id=f.island_id AND balance=0) THEN
    RAISE EXCEPTION '이미 사용한 fixture는 변경하지 않는다';
  END IF;
  IF f.fixture_mode NOT IN ('core', 'statistics') THEN
    RAISE EXCEPTION 'fixture 모드 오류';
  END IF;
  -- TC015는 상점 구매와 독립적이다. 신규 섬 도서관만 준비하며 자금/카탈로그는 손대지 않는다.
  IF f.fixture_mode='statistics' THEN
    SELECT revision INTO STRICT price_revision FROM construction_cost_policy_publication WHERE singleton;
    INSERT INTO island_facilities(island_id,building_id,status,cost,cost_revision,started_by,started_at,completes_at,completed_at)
      VALUES(f.island_id,'library','COMPLETED',0,price_revision,f.user_id,now(),now(),now());
    UPDATE island_appearances SET building_themes='{"library":"default"}'::jsonb,
      version=version+1,updated_at=now() WHERE island_id=f.island_id;
    RETURN;
  END IF;
  SELECT revision INTO STRICT price_revision FROM construction_cost_policy_publication WHERE singleton;
  SELECT greatest(10000, cost+100) INTO funding FROM construction_cost_policies
      WHERE revision=price_revision AND building_id='hall';
  IF funding IS NULL THEN RAISE EXCEPTION '회관 비용 정책 없음'; END IF;
  UPDATE island_wallets SET balance=funding, version=version+1, updated_at=now() WHERE island_id=f.island_id;
  INSERT INTO island_wallet_transactions(id,island_id,amount,type,idempotency_key)
    VALUES(gen_random_uuid(),f.island_id,funding,'CONTRIBUTION','smoke-fixture:'||f.island_id);
  -- 상점/통계 잠금 해제만 fixture로 준비. 회관 착공은 API로 검증한다.
  INSERT INTO island_facilities(island_id,building_id,status,cost,cost_revision,started_by,started_at,completes_at,completed_at)
    SELECT f.island_id,b,'COMPLETED',0,price_revision,f.user_id,now(),now(),now()
    FROM unnest(ARRAY['shop','library']) b;
  UPDATE island_appearances SET building_themes='{"shop":"default","library":"default"}'::jsonb,
    version=version+1,updated_at=now() WHERE island_id=f.island_id;
END $$;
SELECT json_build_object('secondsPerFish',seconds_per_fish,'policyRevision',revision,
    'dailyCapFish',daily_cap_fish) FROM focus_reward_policies ORDER BY revision DESC LIMIT 1;
COMMIT;
