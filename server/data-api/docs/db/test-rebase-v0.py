#!/usr/bin/env python3
"""전환 도구의 잘못된 대상·이력 거부 계약. DB 통합 검증은 README.md를 따른다."""
import importlib.util
import copy
import io
import sys
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('rebase_v0', Path(__file__).with_name('rebase-v0.py'))
rebase = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rebase)


class RebaseGuardTest(unittest.TestCase):
    def setUp(self):
        self.known = [{'version': '1', 'type': 'SQL', 'script': 'V1__baseline.sql',
                       'checksum': 123, 'success': True}]

    def test_정확한_기존_이력과_최초_baseline_표시만_허용한다(self):
        rebase.assert_history(self.known, self.known)
        baseline = [{**self.known[0], 'type': 'BASELINE', 'checksum': None, 'script': '<< baseline >>'}]
        rebase.assert_history(baseline, self.known)

    def test_변조_누락_추가_실패_이력을_거부한다(self):
        cases = [[], self.known * 2,
                 [{**self.known[0], 'checksum': 999}],
                 [{**self.known[0], 'success': False}],
                 [{**self.known[0], 'version': '118'}],
                 [{**self.known[0], 'script': 'V1__unexpected.sql'}]]
        for value in cases:
            with self.subTest(value=value), self.assertRaises(ValueError):
                rebase.assert_history(value, self.known)

    def test_백오피스_profile은_정확한_확장과_canonical_체크섬을_고정한다(self):
        original = rebase.load_manifest()
        extended = rebase.extension_profile(original)
        self.assertEqual(126, len(original['source_history']))
        self.assertEqual(127, len(extended['source_history']))
        self.assertEqual(['1','2','3','4','5','6'], [item['version'] for item in extended['bridge_history']])
        self.assertEqual(5, len(set(extended['source_tables']) - set(original['source_tables'])))
        self.assertEqual('backoffice-137.1', rebase.profile_for_history(original, [rebase.extension_entry()])['profile'])
        self.assertIs(original, rebase.profile_for_history(original, original['source_history']))

    def test_백오피스_SQL_원문_변조는_허용하지_않는다(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / rebase.EXTENSION_SCRIPT
            path.write_text('CREATE TABLE arbitrary(id integer);')
            with self.assertRaisesRegex(ValueError, '승인된 백오피스'):
                rebase.extension_entry(Path(directory))

    def test_백오피스_bridge는_실행과_이력을_같은_transaction에서_확정한다(self):
        manifest = rebase.extension_profile(rebase.load_manifest())
        sql = rebase.apply_sql(manifest, manifest['v0_checksum'])
        self.assertIn('ADD COLUMN seat_x', sql)
        self.assertIn('CREATE TABLE construction_buildings', sql)
        self.assertNotIn('CREATE TABLE content_publications', sql)
        self.assertNotIn('CREATE TABLE focus_reward_policy_approvals', sql)
        self.assertLess(sql.index('백오피스 bridge 결과'), sql.rindex('COMMIT;'))

    def test_읽기전용계획과_실행영수증은_실제_BASELINE_이력과_확장근거를_보존한다(self):
        manifest = rebase.extension_profile(rebase.load_manifest())
        history = copy.deepcopy(manifest['source_history'])
        history[0].update(type='BASELINE', checksum=None, script='<< baseline >>', password='do-not-copy')
        info = {'database':'audit','user':'audit','server_version':'160014','other_connections':0}
        for apply in (False, True):
            with self.subTest(apply=apply), tempfile.TemporaryDirectory() as directory:
                backup = Path(directory)/'before.dump'
                sidecar = Path(str(backup)+'.plan.json')
                database = Mock()
                database.env = {'PGHOST':'127.0.0.1','PGPORT':'5432','PGDATABASE':'audit',
                                'PGUSER':'audit','PGPASSWORD':'do-not-copy'}
                database.data.side_effect = [info, history, {}]
                database.fingerprint.return_value = manifest['source_schemas'][0]
                def sql(statement):
                    if statement.startswith('\nBEGIN;'):
                        self.assertTrue(sidecar.exists())
                        self.assertEqual(sidecar.stat().st_mode & 0o777, 0o600)
                    return '0'
                database.sql.side_effect = sql
                database.backup.side_effect = lambda path: path.write_bytes(b'fixture-backup')
                argv = ['rebase','--environment','dev']
                if apply:
                    argv += ['--apply','--writers-stopped','--confirm','dev:audit','--backup',str(backup)]
                with patch.object(sys,'argv',argv), patch.object(rebase,'Database',return_value=database), \
                     patch.object(rebase,'check_bot_references'), patch('sys.stdout',new_callable=io.StringIO) as stdout:
                    rebase.main()
                plan = json.JSONDecoder().raw_decode(stdout.getvalue())[0]
                self.assertEqual(plan['source_history'][0], {key: history[0][key]
                    for key in ('version','type','script','checksum','success')})
                self.assertEqual(plan['extension']['sha256'], rebase.EXTENSION_SHA256)
                self.assertEqual(plan['extension']['checksum'], manifest['extension_history']['checksum'])
                self.assertNotIn('do-not-copy',json.dumps(plan))
                self.assertEqual(sidecar.exists(), apply)
                if apply:
                    self.assertEqual(json.loads(sidecar.read_text()),plan)
                    database.backup.assert_called_once_with(backup)
                else:
                    database.backup.assert_not_called()
                    self.assertFalse(any(call.args[0].startswith('\nBEGIN;') for call in database.sql.call_args_list))

    def test_원본계획은_확장으로_오인하지_않고_기존영수증을_덮어쓰지_않는다(self):
        manifest=rebase.load_manifest()
        plan=rebase.transition_evidence(manifest,manifest['source_history'],manifest['source_schemas'][0])
        self.assertIsNone(plan['extension'])
        self.assertEqual(plan['source_profile'],'original')
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'plan.json'
            rebase.write_plan(path,plan)
            with self.assertRaises(FileExistsError): rebase.write_plan(path,{'replacement':True})
            self.assertEqual(json.loads(path.read_text()),plan)

    def test_연결_대상이_없으면_기본_DB로_접속하지_않는다(self):
        for missing in ('PGHOST', 'PGDATABASE', 'PGUSER'):
            env = {'PGHOST': 'localhost', 'PGDATABASE': 'audit', 'PGUSER': 'audit'}
            del env[missing]
            with patch.dict(os.environ, env, clear=True), self.assertRaises(ValueError):
                rebase.Database('auto')

    def test_SQL_식별자_주입을_거부한다(self):
        with self.assertRaises(ValueError):
            rebase.identifier('users; DROP DATABASE audit')

    def test_Flyway_체크섬은_개행과_BOM을_제외한다(self):
        with tempfile.TemporaryDirectory() as directory:
            unix, windows = Path(directory) / 'unix.sql', Path(directory) / 'windows.sql'
            unix.write_bytes(b'SELECT 1;\nSELECT 2;\n')
            windows.write_bytes(b'\xef\xbb\xbfSELECT 1;\r\nSELECT 2;\r\n')
            self.assertEqual(rebase.checksum(unix), rebase.checksum(windows))
            windows.write_bytes(b'SELECT 2;\n')
            self.assertNotEqual(rebase.checksum(unix), rebase.checksum(windows))

    def test_원본_126개_이력과_V0_기본데이터_자료가_일치한다(self):
        manifest = json.loads((rebase.ASSETS / 'manifest.json').read_text())
        self.assertEqual('138', manifest['source_version'])
        self.assertEqual(126, len(manifest['source_history']))
        self.assertEqual(manifest['v0_checksum'], rebase.checksum(rebase.BASELINE))
        self.assertEqual(manifest['seed_checksum'], rebase.checksum(rebase.DEFAULTS))
        self.assertEqual(manifest['seed_sha256'], hashlib.sha256(rebase.DEFAULTS.read_bytes()).hexdigest())
        migrations = rebase.BASELINE.parent.parent / 'migration'
        for migration in manifest['source_history']:
            self.assertEqual(migration['checksum'], rebase.checksum(migrations / migration['script']))
        self.assertEqual(345, sum(manifest['default_rows'].values()))


if __name__ == '__main__':
    unittest.main()
