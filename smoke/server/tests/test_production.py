import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'contracts'))
import production as p
class ProductionTest(unittest.TestCase):
 def run_check(self,bad=None):
  self.calls=[]
  def send(method,path,token):
   self.calls.append((method,path))
   path=path.split('?')[0]
   if path==bad:return 404,{}
   payload={'/me':{'id':'11111111-1111-4111-8111-111111111111','name':None,'catColor':None,'mainIslandId':None},'/me/islands':{'items':[],'currentIslandId':None},'/me/telescope':{'items':[]},'/screens/home':{'buildings':[],'members':{'items':[]},'wallets':{'fish':0,'villagePoints':0}}}
   if method=='POST':return 400,{'error':{'code':'INVALID_PARAMETER','field':'islandId'}}
   return 200,{'data':payload[path]}
  with tempfile.TemporaryDirectory() as d:
   f=Path(d)/'fixture';f.write_text(json.dumps({'purpose':'phone-production-smoke','user_id':'11111111-1111-4111-8111-111111111111','access_token':'test-only'}));f.chmod(0o600)
   return p.check({'APP_PROD_SMOKE_FIXTURE':str(f)},send)
 def test_success_has_no_real_island_write(self):
  self.assertEqual(self.run_check()['checks'],5)
  self.assertEqual(self.calls[-1],('POST','/islands/not-a-uuid/intro-arrivals'))
 def test_404_blocks(self):
  with self.assertRaises(ValueError):self.run_check('/me/telescope')
 def test_missing_credentials_blocks(self):
  with self.assertRaises(ValueError):p.check({},lambda *a:self.fail('요청 금지'))
