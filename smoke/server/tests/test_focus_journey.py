"""신규 사용자 핵심 여정이 실패를 통과로 바꾸지 않는지 공개 HTTP 경계의 모의 서버로 검사한다."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[3]
ISLAND='11111111-1111-4111-8111-111111111111'
SESSION='22222222-2222-4222-8222-222222222222'


@unittest.skipUnless(shutil.which('jq'), 'jq 필요')
class FocusJourneyTest(unittest.TestCase):
    def run_flow(self, mode):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            driver=root/'api.py'
            driver.write_text('''import json,sys
from pathlib import Path
root=Path(sys.argv[1]);mode=sys.argv[2];method,path,body,key=sys.argv[3:7]
file=root/'calls.json';calls=json.loads(file.read_text()) if file.exists() else []
calls.append([method,path,body,key]);file.write_text(json.dumps(calls))
sid='22222222-2222-4222-8222-222222222222';count=sum(c[1]=='/focus-sessions' and c[0]=='POST' for c in calls);finish=sum(c[1].endswith('/finish') for c in calls)
status=200
if path=='/focus-sessions' and count==1: data={'id':sid,'status':'active','version':1,'startedAt':'2026-01-01T00:00:00Z','serverNow':'2026-01-01T00:00:00Z'}
elif path=='/focus-sessions' and count==2: data={'id':sid if mode!='start-replay' else 'wrong','status':'active','version':1}
elif path=='/focus-sessions': status=409;data={}
elif path.endswith('/pause'): data={'id':sid,'status':'paused','version':2,'activeSeconds':2}
elif path.endswith('/resume'): data={'id':sid,'status':'active','version':3,'activeSeconds':2}
elif path.endswith('/finish') and json.loads(body).get('expectedVersion')==0: status=409;data={}
elif path.endswith('/finish'): data={'recordId':sid,'activeSeconds':125,'earnedFish':0 if mode=='no-reward' else 1,'allocation':{'personalFishAdded':0,'constructionFishAdded':1},'completedAt':'2025-01-01T00:02:05Z' if mode=='bad-clock' else '2026-01-01T00:02:05Z'}
elif path=='/focus-sessions/current':
 phase=sum(c[1].endswith('/resume') for c in calls); paused=sum(c[1].endswith('/pause') for c in calls); finished=finish>1
 data=None if finished else {'id':sid,'status':'active' if phase or not paused else 'paused','version':3 if phase else (2 if paused else 1),'activeSeconds':99 if mode=='rest-ticks' and paused and not phase else 2}
elif path.endswith('/shop/wallets'): data={'villagePoints':0 if mode=='no-wallet' else (1 if finish>1 else 0)}
else: raise Exception(path)
(root/'body.json').write_text(json.dumps({'data':data} if status==200 else {'error':{'code':'STATE_CONFLICT'}}))
(root/'status').write_text(str(status))
''')
            shell=f'''source '{ROOT}/smoke/server/focus-journey.sh'
SMOKE_BODY_FILE='{root}/body.json'; TOKEN='token'; ISLAND_ID='{ISLAND}'; SESSION_ID=''; SMOKE_HTTP_CODE=200; SMOKE_FIRST_REWARD_SECONDS=60
smoke_request() {{ python3 '{driver}' '{root}' '{mode}' "$1" "$2" "${{3:-}}" "${{6:-}}"; SMOKE_HTTP_CODE=$(cat '{root}/status'); }}
smoke_ok() {{ [[ "$SMOKE_HTTP_CODE" == 200 ]]; }}
smoke_uuid() {{ python3 -c 'import uuid; print(uuid.uuid4())'; }}
sleep() {{ :; }}
record() {{ printf '%s %s %s\\n' "$1" "$2" "$3"; }}
focus_journey
printf 'session=%s\\n' "$SESSION_ID"
'''
            proc=subprocess.run(['bash','-u','-c',shell],capture_output=True,text=True,check=True)
            return proc.stdout,json.loads((root/'calls.json').read_text())

    def test_success_replays_and_checks_public_outcomes(self):
        output,calls=self.run_flow('success')
        self.assertIn('020 PASS',output)
        starts=[c for c in calls if c[1]=='/focus-sessions']
        self.assertEqual(starts[0][3],starts[1][3])
        self.assertNotEqual(starts[1][3],starts[2][3])
        finishes=[c for c in calls if c[1].endswith('/finish')]
        self.assertEqual(finishes[-1][2:],finishes[-2][2:])
        self.assertIn('session=\n',output)

    def test_wrong_replay_rest_ticks_or_missing_reward_block(self):
        for mode in ['start-replay','rest-ticks','no-reward','no-wallet','bad-clock']:
            with self.subTest(mode=mode):self.assertIn('020 FAIL',self.run_flow(mode)[0])
