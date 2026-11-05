import copy
import importlib.util
from pathlib import Path
import unittest
p=Path(__file__).resolve().parents[2]/'contracts/release_check.py'
s=importlib.util.spec_from_file_location('release',p);r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
class ReleaseTest(unittest.TestCase):
 def setUp(self):
  self.run={'head_sha':'a'*40,'head_branch':'main','status':'completed','conclusion':'success','path':'.github/workflows/ops-smoke.dev-v2.yml'}
  self.e={'environment':'dev','appTree':'tree','appRevision':'a'*40,'services':{n:{'revision':'b'*40} for n in r.SERVICES}}
  self.p={'status':'Success','service_revisions':{n:'b'*40 for n in r.SERVICES}}
 def test_compatible_passes(self):r.verify(self.e,self.p,'tree',self.run)
 def test_old_app_server_and_untrusted_run_fail(self):
  for category in ['app','server','failed','pr','missing']:
   e,p,run=copy.deepcopy(self.e),copy.deepcopy(self.p),dict(self.run)
   if category=='app':e['appTree']='old'
   elif category=='server':p['service_revisions']['data-api']='c'*40
   elif category=='failed':run['conclusion']='failure'
   elif category=='pr':run['head_branch']='feature'
   else:p['service_revisions'].pop('notification')
   with self.assertRaises(ValueError):r.verify(e,p,'tree',run)
 def test_no_run_id_never_queries(self):
  with self.assertRaises(ValueError):r.check({},lambda args:self.fail('조회되면 안 됨'))
