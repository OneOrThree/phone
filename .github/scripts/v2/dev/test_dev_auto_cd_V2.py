import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('auto_cd', Path(__file__).with_name('dev-auto-cd-V2.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def run(number, status='completed', conclusion='success', attempt=1):
    return {'id': number * 10, 'run_number': number, 'run_attempt': attempt, 'status': status, 'conclusion': conclusion}


class AutoCdTest(unittest.TestCase):
    def setUp(self):
        # note()가 실행 로그에 찍는 줄이 테스트 출력에 섞이지 않게 한다.
        stdout = mock.patch('sys.stdout', new_callable=io.StringIO)
        stdout.start()
        self.addCleanup(stdout.stop)

    def test_ci_status(self):
        self.assertEqual(m.ci_status([]), ('missing', None))
        self.assertEqual(m.ci_status([run(1), run(2, 'in_progress', None)]), ('running', None))
        self.assertEqual(m.ci_status([run(1, conclusion='failure'), run(2)]), ('success', 20))
        self.assertEqual(m.ci_status([run(1), run(2, conclusion='failure')]), ('failed', None))
        self.assertEqual(m.ci_status([run(1, conclusion='cancelled')]), ('missing', None))

    def test_manifests_are_newest_first_and_ignore_other_paths(self):
        base = m.BUCKET + '/releases/kafka/'
        pattern = m.re.escape(base) + r'[0-9a-f]{40}-[0-9]+-[0-9]+/manifest\.json'
        old, new = base + 'a'*40 + '-1-1/manifest.json', base + 'b'*40 + '-2-1/manifest.json'
        lines = f'10 2026-10-30T01:00:00Z {old}\n10 2026-10-30T02:00:00Z {new}\n1 2026-10-30T03:00:00Z {base}x\nTOTAL: 3\n'
        self.assertEqual(m.manifests(lines, pattern), [new, old])
        self.assertEqual(m.manifests('', pattern), [])

    def test_manifest_skips_newest_when_not_ancestor(self):
        old, new = 'a'*40, 'b'*40
        base = m.BUCKET + '/releases/kafka/'
        lines = f'1 2026-10-30T01:00:00Z {base}{old}-1-1/manifest.json\n1 2026-10-30T02:00:00Z {base}{new}-2-1/manifest.json\n'
        with mock.patch.object(m, 'listing', return_value=lines), \
             mock.patch.object(m, 'is_ancestor', side_effect=lambda before, after: before == old), \
             mock.patch.object(m, 'same_runtime', return_value=True):
            self.assertIn(old, m.runtime_manifest('kafka', 'c'*40))

    def test_listing_separates_empty_from_failure(self):
        result = mock.Mock(returncode=1, stdout='', stderr='One or more URLs matched no objects.')
        with mock.patch.object(m.subprocess, 'run', return_value=result):
            self.assertEqual(m.listing('gs://x'), '')
        result.stderr = 'permission denied'
        with mock.patch.object(m.subprocess, 'run', return_value=result):
            with self.assertRaises(RuntimeError): m.listing('gs://x')

    def runtimes(self, status, uri=None):
        state = mock.Mock()
        state.read.return_value = (None, '0')
        with mock.patch.object(m, 'runtime_manifest', return_value=uri), \
             mock.patch.object(m, 'ci_for', return_value=(status, None)), \
             mock.patch.object(m, 'dispatch') as dispatch:
            return (*m.plan_runtimes(state, 'c'*40), dispatch)

    def test_missing_ci_dispatches_and_running_waits(self):
        targets, ready, dispatch = self.runtimes('missing')
        self.assertEqual((targets, ready), ([], False))
        self.assertEqual(dispatch.call_count, 3)
        targets, ready, dispatch = self.runtimes('running')
        self.assertEqual((targets, ready), ([], False))
        dispatch.assert_not_called()

    def test_success_without_manifest_fails_instead_of_looping(self):
        with self.assertRaises(RuntimeError): self.runtimes('success')

    def test_runtime_targets_are_listed_without_deploying(self):
        targets, ready, _ = self.runtimes('success', 'gs://uri')
        self.assertTrue(ready)
        self.assertEqual(targets, [{'role': role, 'uri': 'gs://uri'} for role in m.RUNTIMES])

    def test_same_host_runtimes_stay_in_one_sequential_group(self):
        targets = [{'role': role, 'uri': role} for role in m.RUNTIMES]
        self.assertEqual(m.host_groups(targets), [{'host': 'redis', 'targets': targets[:1]},
                                                  {'host': 'data', 'targets': targets[1:]}])
        self.assertEqual(m.host_groups(targets[2:]), [{'host': 'data', 'targets': targets[2:]}])
        self.assertEqual(m.host_groups([]), [])
        with mock.patch.object(m.subprocess, 'run') as run:
            m.deploy_group(targets[1:])
        self.assertEqual([call.args[0][3] for call in run.call_args_list], ['kafka', 'postgres'])

    def test_emit_writes_step_outputs(self):
        with tempfile.NamedTemporaryFile('r') as stream, mock.patch.dict(m.os.environ, {'GITHUB_OUTPUT': stream.name}):
            m.emit(runtimes='[]', infra='gs://x')
            self.assertEqual(stream.read(), 'runtimes=[]\ninfra=gs://x\n')

    def test_dispatched_ci_wakes_auto_cd(self):
        root = Path(__file__).parents[3]/'workflows'
        for name in ('data-api', 'satellite', 'kafka', 'redis', 'postgres'):
            text = (root/f'{name}-ci.dev-v2.yml').read_text()
            self.assertIn('gh workflow run cd-auto.dev-v2.yml', text)


class SummaryTest(unittest.TestCase):
    """배포를 건너뛴 이유가 실행 화면(GITHUB_STEP_SUMMARY)에 남는다. 바깥 경계(git·GCS·GitHub)만 대체한다."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.summary, self.output = Path(directory.name, 'summary'), Path(directory.name, 'output')
        env = {'GITHUB_STEP_SUMMARY': str(self.summary), 'GITHUB_OUTPUT': str(self.output),
               'GITHUB_SHA': 'c' * 40, 'GITHUB_REF': 'refs/heads/main'}
        for patcher in (mock.patch.dict(m.os.environ, env), mock.patch('sys.stdout', new_callable=io.StringIO)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def lines(self):
        return self.summary.read_text().splitlines()

    def main_at(self, latest, **statuses):
        """main()을 실제 plan_runtimes로 돌린다. 이 커밋의 산출물은 없다."""
        state = mock.Mock()
        state.read.return_value = (None, '0')
        with mock.patch.object(m, 'output', return_value=latest + '\trefs/heads/main\n'), \
             mock.patch.object(m, 'load', return_value=state), \
             mock.patch.object(m, 'runtime_manifest', return_value=None), \
             mock.patch.object(m, 'ci_for', side_effect=lambda workflow, revision: (statuses[workflow.split('-')[0]], None)), \
             mock.patch.object(m, 'dispatch') as dispatch:
            m.main()
        return dispatch

    def app(self, previous, ci):
        """plan_app()을 실제 플래너·지문 코드로 돌린다. 모든 git 트리는 같은 바이트를 돌려준다."""
        infra = f'{m.BUCKET}/infra/{"a" * 40}-1-1/manifest.json'
        state = mock.Mock()
        state.read.return_value = (previous, '1')
        with mock.patch.object(m, 'listing', return_value=f'1 2026-10-30T01:00:00Z {infra}\n'), \
             mock.patch.object(m.subprocess, 'run', return_value=mock.Mock(stdout=b'tree')), \
             mock.patch.object(m, 'ci_for', return_value=(ci, None)), \
             mock.patch.object(m, 'dispatch') as dispatch:
            return m.plan_app(state, 'c' * 40), dispatch

    def previous(self):
        with mock.patch.object(m.subprocess, 'run', return_value=mock.Mock(stdout=b'tree')):
            fingerprints = m.load('summary_fp', 'dev-fingerprint-V2.py').fingerprint('c' * 40)
        return {'environment': 'dev-v2', 'release_id': 'r1', 'infra_revision': 'a' * 40, 'source_fingerprints': fingerprints,
                'images': {s: f'asia-northeast3-docker.pkg.dev/oneorthree2/{s}/{s}@sha256:' + 'e' * 64 for s in fingerprints}}

    def test_notes_are_markdown_list_items(self):
        m.note('첫째')
        m.note('둘째')
        self.assertEqual(self.summary.read_text(), '- 첫째\n- 둘째\n')

    def test_stale_run_says_it_restarts_on_the_latest_main(self):
        latest = 'd' * 40
        dispatch = self.main_at(latest)
        dispatch.assert_called_once_with('cd-auto.dev-v2.yml')
        self.assertEqual(self.lines(), [f'- main이 {latest}로 앞서 최신 기준으로 다시 실행'])

    def test_runtime_wait_names_each_role_and_whether_its_ci_was_requested(self):
        dispatch = self.main_at('c' * 40, redis='running', kafka='missing', postgres='missing')
        self.assertEqual(dispatch.call_args_list, [mock.call('kafka-ci.dev-v2.yml'), mock.call('postgres-ci.dev-v2.yml')])
        self.assertEqual(self.lines(), [
            '- redis 런타임 산출물 대기: redis-ci.dev-v2.yml 진행 중',
            '- kafka 런타임 산출물 대기: kafka-ci.dev-v2.yml 실행 요청',
            '- postgres 런타임 산출물 대기: postgres-ci.dev-v2.yml 실행 요청',
            '- 런타임 발행 대기. CI 완료 시 다시 실행',
            '- 런타임 배포 대상: 없음'])

    def test_unchanged_runtimes_are_listed_as_skipped(self):
        state = mock.Mock()
        state.read.return_value = ({'revision': 'b' * 40}, '1')
        with mock.patch.object(m, 'same_runtime', return_value=True):
            self.assertEqual(m.plan_runtimes(state, 'c' * 40), ([], True))
        self.assertEqual(self.lines(), [f'- {role} 런타임 변경 없음' for role in m.RUNTIMES])

    def test_no_app_target_says_so(self):
        plan, dispatch = self.app(self.previous(), 'success')
        self.assertIsNone(plan)
        self.assertEqual(self.lines(), ['- 앱 배포 대상 없음'])
        dispatch.assert_not_called()

    def test_image_wait_names_each_workflow_and_whether_it_was_requested(self):
        for ci, action, requests in (('running', '진행 중', 0), ('missing', '실행 요청', 2)):
            with self.subTest(ci=ci):
                self.summary.write_text('')
                plan, dispatch = self.app(None, ci)
                self.assertIsNone(plan)
                self.assertEqual(dispatch.call_count, requests)
                self.assertEqual(self.lines(), [f'- 앱 이미지 대기: {workflow} {action}' for workflow in (m.CORE_CI, m.SATELLITE_CI)]
                                 + ['- 이미지 CI 대기. 완료 시 다시 실행'])


if __name__ == '__main__': unittest.main()
