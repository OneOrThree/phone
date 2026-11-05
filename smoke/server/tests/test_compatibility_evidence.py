import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

PATH=Path(__file__).resolve().parents[2]/'contracts/evidence.py'
spec=importlib.util.spec_from_file_location('evidence',PATH)
evidence=importlib.util.module_from_spec(spec);spec.loader.exec_module(evidence)


class EvidenceTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.directory=Path(self.tmp.name)
        self.targets={'state':'matched','services':{name:{'revision':'b'*40,'image_id':'sha256:'+'c'*64}
                      for name in evidence.SERVICES}}
        self.inventory={'sourceDigest':'d'*64,'endpoints':[{'server':['Controller.java']}],
                        'unresolved':[],'unsupportedServer':[]}
        self.write()

    def write(self,missing=False,failed=False):
        (self.directory/'targets.json').write_text(json.dumps(self.targets))
        rows=[case+'\tPASS' for case in sorted(evidence.EXPECTED) if not missing or not case.endswith('020')]
        if failed:rows.append('SMOKE-SERVER-020\tFAIL')
        (self.directory/'results.tsv').write_text('id\tstatus\n'+'\n'.join(rows)+'\n')

    def test_exact_sources_and_results_recorded_as_dev_only(self):
        result=evidence.build(self.directory,self.inventory,'a'*40)
        self.assertEqual(result['environment'],'dev')
        self.assertEqual(result['appRevision'],'a'*40)
        self.assertEqual(result['services'],self.targets['services'])
        self.assertEqual(len(result['passedCases']),17)
        self.assertEqual(len(result['results'][0]['sha256']),64)

    def test_missing_focus_journey_and_any_failure_reject(self):
        for missing,failed in [(True,False),(False,True)]:
            self.write(missing,failed)
            with self.assertRaises(ValueError):evidence.build(self.directory,self.inventory,'a'*40)

    def test_superseded_or_unknown_server_reject(self):
        self.targets['state']='superseded';self.write()
        with self.assertRaises(ValueError):evidence.build(self.directory,self.inventory,'a'*40)
        self.targets['state']='matched';self.targets['services']['data-api']['revision']='';self.write()
        with self.assertRaises(ValueError):evidence.build(self.directory,self.inventory,'a'*40)

    def test_unmatched_app_api_reject(self):
        self.inventory['endpoints'][0]['server']=[]
        with self.assertRaises(ValueError):evidence.build(self.directory,self.inventory,'a'*40)
