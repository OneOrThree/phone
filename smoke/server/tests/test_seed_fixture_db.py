"""임시 테이블만 쓰는 fixture SQL 검증. SMOKE_SEED_TEST_COMMAND에 psql 명령 JSON 배열을 지정한다."""
import json
import os
from pathlib import Path
import subprocess
import unittest

SQL=Path(__file__).resolve().parents[1].joinpath('seed-core-flow.sql').read_text()
USER='11111111-1111-4111-8111-111111111111'
ISLAND='22222222-2222-4222-8222-222222222222'
SESSION='33333333-3333-4333-8333-333333333333'
DEVICE='44444444-4444-4444-8444-444444444444'
NAME='smoke-core-'+DEVICE
SETUP='''
CREATE TEMP TABLE users(id uuid,is_guest boolean,is_deleted boolean,created_at timestamptz);
CREATE TEMP TABLE auth_sessions(id uuid,user_id uuid,revoked_at timestamptz);
CREATE TEMP TABLE islands(id uuid,name text,deleted_at timestamptz);
CREATE TEMP TABLE group_members(group_id uuid,user_id uuid,role text,is_left boolean);
CREATE TEMP TABLE focus_session_details(user_id uuid);
CREATE TEMP TABLE island_wallet_transactions(id uuid,island_id uuid,amount integer,type text,idempotency_key text);
CREATE TEMP TABLE shop_orders(island_id uuid);
CREATE TEMP TABLE owned_products(user_id uuid);
CREATE TEMP TABLE island_facilities(island_id uuid,building_id text,status text,cost int,cost_revision int,started_by uuid,started_at timestamptz,completes_at timestamptz,completed_at timestamptz);
CREATE TEMP TABLE island_wallets(island_id uuid,balance integer,version integer,updated_at timestamptz);
CREATE TEMP TABLE construction_cost_policy_publication(singleton boolean,revision int);
CREATE TEMP TABLE construction_cost_policies(revision int,building_id text,cost int);
CREATE TEMP TABLE island_appearances(island_id uuid,building_themes jsonb,version int,updated_at timestamptz);
CREATE TEMP TABLE focus_reward_policies(seconds_per_fish int,revision int,daily_cap_fish int);
INSERT INTO users VALUES ('{user}',true,false,now());
INSERT INTO auth_sessions VALUES ('{session}','{user}',NULL);
INSERT INTO islands VALUES ('{island}','{name}',NULL);
INSERT INTO group_members VALUES ('{island}','{user}','OWNER',false);
INSERT INTO island_wallets VALUES ('{island}',0,0,now());
INSERT INTO island_appearances VALUES ('{island}','{{"hall":"default"}}',0,now());
INSERT INTO construction_cost_policy_publication VALUES (true,1);
INSERT INTO construction_cost_policies VALUES (1,'board',5);
INSERT INTO focus_reward_policies VALUES (60,1,480);
'''.format(user=USER,session=SESSION,island=ISLAND,name=NAME)
HALL="INSERT INTO island_facilities VALUES ('%s','hall','COMPLETED',0,0,NULL,NULL,NULL,now());\n" % ISLAND

@unittest.skipUnless(os.environ.get('SMOKE_SEED_TEST_COMMAND'), '격리 psql 명령 미설정')
class SeedFixtureDatabaseTest(unittest.TestCase):
    def execute(self, mode, extra):
        variables=f"\\set user_id {USER}\n\\set island_id {ISLAND}\n\\set session_id {SESSION}\n\\set fixture_name {NAME}\n\\set fixture_mode {mode}\n"
        checks="SELECT json_build_object('facilities',(SELECT json_agg(building_id ORDER BY building_id) FROM island_facilities),'themes',(SELECT building_themes FROM island_appearances),'balance',(SELECT balance FROM island_wallets));\n"
        return subprocess.run(json.loads(os.environ['SMOKE_SEED_TEST_COMMAND']),input=variables+SETUP+extra+SQL+'\n'+checks,
                              text=True,capture_output=True,timeout=60)

    def test_core_preserves_hall_and_prepares_existing_fixture(self):
        result=self.execute('core',HALL)
        self.assertEqual(result.returncode,0,result.stderr)
        state=json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(state['facilities'],['hall','library','shop'])
        self.assertEqual(state['themes'],{'hall':'default','library':'default','shop':'default'})
        self.assertGreater(state['balance'],0)

    def test_statistics_preserves_hall(self):
        result=self.execute('statistics',HALL)
        self.assertEqual(result.returncode,0,result.stderr)
        state=json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(state['facilities'],['hall','library'])
        self.assertEqual(state['themes'],{'hall':'default','library':'default'})
        self.assertEqual(state['balance'],0)

    def test_missing_or_unexpected_facility_remains_blocked(self):
        extra="INSERT INTO island_facilities VALUES ('%s','board','COMPLETED',0,0,NULL,NULL,NULL,now());\n" % ISLAND
        for setup in ('',HALL+extra,HALL+"UPDATE island_facilities SET cost=1;\n"):
            with self.subTest(setup=setup):
                result=self.execute('core',setup)
                self.assertNotEqual(result.returncode,0)
                self.assertIn('이미 사용한 fixture',result.stderr)

if __name__=='__main__': unittest.main()
