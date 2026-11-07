import importlib.util
from pathlib import Path
import unittest
p=Path(__file__).resolve().parents[2]/'contracts/response_contract.py'
s=importlib.util.spec_from_file_location('contract',p);c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
class ContractTest(unittest.TestCase):
 def test_missing_wrong_and_nullable(self):
  for data in ({}, {'id':1,'name':None,'catColor':None,'mainIslandId':None}):
   with self.assertRaises(ValueError):c.check('GET','/me',{'data':data})
  self.assertTrue(c.check('GET','/me',{'data':{'id':'u','name':None,'catColor':None,'mainIslandId':None}}))
 def test_boolean_not_number(self):
  with self.assertRaises(ValueError):c.validate(True,'number')
 def test_unknown_required_rejected(self):
  with self.assertRaises(ValueError):c.check('GET','/unknown',{'data':{}},required=True)
 def test_nested_fields_and_path_normalization(self):
  with self.assertRaises(ValueError):c.check('POST','/focus-sessions/11111111-1111-4111-8111-111111111111/finish',{'data':{'recordId':'r','activeSeconds':1,'earnedFish':1,'allocation':{}}})
