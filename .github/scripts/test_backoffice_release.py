import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backoffice_release', Path(__file__).with_name('backoffice-release.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.manifest = dict(schemaVersion=1, tag='backoffice-v1.2.3', commit='a'*40,
                             digest='sha256:'+'b'*64, repository=r.REPOSITORY,
                             document=r.DOCUMENT, instance=r.INSTANCE,
                             documentVersion='2', requiredContracts=r.CONTRACT)

    def test_manifest_rejects_tampered_targets_and_mutable_document(self):
        for key, value in [('tag', '../evil'), ('commit', 'main'), ('digest', 'latest'),
                           ('repository', 'evil'), ('document', 'AWS-RunShellScript'),
                           ('instance', 'other'), ('documentVersion', '$LATEST')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                r.validate_manifest({**self.manifest, key:value}, self.manifest['tag'])
        self.assertEqual(r.validate_manifest(self.manifest, self.manifest['tag']), self.manifest)

    def test_untrusted_workflow_ref_fails_before_aws(self):
        with patch.dict(os.environ, {'GITHUB_REF':'refs/heads/evil'}), patch.object(r, 'aws') as aws:
            for action in ('create','deploy'):
                with patch('sys.argv',['release',action,'--tag','backoffice-v1.2.3']), self.assertRaises(ValueError):
                    r.main()
            aws.assert_not_called()

    def test_send_disables_aws_cli_implicit_retries(self):
        with patch.object(r.subprocess, 'run') as run:
            run.return_value.stdout = '{}'
            r.aws('ssm', 'send-command')
            self.assertEqual(run.call_args.kwargs['env']['AWS_MAX_ATTEMPTS'], '1')

    def test_ecr_digest_mismatch(self):
        with self.assertRaises(ValueError):
            r.verify_image(self.manifest, lambda *args: {'imageDetails':[{'imageDigest':'sha256:'+'c'*64}]})

    def command(self, **kwargs):
        return dict(CommandId='command-1', Comment='backoffice:123', DocumentName=r.DOCUMENT,
                    DocumentVersion='2', InstanceIds=[r.INSTANCE],
                    Parameters={'ImageDigest':['b'*64]}, **kwargs)

    def test_send_pinned_target_and_success(self):
        calls=[]
        statuses=iter(['Pending','InProgress','Success'])
        def call(*args):
            calls.append(args)
            if args[1]=='send-command': return {'Command':{'CommandId':'command-1'}}
            return {'Commands':[] if len(args)==2 else [{'Status':next(statuses)}]}
        self.assertEqual(r.execute(self.manifest,'backoffice:123',1,call,lambda _:None), 'command-1')
        sent=next(c for c in calls if c[1]=='send-command')
        self.assertIn(r.INSTANCE,sent)
        self.assertIn(r.DOCUMENT,sent)
        self.assertEqual(sent[sent.index('--document-version')+1],'2')
        self.assertEqual(json.loads(sent[sent.index('--parameters')+1]),{'ImageDigest':['b'*64]})

    def test_retry_resumes_matching_command_without_resend(self):
        calls=[]
        def call(*args):
            calls.append(args)
            return {'Commands':[self.command()] if len(args)==2 else [{'Status':'Success'}]}
        r.execute(self.manifest,'backoffice:123',2,call,lambda _:None)
        self.assertFalse(any(c[1]=='send-command' for c in calls))

    def test_uncertain_send_is_not_automatically_repeated(self):
        with self.assertRaisesRegex(ValueError,'자동 재전송'):
            r.execute(self.manifest,'backoffice:123',2,lambda *args:{'Commands':[]})

    def test_retry_rejects_different_document_version(self):
        command=self.command()
        command['DocumentVersion']='3'
        with self.assertRaisesRegex(ValueError,'재시도 명령'):
            r.execute(self.manifest,'backoffice:123',2,lambda *args:{'Commands':[command]})

    def test_ssm_failure_is_not_success(self):
        for status in ('Failed','Cancelled','TimedOut','Cancelling'):
            def call(*args):
                return {'Commands':[self.command()] if len(args)==2 else [{'Status':status}]}
            with self.subTest(status=status), self.assertRaisesRegex(ValueError,'SSM 배포 실패'):
                r.execute(self.manifest,'backoffice:123',2,call,lambda _:None)

    def test_poll_timeout_never_sends_new_command(self):
        now=iter([0,1,100])
        with self.assertRaises(TimeoutError):
            r.execute(self.manifest,'backoffice:123',2,
                      lambda *args:{'Commands':[self.command()] if len(args)==2 else [{'Status':'InProgress'}]},
                      lambda _:None,lambda:next(now),timeout=10)


if __name__ == '__main__':
    unittest.main()
