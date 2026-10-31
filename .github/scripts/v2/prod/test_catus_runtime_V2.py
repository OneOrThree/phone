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
    def test_SSM_파라미터는_승인한_DB_전환_배포에만_AllowMigration을_싣는다(self):
        envelope={'key':'releases/catus-v2.1.0-V2/bundle.zip','object_version':'v1','sha256':'a'*64}
        self.assertNotIn('AllowMigration',runtime.ssm_params(envelope,False,False))
        self.assertNotIn('AllowMigration',runtime.ssm_params(envelope,True,False))
        self.assertEqual(runtime.ssm_params(envelope,False,True)['AllowMigration'],['true'])

    def test_DB_전환_승인은_롤백이나_app_외_역할과_함께면_조회_전에_거부한다(self):
        for role,rollback,message in [('app',True,'rollback'),('redis',False,'app role')]:
            args=runtime.argparse.Namespace(role=role,version='catus-v2.1.0-V2',output='out',rollback=rollback,allow_migration=True)
            with patch.object(runtime,'config') as config,patch.object(runtime,'aws') as aws:
                with self.assertRaisesRegex(ValueError,message):runtime.deploy(args)
                config.assert_not_called();aws.assert_not_called()

    def test_최초_발행도_각_서비스_소스의_최근_PR을_연결한다(self):
        paths=[]
        def run(args,**kwargs):
            if args[:2]==['git','log']:
                paths.append(args[-1]);return {'server/data-api':'a','server/realtime':'b'}.get(args[-1],'c')+'\n'
            return json.dumps([{'number':{'a':10,'b':11,'c':12}[args[-1].split('/')[-2]],'merged_at':'now'}])
        plan={'role':'app','source_revision':'s','build_services':['data-api','realtime']}
        with patch.object(runtime,'run',side_effect=run):self.assertEqual(runtime.related_prs(plan,None),[10,11,12])
        self.assertIn('server/data-api',paths);self.assertIn('server/realtime',paths)

    def test_배지_브랜치_동시_갱신_충돌은_최신_기준으로_재시도한다(self):
        conflict=subprocess.CalledProcessError(1,['gh'],stderr='HTTP 422: Update is not a fast forward')
        with patch.object(runtime,'publish_badge_once',side_effect=[conflict,None]) as publish,patch.object(runtime.time,'sleep'):
            runtime.publish_badge({},'repo')
            self.assertEqual(publish.call_count,2)

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

    def test_백오피스는_main에서도_배포_관문을_통과하고_app은_release만_허용한다(self):
        from types import SimpleNamespace
        class Stop(Exception):pass
        with patch.object(runtime,'config',return_value={}),patch.object(runtime,'aws',side_effect=Stop),patch.dict(runtime.os.environ,{'GITHUB_REF':'refs/heads/main'}):
            with self.assertRaises(Stop):runtime.deploy(SimpleNamespace(role='backoffice',version='backoffice-v1.0.0-V2'))
            with self.assertRaisesRegex(ValueError,'^release branch required'):runtime.deploy(SimpleNamespace(role='app',version='catus-v1.0.0-V2'))

    def test_백오피스는_main_또는_release에_있으면_통과하고_app은_release만_본다(self):
        def run(args,**kwargs):
            if args[:2]==['git','merge-base'] and args[-1]=='origin/main':raise subprocess.CalledProcessError(1,args)
            return ''
        with patch.object(runtime,'run',side_effect=run) as calls:
            runtime.on_branch('abc','backoffice')
            runtime.on_branch('abc','app')
        fetched=[c.args[0][3] for c in calls.call_args_list if c.args[0][:2]==['git','fetch']]
        self.assertEqual(fetched,['main','release','release'])

    def test_백오피스_release_시절_태그는_순서_비교에서_빼고_main_태그는_지킨다(self):
        def git(on_main):
            def run(args,**kwargs):
                if args[:3]==['git','merge-base','--is-ancestor'] and (args[4]=='new' or not on_main):raise subprocess.CalledProcessError(1,args)
                return ''
            return run
        with patch.object(runtime,'run',side_effect=git(False)):runtime.after_latest('old','new','backoffice')
        with patch.object(runtime,'run',side_effect=git(True)):
            with self.assertRaises(subprocess.CalledProcessError):runtime.after_latest('old','new','backoffice')
        with patch.object(runtime,'run',side_effect=git(False)):
            with self.assertRaises(subprocess.CalledProcessError):runtime.after_latest('old','new','app')

    def test_SSM_응답_유실은_기존_명령으로_복구하고_중복_전송하지_않는다(self):
        with tempfile.TemporaryDirectory() as d:
            calls=[];lists=0
            command={'CommandId':'existing','Comment':'marker','Parameters':{'Key':['value']},'InstanceIds':['i-v2']}
            def aws(*args):
                nonlocal lists
                calls.append(args)
                if args[:2]==('ssm','list-commands'):
                    lists+=1;return {'Commands':[] if lists==1 else [command]}
                if args[:2]==('s3api','get-object'):raise subprocess.CalledProcessError(1,['aws'],stderr='NoSuchKey')
                if args[:2]==('ssm','send-command'):raise subprocess.TimeoutExpired(['aws'],60)
                raise AssertionError(args)
            with patch.object(runtime,'aws',side_effect=aws),patch.object(runtime,'immutable_put'):
                result=runtime.submit_ssm('i-v2','document',{'Key':['value']},'marker',str(Path(d)/'out'))
            self.assertEqual(result,'existing')
            self.assertEqual(sum(call[:2]==('ssm','send-command') for call in calls),1)

    def test_SSM_전송_의도가_있으면_명령이_불명확해도_재전송하지_않는다(self):
        with tempfile.TemporaryDirectory() as d:
            calls=[];intent={'instance_id':'i-v2','document':'document','parameters':{},'marker':'marker'}
            def aws(*args):
                calls.append(args)
                if args[:2]==('ssm','list-commands'):return {'Commands':[]}
                if args[:2]==('s3api','get-object'):
                    Path(args[-1]).write_text(json.dumps(intent));return {}
                raise AssertionError(args)
            with patch.object(runtime,'aws',side_effect=aws),patch.object(runtime.time,'monotonic',side_effect=[0,121]):
                with self.assertRaisesRegex(RuntimeError,'Unconfirmed'):runtime.submit_ssm('i-v2','document',{},'marker',str(Path(d)/'out'))
            self.assertFalse(any(call[:2]==('ssm','send-command') for call in calls))

    def _publish_bundle(self,role,root=None):
        """publish 를 가짜 외부 호출로 돌려 번들 zip 의 파일 이름→내용을 돌려준다."""
        import zipfile
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as d:
            captured={}
            def configuration(temp,revision):
                target=temp/'bundle';target.mkdir();(target/'infra-V2.txt').write_text('infra');return target
            def put(path,key):
                if key.startswith('releases/'):
                    with zipfile.ZipFile(path) as z:captured.update({n:z.read(n) for n in z.namelist()})
                return {'VersionId':'v'}
            plan={'role':role,'source_revision':'a'*40,'build_services':[]}
            args=SimpleNamespace(role=role,version=None,infra_revision='b'*40,prs=[1],output=str(Path(d)/'release.json'))
            patches=[patch.object(runtime,'config',return_value={}),patch.object(runtime,'previous',return_value=None),patch.object(runtime,'planner',return_value=plan),
                     patch.object(runtime,'run',return_value=''),patch.object(runtime,'aws',return_value={}),patch.object(runtime,'read_configuration',side_effect=configuration),
                     patch.object(runtime,'immutable_put',side_effect=put)]
            if root:patches.append(patch.object(runtime,'ROOT',root))
            for p in patches:p.start()
            try:runtime.publish(args)
            finally:
                for p in reversed(patches):p.stop()
            return captured

    def test_app_번들에는_관측_설정_8개가_정확한_이름과_내용으로_들어간다(self):
        bundle=self._publish_bundle('app')
        self.assertEqual(len(runtime.OBSERVABILITY_FILES),8)
        for name,source in runtime.OBSERVABILITY_FILES.items():
            self.assertEqual(Path(name).name,name)  # 평면 이름만 허용
            self.assertEqual(bundle[name],(runtime.ROOT/source).read_bytes())
        self.assertIn('infra-V2.txt',bundle)

    def test_kafka_번들에는_관측_설정이_들어가지_않는다(self):
        bundle=self._publish_bundle('kafka')
        self.assertFalse(set(runtime.OBSERVABILITY_FILES)&set(bundle))

    def test_관측_설정_원본이_없으면_조용히_건너뛰지_않고_실패한다(self):
        with tempfile.TemporaryDirectory() as empty:
            with self.assertRaises(FileNotFoundError):self._publish_bundle('app',Path(empty))

    def test_관측_설정_원본은_prod_CI_경로_필터와_일치한다(self):
        workflow=(runtime.ROOT/'.github/workflows/prod-ci-V2.yml').read_text(encoding='utf-8')
        for source in runtime.OBSERVABILITY_FILES.values():
            self.assertEqual(workflow.count(f'    - {source}\n'),2,source)  # pull_request·push 양쪽
        listed=[line for line in workflow.splitlines() if line.startswith('    - server/observability/')]
        self.assertEqual(len(listed),2*len(runtime.OBSERVABILITY_FILES))

if __name__=='__main__':unittest.main()
