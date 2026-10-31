import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('dev-publish-runtime-V2.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class PublishTest(unittest.TestCase):
    def test_only_main_can_publish(self):
        with mock.patch.dict(m.os.environ, {'GITHUB_REF':'refs/heads/feature'}, clear=True):
            with self.assertRaises(ValueError): m.publish('kafka')

    def test_uploads_archive_then_manifest_with_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            name = 'server/scripts/v2/dev/kafka/compose.yml'
            file = root/name; file.parent.mkdir(parents=True); file.write_text('services: {}\n')
            calls=[]
            def fake_run(args, **kwargs):
                calls.append(args)
                self.assertIn('--if-generation-match=0', args)
                if args[-1].endswith('/manifest.json'):
                    data=json.loads(Path(args[-2]).read_text())
                    self.assertEqual(data['environment'], 'dev-v2')
                    self.assertEqual(data['role'], 'kafka')
                    self.assertIn(name, data['files'])
                return SimpleNamespace(returncode=0)
            variables={'GITHUB_REF':'refs/heads/main','GITHUB_SHA':'a'*40,'GITHUB_RUN_ID':'12','GITHUB_RUN_ATTEMPT':'1'}
            with mock.patch.object(m,'ROOT',root), mock.patch.dict(m.os.environ,variables,clear=True), \
                 mock.patch.object(m.subprocess,'check_output',return_value=(name+'\0').encode()), \
                 mock.patch.object(m.subprocess,'run',side_effect=fake_run), contextlib.redirect_stdout(io.StringIO()):
                m.publish('kafka')
            self.assertTrue(calls[0][-1].endswith('/runtime.tar'))
            self.assertTrue(calls[1][-1].endswith('/manifest.json'))
