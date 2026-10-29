"""V2 발행·배포에서 기존 운영 대상과 불명확한 상태를 거부한다."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

PATH=Path(__file__).with_name('catus-runtime-V2.py')
spec=importlib.util.spec_from_file_location('runtime_V2',PATH)
runtime=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)


class RuntimeTest(unittest.TestCase):
    def test_단위별_V2_태그만_허용한다(self):
        self.assertEqual(runtime.version('catus-v2.0.1-V2','app'),(2,0,1))
        for value in ['catus-v2.0.1','redis-v2.0.1-V2','catus-v02.0.1-V2','catus-v2.0.1-V2-other']:
            with self.assertRaises(ValueError):runtime.version(value,'app')

    def test_기존_스택_배포_설정은_거부한다(self):
        for config in [{'STACK':'V1','DEPLOY_BUCKET':runtime.BUCKET},{'STACK':'V2','DEPLOY_BUCKET':'legacy'}]:
            with patch.object(runtime,'aws',return_value={'SecretString':json.dumps(config)}):
                with self.assertRaises(ValueError):runtime.config()

    def test_운영_상태_조회_권한_오류는_최초_배포가_아니다(self):
        for error,expected in [('AccessDenied',False),('NoSuchKey',True)]:
            e=subprocess.CalledProcessError(1,['aws'],stderr=error)
            with patch.object(runtime,'aws',side_effect=e):
                if expected:self.assertIsNone(runtime.previous('app'))
                else:
                    with self.assertRaises(subprocess.CalledProcessError):runtime.previous('app')

    def test_기존_불변_객체의_다른_내용은_거부한다(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'new';path.write_text('new')
            def aws(*args):
                if args[1]=='put-object':raise subprocess.CalledProcessError(1,['aws'],stderr='PreconditionFailed')
                Path(args[-1]).write_text('old');return {'VersionId':'old'}
            with patch.object(runtime,'aws',side_effect=aws):
                with self.assertRaisesRegex(ValueError,'Immutable'):runtime.immutable_put(path,'releases/check/bundle.zip')

    def test_승격_없는_발행은_이미지_빌드_전에_거부한다(self):
        from types import SimpleNamespace
        plan={'source_revision':'a'*40,'build_services':['data-api']}
        def run(args,**kwargs):
            if args[:3]==['git','merge-base','--is-ancestor']:raise subprocess.CalledProcessError(1,args)
            return ''
        with patch.object(runtime,'config',return_value={}),patch.object(runtime,'previous',return_value=None),patch.object(runtime,'planner',return_value=plan),patch.object(runtime,'run',side_effect=run) as calls:
            with self.assertRaises(subprocess.CalledProcessError):runtime.publish(SimpleNamespace(role='app'))
            self.assertFalse(any(c.args[0][0]=='docker' for c in calls.call_args_list))

    def test_main에서는_prod_CD를_거부한다(self):
        from types import SimpleNamespace
        with patch.object(runtime,'config',return_value={}),patch.dict(runtime.os.environ,{'GITHUB_REF':'refs/heads/main'}):
            with self.assertRaisesRegex(ValueError,'release'):runtime.deploy(SimpleNamespace(role='redis',version='redis-v1.0.0-V2'))

if __name__=='__main__':unittest.main()
