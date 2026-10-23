"""버전 증가·버전 지정 롤백·실제 배포 결과와 배지의 연결을 검증한다."""
import ast
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
import yaml

ROOT = Path(__file__).parents[2]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


version = module('version', 'catus-version.py')
badge = module('badge', 'deployment-badges.py')


def workflow(filename):
    return yaml.load((ROOT / '.github/workflows' / filename).read_text(), Loader=yaml.BaseLoader)


def record(service='data-api', result='success', stamp='2026-01-01T00:00:00+00:00'):
    return {'environment': 'dev', 'service': service, 'result': result,
            'revision': 'a' * 40, 'finished_at': stamp}


class VersionBadgeTests(unittest.TestCase):
    def test_초기2_버전과_PR라벨_증가_기존Gromo태그는_제외(self):
        self.assertEqual(version.next_version(['v9.0.0', 'focuscat-v99.0.0'], []), 'catus-v2.0.0')
        tags = ['catus-v2.9.0', 'catus-v2.10.0', 'v99.0.0']
        for label, expected in [('release:major', 'catus-v3.0.0'), ('release:minor', 'catus-v2.11.0'),
                                ('release:patch', 'catus-v2.10.1')]:
            self.assertEqual(version.next_version(tags, [label, 'workflow']), expected)
        self.assertEqual(version.next_version(tags, []), 'catus-v2.10.1')
        with self.assertRaises(ValueError):
            version.next_version(tags, ['release:major', 'release:minor'])

    def test_정식태그가_없어도_운영버전_다음부터_발행한다(self):
        previous = {'product': 'catus', 'version': 'catus-v2.0.0'}
        for label, expected in [('release:patch', 'catus-v2.0.1'),
                                ('release:minor', 'catus-v2.1.0'), ('release:major', 'catus-v3.0.0')]:
            self.assertEqual(version.next_version([], [label], previous), expected)
        self.assertEqual(version.next_version(['catus-v2.1.0'], [], previous), 'catus-v2.1.1')
        with self.assertRaises(ValueError):
            version.next_version([], [], {'product': 'gromo', 'version': 'v2.0.0'})

    def test_S3_부분발행_예약도_숫자순으로_계산하고_다른제품은_제외한다(self):
        envelope = {'version': 'catus-v2.10.0', 'source_revision': 'a' * 40, 'release_id': 'a' * 40 + '-2-1'}
        keys = ['versions/catus-v2.9.0.json', 'versions/catus-v2.10.0.json', 'versions/focuscat-v99.0.0.json']
        def download(args, **kwargs):
            self.assertIn('versions/catus-v2.10.0.json', args)
            Path(args[-1]).write_text(json.dumps(envelope))
        with patch.object(version.subprocess, 'check_output', return_value=json.dumps(keys)), \
             patch.object(version.subprocess, 'run', side_effect=download):
            reserved = version.reserved_versions('catus-prod-deploy-artifacts-test')
        self.assertEqual(reserved, [envelope])
        self.assertEqual(version.next_version([r['version'] for r in reserved], []), 'catus-v2.10.1')
        with patch.object(version.subprocess, 'check_output', side_effect=subprocess.CalledProcessError(1, 'aws')), self.assertRaises(subprocess.CalledProcessError):
            version.reserved_versions('catus-prod-deploy-artifacts-test')

    def test_버전CLI는_Git태그가_없는_S3예약의_다음버전을_고른다(self):
        reserved = {'version': 'catus-v2.0.1', 'source_revision': 'a' * 40, 'release_id': 'a' * 40 + '-2-1'}
        with tempfile.TemporaryDirectory() as directory:
            plan = Path(directory, 'plan.json')
            plan.write_text(json.dumps({'previous': {'product': 'catus', 'version': 'catus-v2.0.0'}}))
            with patch.object(sys, 'argv', ['version', '--revision', 'a' * 40, '--plan-file', str(plan),
                                          '--bucket', 'catus-prod-deploy-artifacts-test']), \
                 patch.dict(os.environ, {'GITHUB_REPOSITORY': 'OneOrThree/phone'}), \
                 patch.object(version.subprocess, 'check_output', return_value=''), \
                 patch.object(version, 'release_labels', return_value=[]), \
                 patch.object(version, 'reserved_versions', return_value=[reserved]), \
                 patch('sys.stdout', new_callable=io.StringIO) as output:
                version.main()
            self.assertEqual(output.getvalue().strip(), 'catus-v2.0.2')

    def test_버전CLI는_계획의_실제운영_기준을_읽는다(self):
        with tempfile.TemporaryDirectory() as directory:
            plan = Path(directory, 'prod-plan.json')
            plan.write_text(json.dumps({'previous': {'product': 'catus', 'version': 'catus-v2.0.0'}}))
            with patch.object(sys, 'argv', ['version', '--revision', 'a' * 40, '--plan-file', str(plan), '--bucket', 'catus-prod-deploy-artifacts-test']), \
                 patch.dict(os.environ, {'GITHUB_REPOSITORY': 'OneOrThree/phone'}), \
                 patch.object(version.subprocess, 'check_output', return_value=''), \
                 patch.object(version, 'release_labels', return_value=[]), \
                 patch.object(version, 'reserved_versions', return_value=[]), \
                 patch('sys.stdout', new_callable=io.StringIO) as output:
                version.main()
            self.assertEqual(output.getvalue().strip(), 'catus-v2.0.1')

    def test_새발행은_같은SHA여도_요청한_버전을_증가시킨다(self):
        for label, expected in [('release:major', 'catus-v3.0.0'), ('release:minor', 'catus-v2.2.0'),
                                ('release:patch', 'catus-v2.1.1')]:
            self.assertEqual(version.next_version(['catus-v2.1.0'], [label],
                {'product': 'catus', 'version': 'catus-v2.0.0'}), expected)

    def test_예약전에_실패한_릴리스의_증가의도를_후속커밋이_이월한다(self):
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=directory, text=True).strip()
            git('init', '-q')
            revisions = []
            for message in ['기준', '실패한 릴리스', '후속 릴리스']:
                git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', message)
                revisions.append(git('rev-parse', 'HEAD'))
            base, failed, current = revisions
            original = subprocess.check_output
            for bump, expected in [('release:major', 'catus-v3.0.0'), ('release:minor', 'catus-v2.1.0')]:
                seen = []
                def output(args, **kwargs):
                    if args[0] != 'gh': return original(args, cwd=directory, **kwargs)
                    sha = args[-1].split('/')[-2]
                    seen.append(sha)
                    return json.dumps([[{'merged_at': '2026-01-01', 'base': {'ref': 'release'},
                        'head': {'ref': 'main', 'sha': sha},
                        'merge_commit_sha': sha, 'labels': [{'name': bump if sha == failed else 'release:patch'}]}]])
                with patch.dict(os.environ, {'GITHUB_REPOSITORY': 'OneOrThree/phone'}), \
                     patch.object(version.subprocess, 'check_output', side_effect=output):
                    labels = version.release_labels(current, base)
                    self.assertEqual(version.next_version(['catus-v2.0.0'], labels), expected)
                    self.assertEqual(set(seen), {failed, current})
                    self.assertEqual(version.release_labels(current, failed), ['release:patch'])

    def test_최초_main승격은_과거Gromo라벨을_제외하고_Catus라벨만_반영한다(self):
        with tempfile.TemporaryDirectory() as directory:
            def git(*args, input=None):
                return subprocess.check_output(['git', *args], cwd=directory, input=input,
                                               text=True, stderr=subprocess.PIPE).strip()
            git('init', '-q')
            git('config', 'user.name', 'Test')
            git('config', 'user.email', 'test@example.com')
            git('checkout', '-qb', 'main')
            git('commit', '--allow-empty', '-qm', '공통 기준')
            git('checkout', '-qb', 'release')
            git('commit', '--allow-empty', '-qm', '과거 Gromo minor 승격')
            legacy = git('rev-parse', 'HEAD')
            legacy_source = git('rev-parse', legacy + '^')
            git('checkout', 'main')
            git('commit', '--allow-empty', '-qm', 'Catus 준비 기준')
            boundary = git('rev-parse', 'HEAD')
            # 수동 전환의 PR 검증 SHA는 squash 후 main의 조상이 아닐 수 있다.
            feature = git('commit-tree', 'HEAD^{tree}', '-p', boundary, input='검증 소스\n')
            manual = git('commit-tree', 'HEAD^{tree}', '-p', boundary, '-p', feature, input='PR 검증 병합\n')
            git('commit', '--allow-empty', '-qm', 'main Catus 소스 통합')
            git('merge', '-s', 'ours', 'release', '-m', 'main에 release 이력 연결')
            source = git('rev-parse', 'HEAD')
            git('checkout', 'release')
            git('merge', '--no-ff', 'main', '-m', 'main에서 Catus release 승격')
            current = git('rev-parse', 'HEAD')
            original = subprocess.check_output
            for base in [boundary, manual]:
                for bump, expected in [('release:patch', 'catus-v2.0.1'),
                                       ('release:minor', 'catus-v2.1.0'), ('release:major', 'catus-v3.0.0')]:
                    seen = []
                    def output(args, **kwargs):
                        if args[0] != 'gh':
                            return original(args, cwd=directory, **kwargs)
                        sha = args[-1].split('/')[-2]
                        seen.append(sha)
                        return json.dumps([[{'merged_at': '2026-01-01', 'base': {'ref': 'release'},
                            'head': {'ref': 'main', 'sha': source},
                            'merge_commit_sha': sha,
                            'labels': [{'name': 'release:minor' if sha == legacy else bump}]}]])
                    with self.subTest(base=base, bump=bump), \
                         patch.dict(os.environ, {'GITHUB_REPOSITORY': 'OneOrThree/phone'}), \
                         patch.object(version.subprocess, 'check_output', side_effect=output):
                        labels = version.release_labels(current, base)
                        self.assertEqual(version.next_version(['catus-v2.0.0'], labels), expected)
                        self.assertNotIn(legacy, seen)
                        self.assertIn(current, seen)
            git('checkout', '-qb', 'squashed-release', legacy)
            git('merge', '--squash', 'main')
            git('commit', '--allow-empty', '-qm', '잘못된 squash 승격')
            squashed = git('rev-parse', 'HEAD')
            def squashed_output(args, **kwargs):
                if args[0] != 'gh':
                    return original(args, cwd=directory, **kwargs)
                sha = args[-1].split('/')[-2]
                return json.dumps([[{'merged_at': '2026-01-01', 'base': {'ref': 'release'},
                    'head': {'ref': 'main', 'sha': legacy_source if sha == legacy else source},
                    'merge_commit_sha': sha,
                    'labels': [{'name': 'release:minor' if sha == legacy else 'release:patch'}]}]])
            for base in [boundary, manual]:
                with self.subTest(squashed=True, base=base), \
                     patch.dict(os.environ, {'GITHUB_REPOSITORY': 'OneOrThree/phone'}), \
                     patch.object(version.subprocess, 'check_output', side_effect=squashed_output), \
                     self.assertRaisesRegex(ValueError, 'main.*merge commit'):
                    version.release_labels(squashed, base)
            def wrong_branch_output(args, **kwargs):
                if args[0] != 'gh':
                    return original(args, cwd=directory, **kwargs)
                return json.dumps([[{'merged_at': '2026-01-01', 'base': {'ref': 'release'},
                    'head': {'ref': 'chore/work', 'sha': source}, 'merge_commit_sha': current,
                    'labels': [{'name': 'release:patch'}]}]])
            with patch.dict(os.environ, {'GITHUB_REPOSITORY': 'OneOrThree/phone'}), \
                 patch.object(version.subprocess, 'check_output', side_effect=wrong_branch_output), \
                 self.assertRaisesRegex(ValueError, '소스 브랜치는 main'):
                version.release_labels(current, boundary)

    def test_고정버전은_최신버전보다_커야하며_동일실행_예약만_복구한다(self):
        previous = {'version': 'catus-v2.0.0'}
        reserved = {'version': 'catus-v2.1.0', 'source_revision': 'a' * 40,
                    'infra_revision': 'b' * 40, 'release_id': 'a' * 40 + '-10-1'}
        for fixed in ['catus-v2.0.1', 'catus-v2.1.0']:
            with self.assertRaises(ValueError):
                version.validate_fixed(fixed, ['catus-v2.1.0'], [], previous, 'a' * 40, 'b' * 40, '10')
        version.validate_fixed('catus-v2.2.0', ['catus-v2.1.0'], [reserved], previous, 'a' * 40, 'b' * 40, '11')
        version.validate_fixed('catus-v2.1.0', ['catus-v2.1.0'], [reserved], previous, 'a' * 40, 'b' * 40, '10')
        with self.assertRaises(ValueError):
            version.validate_fixed('catus-v2.1.0', [], [reserved], previous, 'a' * 40, 'b' * 40, '11')
        with self.assertRaises(ValueError):
            version.validate_fixed('catus-v2.1.0', [], [reserved], previous, 'a' * 40, 'c' * 40, '10')

    def test_기존annotated태그는_재게시하고_새발행CLI는_버전을_증가시킨다(self):
        script = next(step['run'] for step in workflow('prod-ci.yml')['jobs']['release']['steps']
                      if step.get('name') == '불변 릴리스 생성·업로드')
        script = script[script.index("git config user.name"):script.index('echo "- 버전:')]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, text=True, stderr=subprocess.PIPE).strip()
            git('init', '-q')
            git('init', '--bare', '-q', 'remote.git')
            git('remote', 'add', 'origin', str(root / 'remote.git'))
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', '기준')
            revision = git('rev-parse', 'HEAD')
            plan = root / 'prod-plan.json'
            plan.write_text(json.dumps({'previous': None}))
            env = {**os.environ, 'GITHUB_SHA': revision}
            for _ in range(2):
                result = subprocess.run(
                    ['bash', '-euc', 'version=catus-v2.0.0\nrelease_id=test\nINFRA_REVISION=test\n' + script],
                    cwd=root, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            original = version.subprocess.check_output
            def output(args, **kwargs):
                if args[0] == 'gh': return '[]'
                return original(args, cwd=root, **kwargs)
            with patch.object(sys, 'argv', ['version', '--revision', revision, '--plan-file', str(plan), '--bucket', 'catus-prod-deploy-artifacts-test']), \
                 patch.dict(os.environ, {'GITHUB_REPOSITORY': 'OneOrThree/phone'}), \
                 patch.object(version.subprocess, 'check_output', side_effect=output), \
                 patch.object(version, 'reserved_versions', return_value=[]), \
                 patch('sys.stdout', new_callable=io.StringIO) as stdout:
                version.main()
            self.assertEqual(stdout.getvalue().strip(), 'catus-v2.0.1')
            self.assertEqual(git('tag', '-l'), 'catus-v2.0.0')
            self.assertIn('refs/tags/catus-v2.0.0', git('ls-remote', '--tags', 'origin'))

    def test_실행별_버전고정으로_복구와_같은SHA_명시적재발행을_구분한다(self):
        steps = workflow('prod-ci.yml')['jobs']['release']['steps']
        allocate = next(step for step in steps if step.get('name') == '발행 버전 고정')
        upload = next(step for step in steps if step.get('uses') == 'actions/upload-artifact@v4')
        download = next(step for step in steps if step.get('with', {}).get('name') == 'catus-release-version'
                        and step.get('uses') == 'actions/download-artifact@v4')
        self.assertEqual(allocate['if'], "steps.version-record.outputs.exists != 'true'")
        self.assertEqual(upload['if'], "steps.version-record.outputs.exists != 'true'")
        self.assertEqual(download['if'], "steps.version-record.outputs.exists == 'true'")
        generate = next(step['run'] for step in steps if step.get('name') == '불변 릴리스 생성·업로드')
        validate = generate.split('mkdir -p infra-config', 1)[0] + '\nprintf "%s" "$version"\n'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
            git('init', '-q')
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', '기준')
            revision = git('rev-parse', 'HEAD')
            helper = root / '.github/scripts/catus-version.py'
            helper.parent.mkdir(parents=True)
            shutil.copyfile(version.__file__, helper)
            (root / 'plan-input').mkdir()
            (root / 'plan-input/prod-plan.json').write_text(json.dumps({'previous': None}))
            (root / 'bin').mkdir()
            gh = root / 'bin/gh'
            gh.write_text("#!/bin/sh\nprintf '[]\\n'\n")
            gh.chmod(0o755)
            aws_cli = root / 'bin/aws'
            aws_cli.write_text('#!' + sys.executable + '\n' + """import json, sys
from pathlib import Path
args = sys.argv[1:]
if args[0] == 'secretsmanager':
    print(json.dumps({'DEPLOY_BUCKET': 'catus-prod-deploy-artifacts-test'}))
elif 'list-objects-v2' in args:
    print(json.dumps(['versions/catus-v2.0.0.json'] if Path('reserved.json').exists() else []))
else:
    Path(args[-1]).write_text(Path('reserved.json').read_text())
""")
            aws_cli.chmod(0o755)
            env = {**os.environ, 'PATH': str(root / 'bin') + os.pathsep + os.environ['PATH'],
                'GITHUB_SHA': revision, 'GITHUB_REPOSITORY': 'OneOrThree/phone', 'GITHUB_RUN_ID': '1',
                'GITHUB_RUN_ATTEMPT': '2', 'INFRA_REVISION': 'a' * 40, 'BUMP_OVERRIDE': ''}
            def run(script, overrides=None):
                return subprocess.run(['bash', '-euc', script], cwd=root, env={**env, **(overrides or {})},
                    capture_output=True, text=True)
            result = run(allocate['run'])
            self.assertEqual(result.returncode, 0, result.stderr)
            git('tag', 'catus-v2.0.0')
            (root / 'reserved.json').write_text(json.dumps({'version': 'catus-v2.0.0', 'source_revision': revision,
                'infra_revision': 'a' * 40, 'release_id': revision + '-1-1'}))
            retry = run(validate, {'GITHUB_RUN_ATTEMPT': '2'})
            self.assertEqual(retry.returncode, 0, retry.stderr)
            self.assertEqual(retry.stdout, 'catus-v2.0.0')
            self.assertNotEqual(run(validate, {'INFRA_REVISION': 'b' * 40}).returncode, 0)
            self.assertNotEqual(run(validate, {'GITHUB_RUN_ID': '2'}).returncode, 0)
            for i, (bump, expected) in enumerate([('patch', 'catus-v2.0.1'), ('minor', 'catus-v2.1.0')]):
                shutil.rmtree(root / 'release-version')
                result = run(allocate['run'], {'GITHUB_RUN_ID': str(i + 2), 'INFRA_REVISION': 'b' * 40,
                                             'BUMP_OVERRIDE': bump})
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads((root / 'release-version/version.json').read_text())['version'], expected)

    def test_운영실행은_대기중인_발행과_배포를_취소하지_않는다(self):
        for filename in ['prod-ci.yml', 'prod-cd.yml']:
            concurrency = workflow(filename)['concurrency']
            self.assertEqual(concurrency['cancel-in-progress'], 'false')
            self.assertEqual(concurrency['queue'], 'max')

    def test_후속커밋_발행후_이전커밋과_분기커밋은_발행하지_않는다(self):
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=directory, text=True).strip()
            git('init', '-q')
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', '이전')
            older = git('rev-parse', 'HEAD')
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', '후속')
            newer = git('rev-parse', 'HEAD')
            git('tag', 'catus-v2.1.0')
            original = subprocess.check_output
            def output(args, **kwargs): return original(args, cwd=directory, **kwargs)
            with patch.object(version.subprocess, 'check_output', side_effect=output):
                version.validate_order(['catus-v2.1.0'], newer)
                with self.assertRaisesRegex(ValueError, '오래되거나 분기된'):
                    version.validate_order(['catus-v2.1.0'], older)
            git('checkout', '-q', '--detach', older)
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', '분기')
            diverged = git('rev-parse', 'HEAD')
            with patch.object(version.subprocess, 'check_output', side_effect=output), self.assertRaises(ValueError):
                version.validate_order(['catus-v2.1.0'], diverged)
            retry = subprocess.run([sys.executable, version.__file__, '--revision', older,
                '--plan-file', 'unused.json', '--bucket', 'catus-prod-deploy-artifacts-test', '--check-order-only'], cwd=directory, capture_output=True, text=True)
            self.assertNotEqual(retry.returncode, 0)
            self.assertIn('최신 Catus 발행보다 오래되거나', retry.stderr)

    def test_SSM_전송의도는_요청검증후_보관하고_재실행에서_복구한다(self):
        deploy = workflow('prod-cd.yml')['jobs']['deploy']
        self.assertEqual(deploy['permissions']['actions'], 'read')
        steps = deploy['steps']
        prepare = next(i for i, step in enumerate(steps) if step.get('name') == 'SSM 배포 요청 검증')
        intent = next(i for i, step in enumerate(steps) if step.get('id') == 'intent')
        upload = next(i for i, step in enumerate(steps) if step.get('uses') == 'actions/upload-artifact@v4')
        execute = next(i for i, step in enumerate(steps) if step.get('name') == 'Catus 전용 SSM 배포·결과 대기')
        self.assertLess(intent, prepare)
        self.assertLess(prepare, upload)
        self.assertLess(upload, execute)
        self.assertEqual(steps[upload]['if'], "steps.intent.outputs.exists != 'true'")
        self.assertEqual(steps[upload]['with']['name'], 'catus-ssm-send-intent')
        self.assertIn('--previous-intent previous-intent/ssm-request.json', steps[execute]['run'])

    def test_SSM_전송의도와_요청이_다르면_배포하지_않는다(self):
        deploy = module('deploy_cli', 'catus-deploy.py')
        with tempfile.TemporaryDirectory() as directory:
            current, previous = Path(directory, 'current.json'), Path(directory, 'previous.json')
            current.write_text(json.dumps({'marker': 'catus:1:2'}))
            previous.write_text(json.dumps({'marker': 'catus:1:3'}))
            with patch.object(sys, 'argv', ['deploy', 'execute', '--request', str(current), '--previous-intent', str(previous)]), \
                 patch.object(deploy, 'execute') as execute, self.assertRaisesRegex(ValueError, '전송 의도'):
                deploy.main()
            execute.assert_not_called()

    def test_digest_재업로드는_같은이름의_이전시도_산출물을_교체한다(self):
        steps = workflow('prod-ci.yml')['jobs']['images']['steps']
        upload = next(step['with'] for step in steps if step.get('uses') == 'actions/upload-artifact@v4')
        self.assertEqual(upload['name'], 'catus-${{ matrix.service }}-digest')
        self.assertEqual(upload['overwrite'], 'true')

    def run_badge(self, path, artifacts, conclusion='failure', attempt=2):
        rule = badge.RULES[path]
        event = {'repository': {'id': 1}, 'workflow_run': {
            'id': 123, 'path': path, 'event': rule[0], 'head_branch': rule[1],
            'head_repository': {'id': 1}, 'head_sha': 'b' * 40,
            'updated_at': '2026-01-02T00:00:00Z', 'conclusion': conclusion, 'run_attempt': attempt}}
        class API:
            def request(self, path, raw=False):
                if '/jobs?' in path:
                    return {'jobs': [{'steps': [{'started_at': '2026-01-02T00:00:00Z'}]}]}
                if '/artifacts?' in path:
                    return {'artifacts': [{'id': i, 'name': name, 'expired': False}
                                          for i, (name, _) in enumerate(artifacts)]}
                i = int(path.split('/')[-2])
                name, payload = artifacts[i]
                expected = ('satellite-deploy-record.json' if name == 'satellite-deploy-record'
                            else 'satellite-deploy-plan.json' if name == 'satellite-deploy-plan'
                            else 'dev.json' if rule[3] == 'dev' else 'deployment-status-prod.json')
                content = io.BytesIO()
                with zipfile.ZipFile(content, 'w') as archive:
                    archive.writestr(expected, json.dumps(payload))
                return content.getvalue()
        with tempfile.TemporaryDirectory() as directory:
            event_file = Path(directory, 'event.json')
            event_file.write_text(json.dumps(event))
            with patch.dict(os.environ, {'GITHUB_EVENT_PATH': str(event_file), 'GITHUB_EVENT_NAME': 'workflow_run'}), \
                 patch.object(badge, 'GitHub', return_value=API()), patch.object(badge, 'publish') as publish:
                badge.main()
            return publish.call_args.args[1] if publish.called else []

    def test_재실행_실패와_취소는_이전성공_산출물을_사용하지_않는다(self):
        for path in ['.github/workflows/data-api-ci.dev.yml', '.github/workflows/realtime-ci.dev.yml']:
            service = next(iter(badge.RULES[path][2]))
            for conclusion in ['failure', 'cancelled']:
                with self.subTest(path=path, conclusion=conclusion):
                    records = self.run_badge(path, [('deployment-status-dev-1', [record(service)])], conclusion)
                    self.assertEqual({(r['service'], r['result']) for r in records},
                                     {(name, 'failure') for name in badge.RULES[path][2]})

    def test_현재시도_성공결과는_같은실행의_이전산출물과_구분한다(self):
        current = {**record(), 'revision': 'b' * 40}
        records = self.run_badge('.github/workflows/data-api-ci.dev.yml', [
            ('deployment-status-dev-2', [current]), ('deployment-status-dev-1', [record(result='failure')])], 'success')
        self.assertEqual(records, [current])

    def test_Data공동CD의_두서비스_성공산출물을_함께_게시한다(self):
        records = [{**record(service), 'revision': 'b' * 40} for service in ('data-api', 'realtime')]
        self.assertEqual(self.run_badge('.github/workflows/data-api-ci.dev.yml', [
            ('deployment-status-dev-2', records)], 'success'), records)

    def test_Satellite_CD는_실패전에_기록한_선택대상과_원본SHA만_실패로_남긴다(self):
        for service in ['business-api', 'notification']:
            plan = {s: s == service for s in ['business-api', 'notification']}
            for conclusion in ['failure', 'cancelled']:
                with self.subTest(service=service, conclusion=conclusion):
                    records = self.run_badge('.github/workflows/satellite-cd.dev.yml', [
                        ('satellite-deploy-record', {**plan, 'head_sha': 'c' * 40}),
                        ('deployment-status-dev-1', [record(service)])], conclusion)
                    self.assertEqual([(r['service'], r['result'], r['revision']) for r in records],
                                     [(service, 'failure', 'c' * 40)])
                    state = badge.merge({}, [record(s) for s in badge.DEV])
                    state = badge.merge(state, records)
                    state = badge.merge(state, [record(service, stamp='2026-01-03T00:00:00+00:00')])
                    self.assertEqual(badge.badges(state)['dev.json']['color'], 'brightgreen')

    def test_Satellite_대상없음과_대상미확인은_다른서비스를_실패로_만들지_않는다(self):
        path = '.github/workflows/satellite-cd.dev.yml'
        self.assertEqual(self.run_badge(path, []), [])
        self.assertEqual(self.run_badge('.github/workflows/satellite-ci.dev.yml', []), [])
        self.assertEqual(self.run_badge(path, [('satellite-deploy-record', {
            'business-api': False, 'notification': False, 'head_sha': 'c' * 40})]), [])
        self.assertEqual(self.run_badge('.github/workflows/satellite-ci.dev.yml', [
            ('satellite-deploy-plan', {'business-api': False, 'notification': True})])[0]['service'], 'notification')

    def test_prod_재실행_실패가_이전시도_성공을_게시하지_않는다(self):
        previous = {**record('catus'), 'environment': 'prod', 'version': 'catus-v2.0.0',
                    'release_id': 'a' * 40 + '-1-1', 'infra_revision': 'c' * 40}
        self.assertEqual(self.run_badge('.github/workflows/prod-cd.yml', [
            ('deployment-status-prod-1', [previous])]), [])

    def test_모든배포_workflow는_시도별_배지산출물을_작성한다(self):
        for filename in ['data-api-cd.dev.yml', 'satellite-cd.dev.yml', 'prod-cd.yml']:
            uploads = [step['with']['name'] for job in workflow(filename)['jobs'].values()
                       for step in job.get('steps', []) if step.get('uses') == 'actions/upload-artifact@v4'
                       and step['with']['name'].startswith('deployment-status-')]
            environment = 'prod' if filename == 'prod-cd.yml' else 'dev'
            self.assertEqual(uploads, ['deployment-status-' + environment + '-${{ github.run_attempt }}'])

    def test_네서비스_확인전에_dev전체_배포완료라고_표시하지_않는다(self):
        state = badge.merge({}, [record()])
        self.assertEqual(badge.badges(state)['dev.json']['message'], '배포 확인 1/4')
        state = badge.merge(state, [record(service) for service in badge.DEV])
        self.assertEqual(badge.badges(state)['dev.json']['message'], '배포 완료 4/4')
        state = badge.merge(state, [record('notification', 'failure', '2026-01-02T00:00:00+00:00')])
        self.assertEqual(badge.badges(state)['dev.json']['color'], 'red')
        state = badge.merge(state, [record('realtime', 'success', '2026-01-03T00:00:00+00:00')])
        self.assertEqual(badge.badges(state)['dev.json']['color'], 'red')
        self.assertIn('성공 3/4', badge.badges(state)['dev.json']['message'])

    def test_늦게_도착한_이전실행이_최신배포를_덮지_않는다(self):
        latest = record(stamp='2026-01-02T00:00:00+00:00')
        state = badge.merge({}, [latest])
        self.assertEqual(badge.merge(state, [record(result='failure')]), state)

    def test_PR과_fork는_쓰기권한을_갖는_배지게시에서_제외한다(self):
        event = {'repository': {'id': 1}, 'workflow_run': {'path': '.github/workflows/data-api-ci.dev.yml',
                 'event': 'push', 'head_branch': 'main', 'head_repository': {'id': 1}}}
        self.assertIsNotNone(badge.trusted_run(event))
        event['workflow_run']['event'] = 'pull_request'
        self.assertIsNone(badge.trusted_run(event))
        event['workflow_run']['event'] = 'push'
        event['workflow_run']['head_repository']['id'] = 2
        self.assertIsNone(badge.trusted_run(event))

    def test_prod는_성공버전만_받고_롤백성공시_이전버전을_표시한다(self):
        prod = {**record('catus'), 'environment': 'prod', 'version': 'catus-v2.1.0',
                'release_id': 'a' * 40 + '-1-1', 'infra_revision': 'b' * 40}
        rule = badge.RULES['.github/workflows/prod-cd.yml']
        state = badge.merge({}, badge.validate([prod], rule))
        rollback = {**prod, 'version': 'catus-v2.0.0', 'finished_at': '2026-01-02T00:00:00+00:00'}
        state = badge.merge(state, badge.validate([rollback], rule))
        self.assertEqual(badge.badges(state)['prod.json']['message'], 'catus-v2.0.0')
        with self.assertRaises(ValueError):
            badge.validate([{**prod, 'result': 'failure'}], rule)

    def test_CI실패로_CD가_미실행돼도_이전_초록배지가_유지되지_않는다(self):
        state = badge.merge({}, [record(service) for service in badge.DEV])
        run = {'conclusion': 'failure', 'head_sha': 'b' * 40, 'updated_at': '2026-01-02T00:00:00Z'}
        rule = badge.RULES['.github/workflows/data-api-ci.dev.yml']
        failures = badge.missing_result(run, rule)
        state = badge.merge(state, failures)
        self.assertEqual(badge.badges(state)['dev.json']['color'], 'red')
        self.assertEqual(state['dev/data-api']['revision'], 'b' * 40)
        run['conclusion'] = 'success'
        self.assertEqual(badge.missing_result(run, rule), [])
        run['conclusion'] = 'failure'
        self.assertEqual(badge.missing_result(run, badge.RULES['.github/workflows/prod-cd.yml']), [])
        rule = badge.planned_rule(badge.RULES['.github/workflows/satellite-ci.dev.yml'], {'business-api': True, 'notification': False})
        self.assertEqual([item['service'] for item in badge.missing_result(run, rule)], ['business-api'])
        with self.assertRaises(ValueError):
            badge.planned_rule(rule, {'business-api': 'false', 'notification': False})

    def test_공개상태에_비밀값_키를_추가할_수_없다(self):
        with self.assertRaises(ValueError):
            badge.validate([{**record(), 'DB_PASSWORD': 'should-not-be-public'}], badge.RULES['.github/workflows/data-api-ci.dev.yml'])

    def test_브랜치_충돌은_최신상태와_병합하고_force_push하지_않는다(self):
        import base64
        import urllib.error
        class API:
            def __init__(self): self.patches, self.states = 0, []
            def request(self, path, method='GET', data=None):
                if path.startswith('/git/ref/'):
                    return {'object': {'sha': 'tip'}}
                if path == '/git/commits/tip': return {'tree': {'sha': 'base'}}
                if path == '/git/trees/base': return {'tree': [{'path': 'state.json', 'sha': 'blob'}]}
                if path == '/git/blobs/blob':
                    existing = {'dev/realtime': record('realtime', stamp='2026-01-02T00:00:00+00:00')}
                    return {'content': base64.b64encode(json.dumps(existing).encode()).decode()}
                if path == '/git/trees':
                    self.states.append(json.loads(next(item['content'] for item in data['tree'] if item['path'] == 'state.json')))
                    return {'sha': 'tree'}
                if path == '/git/commits': return {'sha': 'new'}
                if path.startswith('/git/refs/'):
                    if data['force']: raise AssertionError('force push 금지')
                    self.patches += 1
                    if self.patches == 1: raise urllib.error.HTTPError('', 422, 'race', {}, None)
                    return {}
                raise AssertionError(path)
        api = API()
        with patch.object(badge.time, 'sleep'):
            badge.publish(api, [record()])
        self.assertEqual(api.patches, 2)
        self.assertIn('dev/realtime', api.states[-1])
        self.assertIn('dev/data-api', api.states[-1])

    def test_Satellite는_부분성공을_서비스별로_기록한다(self):
        steps = workflow('satellite-cd.dev.yml')['jobs']['deploy']['steps']
        script = next(step['run'] for step in steps if step.get('name') == 'README 배포 상태 기록')
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'satellite-health.txt').write_text('business-api success\nnotification failure\n')
            env = {**os.environ, 'RUNNER_TEMP': directory, 'BADGE_REVISION': 'a' * 40,
                   'BADGE_RESULT': 'failure', 'BUSINESS_SELECTED': 'true', 'NOTIFICATION_SELECTED': 'true'}
            result = subprocess.run(['bash', '-c', script], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            records = json.loads(Path(directory, 'deployment-status/dev.json').read_text())
            self.assertEqual({r['service']: r['result'] for r in records}, {'business-api': 'success', 'notification': 'failure'})

    def test_Satellite_CD는_하나만_실패해도_전체_헬스체크가_실패한다(self):
        steps = workflow('satellite-cd.dev.yml')['jobs']['deploy']['steps']
        script = next(step['run'] for step in steps if step.get('id') == 'health')
        script = script.replace('${{ needs.plan.outputs.business }}', 'true').replace('${{ needs.plan.outputs.notification }}', 'true')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'bin').mkdir()
            docker = root / 'bin/docker'
            docker.write_text('#!/bin/bash\nif [ "$1" = inspect ]; then echo "/${@: -1}"; else echo "${@: -1}"; fi\n')
            docker.chmod(0o755)
            helper = root / '.github/scripts/wait-healthy.sh'
            helper.parent.mkdir(parents=True)
            helper.write_text('#!/bin/bash\n[ "$1" != "$FAILURE_SERVICE" ]\n')
            helper.chmod(0o755)
            env = {**os.environ, 'PATH': str(root / 'bin') + os.pathsep + os.environ['PATH'],
                   'RUNNER_TEMP': directory, 'RUNTIME_ENV_FILE': str(root / 'dev.env'), 'SATELLITE_RUNTIME_DIR': directory}
            for failed, expected in [('business-api', 1), ('notification', 1), ('none', 0)]:
                result = subprocess.run(['bash', '-c', script], cwd=root,
                    env={**env, 'FAILURE_SERVICE': failed}, capture_output=True, text=True)
                self.assertEqual(result.returncode, expected, result.stderr)

    def test_수동롤백은_SSM전송과_조회시간초과를_복구하고_성공후에만_기록한다(self):
        namespace = module('catus_deploy_test', 'catus-deploy.py').__dict__
        envelope = {'version': 'catus-v2.0.0', 'release_id': 'a' * 40 + '-1-1',
                    'source_revision': 'a' * 40, 'infra_revision': 'b' * 40, 'bundle_sha256': 'c' * 64}
        config = {'PRODUCT': 'catus', 'SSM_DOC': 'catus-prod-deploy',
                  'DEPLOY_BUCKET': 'catus-prod-deploy-artifacts-808715036056', 'INSTANCE_ID': 'i-catus'}
        calls = []
        def aws(*args):
            calls.append(args)
            if args[0] == 'secretsmanager': return {'SecretString': json.dumps(config)}
            if args[1] == 'list-commands':
                self.assertEqual(args[-1], 'key=DocumentName,value=catus-prod-deploy')
                queries = sum(call[1] == 'list-commands' for call in calls)
                if queries == 1:
                    self.assertFalse(any(call[1] == 'send-command' for call in calls))
                    raise subprocess.TimeoutExpired('aws', 30)
                if queries < 4:
                    return {'Commands': []}
                sent = next(call for call in calls if call[1] == 'send-command')
                return {'Commands': [{'CommandId': 'command', 'Comment': 'catus:1:2',
                    'Parameters': json.loads(sent[-1]), 'InstanceIds': ['i-catus']}]}
            if args[1] == 'send-command': raise subprocess.TimeoutExpired('aws', 30)
            if sum(call[1] == 'get-command-invocation' for call in calls) == 1:
                raise subprocess.TimeoutExpired('aws', 30)
            return {'Status': 'Success'}
        def download(args, **kwargs):
            self.assertIn('versions/catus-v2.0.0.json', args)
            Path(args[-1]).write_text(json.dumps(envelope))
        namespace['aws'] = aws
        with tempfile.TemporaryDirectory() as directory:
            before = Path.cwd()
            try:
                os.chdir(directory)
                with patch.object(sys, 'argv', ['request', '--release-id', 'catus-v2.0.0', '--operation', 'rollback']), \
                     patch.dict(os.environ, {'GITHUB_STEP_SUMMARY': str(Path(directory, 'summary')),
                         'GITHUB_REPOSITORY_ID': '1', 'GITHUB_RUN_ID': '2', 'GITHUB_RUN_ATTEMPT': '1'}), \
                     patch.object(subprocess, 'run', download), patch.object(namespace['time'], 'sleep') as sleep:
                    # 이전 시도가 S3 다운로드에서 실패했어도 전송 의도는 아직 없으므로 재시도 가능하다.
                    with patch.object(subprocess, 'run', side_effect=RuntimeError('S3 download failed')), self.assertRaises(RuntimeError):
                        namespace['prepare']('catus-v2.0.0', 'rollback')
                    request = namespace['prepare']('catus-v2.0.0', 'rollback')
                    namespace['execute'](request)
                self.assertEqual([call.args for call in sleep.call_args_list], [(5,)] * 3)
                self.assertEqual(sum(call[1] == 'list-commands' for call in calls), 4)
                self.assertEqual(sum(call[1] == 'send-command' for call in calls), 1)
                self.assertEqual(sum(call[1] == 'get-command-invocation' for call in calls), 2)
                params = json.loads(next(call for call in calls if call[1] == 'send-command')[-1])
                self.assertEqual(params['ReleaseId'], [envelope['release_id']])
                self.assertEqual(params['Operation'], ['rollback'])
                self.assertEqual(json.loads(Path('deployment-status-prod.json').read_text())[0]['version'], envelope['version'])
                # Actions 재실행은 앞선 시도의 명령을 복구하고 send-command를 다시 호출하지 않는다.
                with patch.object(sys, 'argv', ['request', '--release-id', 'catus-v2.0.0', '--operation', 'rollback']), \
                     patch.dict(os.environ, {'GITHUB_STEP_SUMMARY': str(Path(directory, 'summary')),
                         'GITHUB_REPOSITORY_ID': '1', 'GITHUB_RUN_ID': '2', 'GITHUB_RUN_ATTEMPT': '2'}), \
                     patch.object(subprocess, 'run', download):
                    namespace['execute'](request, already_submitted=True)
                self.assertEqual(sum(call[1] == 'send-command' for call in calls), 1)
            finally:
                os.chdir(before)

    def test_workflow의_모든_인라인Python은_실행가능한_구문이다(self):
        for filename in ['prod-ci.yml', 'prod-cd.yml', 'data-api-cd.dev.yml',
                         'satellite-cd.dev.yml']:
            for job in workflow(filename)['jobs'].values():
                for step in job.get('steps', []):
                    script = step.get('run', '')
                    for delimiter in ['PYTHON', 'PY']:
                        marker = "<<'" + delimiter + "'\n"
                        if marker in script:
                            ast.parse(script.split(marker, 1)[1].split('\n' + delimiter, 1)[0])


if __name__ == '__main__':
    unittest.main()
