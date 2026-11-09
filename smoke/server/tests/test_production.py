import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'contracts'))
import production as p

USER='11111111-1111-4111-8111-111111111111'
ISLAND='22222222-2222-4222-8222-222222222222'

class FakeAPI:
 def __init__(self,fail=None):
  self.calls=[];self.fail=fail;self.created=False;self.deleted=False;self.name=None;self.logins=0
 def __call__(self,method,path,token='',body=None,headers=None):
  path=path.split('?')[0];self.calls.append((method,path,body,headers))
  if path=='/auth/sessions/guest':
   self.logins+=1
   if self.fail=='login-lost' and self.logins==1:raise ValueError('응답 유실')
   return 201,{'data':{'userId':USER,'accessToken':'test-only'}}
  if method=='POST' and path=='/islands':
   self.created=True;self.name=body['name']
   if self.fail=='create-lost':raise ValueError('응답 유실')
   return 201,{'data':{'id':ISLAND}}
  if method=='DELETE' and path.endswith('/memberships/me'):
   if self.fail=='leave':return 500,{}
   self.created=False;return 200,{'data':{'left':True}}
  if method=='DELETE' and path=='/me':
   if self.fail=='withdraw':return 500,{}
   self.deleted=True;return 200,{'data':{'deleted':True}}
  if method=='POST':return 400,{'error':{'code':'INVALID_PARAMETER','field':'islandId'}}
  if path=='/me/telescope' and self.fail in ('404','exception'):
   if self.fail=='exception':raise RuntimeError('예상치 못한 오류')
   return 404,{}
  if path=='/me/telescope' and self.fail=='interrupt':raise KeyboardInterrupt()
  if path=='/islands/'+ISLAND and not self.created:return 404,{}
  data={'/me':{'id':USER,'name':None,'catColor':None,'mainIslandId':ISLAND},
        '/me/islands':{'items':[{'id':ISLAND,'name':self.name}] if self.created else [],'currentIslandId':ISLAND if self.created else None},
        '/islands/'+ISLAND:{'id':ISLAND,'name':self.name,'role':'host','memberCount':1},
        '/me/telescope':{'items':[]},
        '/screens/home':{'buildings':[],'members':{'items':[]},'wallets':{'fish':0,'villagePoints':0}}}
  return 200,{'data':data[path]}

class ProductionTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.directory=Path(self.tmp.name)/'state';self.env={'APP_PROD_SMOKE_STATE_DIR':str(self.directory)}
 def test_success_closes_island_and_withdraws_account(self):
  api=FakeAPI();self.assertEqual(p.check(self.env,api)['checks'],5)
  self.assertFalse(api.created);self.assertTrue(api.deleted)
  self.assertEqual(list(self.directory.glob('*.json')),[])
  self.assertEqual([c[:2] for c in api.calls if c[0]=='DELETE'],[('DELETE','/islands/'+ISLAND+'/memberships/me'),('DELETE','/me')])
  self.assertEqual(next(c[2] for c in api.calls if c[:2]==('POST','/islands'))['maxMembers'],1)
 def test_failure_exception_and_interruption_still_cleanup(self):
  for fail,exception in [('404',ValueError),('exception',RuntimeError),('interrupt',KeyboardInterrupt)]:
   api=FakeAPI(fail)
   with self.assertRaises(exception):p.check(self.env,api)
   self.assertFalse(api.created);self.assertTrue(api.deleted)
   self.assertEqual(list(self.directory.glob('*.json')),[])
 def test_creation_response_lost_is_discovered_and_cleaned(self):
  api=FakeAPI('create-lost')
  with self.assertRaises(ValueError):p.check(self.env,api)
  self.assertFalse(api.created);self.assertTrue(api.deleted)
 def test_guest_response_lost_recovers_same_device_and_deletes(self):
  api=FakeAPI('login-lost')
  with self.assertRaises(ValueError):p.check(self.env,api)
  logins=[c for c in api.calls if c[1]=='/auth/sessions/guest']
  self.assertEqual(logins[0][3],logins[1][3]);self.assertTrue(api.deleted)
 def test_cleanup_failure_blocks_and_keeps_private_record(self):
  for fail in ('leave','withdraw'):
   with self.subTest(fail=fail), tempfile.TemporaryDirectory() as d:
    env={'APP_PROD_SMOKE_STATE_DIR':d};Path(d).chmod(0o700);api=FakeAPI(fail)
    with self.assertRaisesRegex(ValueError,'출시 차단'):p.check(env,api)
    records=list(Path(d).glob('*.json'));self.assertEqual(len(records),1)
    self.assertEqual(records[0].stat().st_mode&0o777,0o600)
    with self.assertRaises(ValueError):p.check(env,lambda *a,**k:self.fail('새 요청 금지'))
    self.assertTrue(any(c[:2]==('DELETE','/me') for c in api.calls))
 def test_missing_or_public_directory_rejected(self):
  with self.assertRaises(ValueError):p.check({},lambda *a,**k:self.fail('요청 금지'))
  self.directory.mkdir(mode=0o755)
  with self.assertRaises(ValueError):p.check(self.env,lambda *a,**k:self.fail('요청 금지'))
 def test_recovery_window_expired_never_creates_guest(self):
  with self.assertRaises(ValueError):p.login({'created_at':0},self.directory/'x',lambda *a,**k:self.fail('요청 금지'))

 def test_parallel_run_rejected_without_network(self):
  directory=p.state_directory(self.env)
  with p.locked(directory):
   with self.assertRaises(ValueError):p.check(self.env,lambda *a,**k:self.fail('새 요청 금지'))
