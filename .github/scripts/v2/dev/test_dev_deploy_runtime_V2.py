import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('dev_deploy',Path(__file__).with_name('dev-deploy-runtime-V2.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def proc(code,stdout=b'',stderr=b''):
    return subprocess.CompletedProcess(['gcloud'],code,stdout,stderr)

def processes(*results):
    # OS 프로세스 경계만 대체한다. command()·ssh()·mask()는 실제 코드가 돈다.
    return mock.patch.object(m.subprocess,'run',side_effect=list(results))

class DeployTest(unittest.TestCase):
    def test_first_ssh_key_output_is_not_mixed_into_result(self):
        outputs=[b'Generating public/private rsa key pair.\n',b'redis:7.4.11-alpine\n',b'second\n']
        m.ssh_key_ready=False
        with mock.patch.object(m,'command',side_effect=outputs) as run:
            self.assertEqual(m.ssh('vm','probe'),b'redis:7.4.11-alpine\n')
            self.assertEqual(m.ssh('vm','next'),b'second\n')
        self.assertEqual([call.args[0][-1] for call in run.call_args_list],['true','probe','next'])
        # 러너마다 새 키. 만료 없으면 OS Login 프로필에 누적.
        self.assertTrue(all('--ssh-key-expire-after=1h' in call.args[0] for call in run.call_args_list))

    def test_redis_first_deployment_requires_both(self):
        self.assertEqual(m.redis_changes(None, {}), {'shared','business'})

    def test_redis_individual_and_shared_changes(self):
        shared='server/scripts/v2/dev/redis/shared.yml'
        business='server/scripts/v2/dev/redis/business.yml'
        common='server/scripts/v2/dev/common/apply.sh'
        before={shared:'a',business:'b',common:'c'}
        self.assertEqual(m.redis_changes(before,{**before,shared:'x'}), {'shared'})
        self.assertEqual(m.redis_changes(before,{**before,business:'x'}), {'business'})
        self.assertEqual(m.redis_changes(before,{**before,common:'x'}), {'shared','business'})
        self.assertEqual(m.redis_changes(before,{shared:'a',common:'c'}), {'business'})

    def test_wrong_manifest_uri_is_rejected(self):
        with self.assertRaises(ValueError): m.validate_manifest('kafka','gs://prod/manifest.json',{},b'')

    def test_wrong_archive_checksum_is_rejected(self):
        release='a'*40+'-1-1'; uri=m.BUCKET+'/releases/kafka/'+release+'/manifest.json'
        manifest={'release_id':release,'environment':'dev-v2','project':'oneorthree2','role':'kafka',
                  'revision':'a'*40,'archive_uri':uri.rsplit('/',1)[0]+'/runtime.tar','archive_sha256':'0'*64}
        with self.assertRaises(ValueError): m.validate_manifest('kafka',uri,manifest,b'not a tar')


class CommandFailureTest(unittest.TestCase):
    PREFIX='dev V2 명령 실패: gcloud (종료 255)'

    def setUp(self):
        m.secret_values.clear()
        self.addCleanup(m.secret_values.clear)
        m.ssh_key_ready=True

    def message(self,stderr,code=255,data=None,args=('gcloud',)):
        # stdout에도 표식을 둔다. 메시지가 통째로 일치해야 하므로 stdout·argv가 새면 모든 테스트가 깨진다.
        with processes(proc(code,b'STDOUT-ONLY-MARKER',stderr)),self.assertRaises(m.CommandError) as caught:
            m.command(list(args),data=data)
        return str(caught.exception)

    def test_message_keeps_program_exit_code_and_last_stderr_line_only(self):
        args=('gcloud','compute','ssh','--command','sudo run ARGV-ONLY-MARKER')
        self.assertEqual(self.message(b'first line\nERROR: boom \n \n\n',args=args),self.PREFIX+': ERROR: boom')

    def test_ssh_failure_keeps_the_cause_above_gcloud_recommendation(self):
        # surface/compute/ssh.py 가 ssh 실패 때 쓰는 순서 그대로다.
        stderr=(b'kex_exchange_identification: read: Connection reset by peer\n'
                b'Connection reset by 127.0.0.1 port 22\n'
                b'\nRecommendation: To check for possible causes of SSH connectivity issues and get\n'
                b'recommendations, rerun the ssh command with the --troubleshoot option.\n\n'
                b'gcloud compute ssh vm --project=p --zone=z --troubleshoot\n\n'
                b'ERROR: (gcloud.compute.ssh) [/usr/bin/ssh] exited with return code [255].\n')
        self.assertEqual(self.message(stderr),self.PREFIX+': Connection reset by 127.0.0.1 port 22')

    def test_error_is_a_runtime_error_carrying_the_exit_code(self):
        with processes(proc(7,stderr=b'x')),self.assertRaises(RuntimeError) as caught: m.command(['gcloud'])
        self.assertIsInstance(caught.exception,m.CommandError)
        self.assertEqual(caught.exception.returncode,7)

    def test_empty_stderr_leaves_only_program_and_exit_code(self):
        self.assertEqual(self.message(b''),self.PREFIX)
        self.assertEqual(self.message(b' \n\n'),self.PREFIX)

    def test_long_and_undecodable_stderr_is_cut(self):
        self.assertEqual(self.message(b'x'*1000+b'\xff'),self.PREFIX+': '+'x'*300)

    def test_values_of_every_secret_are_masked_but_short_values_are_not(self):
        env={'JWT_SECRET':'jwt-s3cret-value','FLAG':'on','PORT':8080}
        with processes(proc(0,json.dumps(env).encode()),proc(0,json.dumps({'project':'oneorthree2'}).encode())):
            m.aws_secret('catus/dev/env-v2'); m.aws_secret('catus/dev/cicd-v2')
        self.assertEqual(self.message(b'denied on jwt-s3cret-value in oneorthree2\n'),self.PREFIX+': denied on *** in ***')

    def test_generated_env_values_are_masked(self):
        m.remember_env_secrets({'data-api':"DB_URL='jdbc:postgresql://u:derived-pw@db/x'\nA=1\n"})
        self.assertEqual(self.message(b'bad url jdbc:postgresql://u:derived-pw@db/x with A=1'),self.PREFIX+': bad url *** with A=1')

    def test_stdin_lines_and_key_values_are_masked(self):
        data=b"user app on >pw-line-1 ~*\nPOSTGRES_PASSWORD='quoted-pw-2'\nTOKEN=tok-12345\nA=1\n"
        for stderr,expected in [(b'bad ACL: user app on >pw-line-1 ~*','bad ACL: ***'),
                                (b"env: POSTGRES_PASSWORD='quoted-pw-2'",'env: ***'),
                                (b'invalid token tok-12345 given','invalid token *** given'),
                                (b'unchanged A=1','unchanged A=1')]:
            with self.subTest(stderr=stderr): self.assertEqual(self.message(stderr,data=data),self.PREFIX+': '+expected)

    def test_remote_failure_does_not_echo_the_password_sent_on_stdin(self):
        with processes(proc(1,stderr=b'AUTH failed for hunter2-redis\n')),self.assertRaises(m.CommandError) as caught:
            m.ssh('vm','sudo verify.sh shared',b'hunter2-redis\n')
        self.assertEqual(str(caught.exception),'dev V2 명령 실패: gcloud (종료 1): AUTH failed for ***')


class SshRetryTest(unittest.TestCase):
    def setUp(self):
        m.ssh_key_ready=True
        sleep=mock.patch.object(m.time,'sleep'); self.sleep=sleep.start(); self.addCleanup(sleep.stop)
        stdout=mock.patch('sys.stdout',new_callable=io.StringIO); self.stdout=stdout.start(); self.addCleanup(stdout.stop)

    def test_connection_failure_is_retried_until_it_succeeds(self):
        with processes(proc(255,stderr=b'tunnel down'),proc(255),proc(0,b'ok')) as run:
            self.assertEqual(m.ssh('vm','probe'),b'ok')
        self.assertEqual(run.call_count,3)
        self.assertEqual(self.sleep.call_args_list,[mock.call(m.SSH_RETRY_SECONDS)]*2)
        self.assertIn('gcloud (종료 255): tunnel down',self.stdout.getvalue())
        self.assertIn('재시도 (1/3)',self.stdout.getvalue())

    def test_persistent_connection_failure_stops_after_three_attempts(self):
        with processes(*[proc(255,stderr=b'tunnel down')]*3) as run,self.assertRaises(m.CommandError) as caught:
            m.ssh('vm','probe')
        self.assertEqual(run.call_count,m.SSH_ATTEMPTS)
        self.assertEqual(caught.exception.returncode,255)
        self.assertIn('tunnel down',str(caught.exception))
        self.assertEqual(self.sleep.call_count,2)

    def test_remote_command_failure_is_not_retried(self):
        for code in (1,2,127):
            with self.subTest(code=code),processes(proc(code,stderr=b'remote failed'),proc(0)) as run:
                with self.assertRaises(m.CommandError) as caught: m.ssh('vm','probe')
                self.assertEqual((run.call_count,caught.exception.returncode),(1,code))
        self.sleep.assert_not_called()

    def test_key_warmup_is_retried_too(self):
        m.ssh_key_ready=False
        with processes(proc(255),proc(0,b'key noise'),proc(0,b'out')) as run:
            self.assertEqual(m.ssh('vm','probe'),b'out')
        self.assertEqual([call.args[0][-1] for call in run.call_args_list],['true','true','probe'])
        self.assertTrue(m.ssh_key_ready)

    def test_stdin_is_sent_again_on_retry(self):
        with processes(proc(255),proc(0,b'ok')) as run: m.ssh('vm','install',b'payload')
        self.assertEqual([call.kwargs['input'] for call in run.call_args_list],[b'payload',b'payload'])
