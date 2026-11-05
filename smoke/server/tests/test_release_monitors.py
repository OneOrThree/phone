import importlib.util
from pathlib import Path
import unittest
p=Path(__file__).resolve().parents[3]/'server/observability/datadog/release-monitoring/manage.py'
s=importlib.util.spec_from_file_location('monitors',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class MonitorTest(unittest.TestCase):
 def test_global_fallback_and_grouping(self):
  monitors=m.definitions('@release@example.com');self.assertEqual(len(monitors),4)
  self.assertEqual(sum('.by(' in v['query'] for v in monitors),2)
  for v in monitors:self.assertIn('env:prod',v['query']);self.assertIn('@status_code:',v['query'])
 def test_missing_recipient_rejected(self):
  with self.assertRaises(ValueError):m.definitions('')
 def test_validate_then_update_without_duplicate_creation(self):
  desired=m.definitions('@release@example.com');calls=[]
  def api(method,path,body=None):
   calls.append((method,path))
   return [{'id':i,'name':v['name'],'tags':v['tags']} for i,v in enumerate(desired)] if method=='GET' else {}
  m.apply(desired,api)
  self.assertEqual(sum(method=='PUT' for method,path in calls),4)
  self.assertEqual(sum(path=='monitor/validate' for method,path in calls),4)
