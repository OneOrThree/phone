import importlib.util
import io
import json
from pathlib import Path
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('artifacts', Path(__file__).with_name('dev-app-artifacts-V2.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ArtifactTest(unittest.TestCase):
    def test_run_requires_exact_main_workflow_and_sha(self):
        run = {'event':'push','head_branch':'main','head_sha':'a'*40,'conclusion':'success',
               'status':'completed','path':'.github/workflows/data-api-ci.dev-v2.yml',
               'repository':{'full_name':m.REPO},'head_repository':{'full_name':m.REPO}}
        m.validate_run(run, 'a'*40, 'data-api-ci.dev-v2.yml')
        m.validate_run({**run, 'event':'workflow_dispatch'}, 'a'*40, 'data-api-ci.dev-v2.yml')
        for field, value in [('head_branch','release'),('head_sha','b'*40),('conclusion','failure'),('event','pull_request')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                m.validate_run({**run,field:value}, 'a'*40, 'data-api-ci.dev-v2.yml')

    def test_archive_rejects_wrong_service_and_extra_files(self):
        buf = io.BytesIO()
        service = 'realtime'
        image = f'asia-northeast3-docker.pkg.dev/oneorthree2/{service}/{service}@sha256:' + 'c'*64
        data = {'service':service,'revision':'a'*40,'image':image}
        with zipfile.ZipFile(buf,'w') as z: z.writestr(service+'-dev-v2-image.json',json.dumps(data))
        self.assertEqual(m.read_zip(buf.getvalue(),service,'a'*40),data)
        with self.assertRaises(ValueError): m.read_zip(buf.getvalue(), 'data-api', 'a'*40)
        with zipfile.ZipFile(buf,'a') as z: z.writestr('../other','x')
        with self.assertRaises(ValueError): m.read_zip(buf.getvalue(),service,'a'*40)


if __name__ == '__main__': unittest.main()
