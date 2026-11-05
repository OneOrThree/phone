"""첫 항해 실행기의 요청 순서·실패·멱등·정리 추적을 외부 서비스 없이 검증한다."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
ISLAND = '11111111-1111-4111-8111-111111111111'
DESTINATION = '22222222-2222-4222-8222-222222222222'


@unittest.skipUnless(shutil.which('jq'), 'jq 필요')
class FirstVoyageTest(unittest.TestCase):
    def run_flow(self, mode='success'):
        with tempfile.TemporaryDirectory() as directory:
            d = Path(directory)
            driver = d / 'driver.py'
            driver.write_text('''import json,sys
from pathlib import Path
root=Path(sys.argv[1]);mode=sys.argv[2];method,path=sys.argv[3:5]
log=root/'requests.json';calls=json.loads(log.read_text()) if log.exists() else []
calls.append([method,path,sys.argv[5:]]);log.write_text(json.dumps(calls))
posts=sum(c[0]=='POST' for c in calls)
island='11111111-1111-4111-8111-111111111111'
destination='22222222-2222-4222-8222-222222222222'
rc=0
if path=='/me/islands':
 data={'items':[],'currentIslandId':None} if posts==0 and mode!='existing' else {'items':[{'id':island}],'currentIslandId':island}
elif path=='/me/telescope': data={'items':[{'islandId':destination,'slot':'uninhabited'}]}
elif method=='POST':
 data={'islandId':island if mode!='wrong-replay' or posts==1 else destination,'currentIslandId':island,'membershipStatus':'active','arrivedBefore':True}
 if mode in ('404','lost-response'): rc=1;data={}
else: data={'buildings':[],'members':{'items':[]},'wallets':{'fish':0,'villagePoints':0}}
(root/'body.json').write_text(json.dumps({'data':data}))
sys.exit(rc)
''')
            shell = f'''
source '{ROOT}/smoke/server/first-voyage.sh'
SMOKE_BODY_FILE='{d}/body.json'; TOKEN='test-only'; MAIN_CREATED_ISLAND_ID=''
req() {{ python3 '{driver}' '{d}' '{mode}' "$@"; }}
smoke_request() {{ python3 '{driver}' '{d}' '{mode}' "$@"; }}
smoke_ok() {{ jq -e '.data != {{}}' "$SMOKE_BODY_FILE" >/dev/null; }}
smoke_uuid() {{ echo '33333333-3333-4333-8333-333333333333'; }}
record() {{ printf '%s %s\\n' "$1" "$2"; }}
first_voyage
printf 'cleanup=%s\\n' "$MAIN_CREATED_ISLAND_ID"
'''
            result = subprocess.run(['bash','-u','-c',shell],capture_output=True,text=True,check=True)
            calls=json.loads((d/'requests.json').read_text())
            return result.stdout,calls

    def test_full_journey_and_same_key_replay(self):
        output,calls=self.run_flow()
        self.assertIn('019 PASS',output)
        self.assertIn('cleanup='+ISLAND,output)
        posts=[c for c in calls if c[0]=='POST']
        self.assertEqual(len(posts),2)
        self.assertEqual(posts[0],posts[1])
        self.assertTrue(calls[-1][1].startswith('/screens/home?'))

    def test_existing_account_never_writes(self):
        output,calls=self.run_flow('existing')
        self.assertIn('019 FAIL',output)
        self.assertFalse(any(c[0]=='POST' for c in calls))

    def test_missing_route_and_lost_response_fail_and_track_cleanup(self):
        for mode in ('404','lost-response'):
            output,calls=self.run_flow(mode)
            self.assertIn('019 FAIL',output)
            self.assertEqual(sum(c[0]=='POST' for c in calls),1)
            self.assertIn('cleanup='+ISLAND,output)

    def test_replay_different_island_fails(self):
        self.assertIn('019 FAIL',self.run_flow('wrong-replay')[0])

    def test_prod_and_reused_device_refused_before_network(self):
        for url,device in [('https://catus-api-v2.oneorthree.world',''),('https://oneorthree.dev.mooo.com','existing')]:
            env={'PATH':__import__('os').environ['PATH'],'BASE_URL':url,'SMOKE_DEVICE_ID':device,'SMOKE_FIRST_VOYAGE_ENABLED':'1'}
            result=subprocess.run(['bash',str(ROOT/'smoke/server/run.sh')],env=env,capture_output=True,text=True)
            self.assertEqual(result.returncode,2)
            self.assertIn('dev 주소',result.stderr)


if __name__ == '__main__':
    unittest.main()
