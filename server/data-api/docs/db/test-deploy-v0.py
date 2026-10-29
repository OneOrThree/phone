#!/usr/bin/env python3
"""배포 DB 실행기의 입력·이력·중단 복구 계약. 통합 검증은 test-deploy-v0-integration.py 참조."""
import importlib.util
import json
from types import SimpleNamespace
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('deploy_v0', Path(__file__).with_name('deploy-v0.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentGuardTest(unittest.TestCase):
    def test_자동전환도_이력교체전에_백업옆_감사영수증을_보존한다(self):
        manifest=deploy.rebase.extension_profile(deploy.rebase.load_manifest())
        for conflict in (False, True):
            with self.subTest(conflict=conflict), tempfile.TemporaryDirectory() as directory:
                args=SimpleNamespace(network='isolated',data_image='sha256:'+'a'*64,environment='dev',
                                     phase='apply',writers_stopped=True,backup_dir=Path(directory))
                journal=Mock()
                journal.data={'attempt_id':'attempt','backup_paths':[]}
                journal.save.side_effect=lambda **updates:journal.data.update(updates)
                database=Mock()
                database.backup.side_effect=lambda path:path.write_bytes(b'fixture-backup')
                database.data.return_value=manifest['source_history']
                database.fingerprint.return_value=manifest['source_schemas'][0]
                sidecar=Path(directory)/'attempt-before-change.dump.rebase-plan.json'
                if conflict: sidecar.write_text('existing evidence')
                def sql(statement):
                    self.assertTrue(sidecar.exists())
                    payload=json.loads(sidecar.read_text())
                    self.assertEqual(payload['source_history'],manifest['source_history'])
                    self.assertEqual(payload['extension']['sha256'],deploy.rebase.EXTENSION_SHA256)
                    self.assertEqual(payload['extension']['checksum'],manifest['extension_history']['checksum'])
                    self.assertEqual(sidecar.stat().st_mode & 0o777,0o600)
                    self.assertNotIn('never-store-password',sidecar.read_text())
                database.sql.side_effect=sql
                legacy={'state':'legacy','database':'fixture','source_version':'138','needs_backup':True,
                        'other_connections':0,'profile':'backoffice-137.1'}
                current={'state':'current','database':'fixture','source_version':'6','needs_backup':False}
                with patch.object(deploy,'Containers'),patch.object(deploy,'host'), \
                     patch.object(deploy,'Database',return_value=database), \
                     patch.object(deploy,'inspect_database',side_effect=[legacy,legacy,current]):
                    if conflict:
                        with self.assertRaises(FileExistsError):
                            deploy.execute(args,journal,{'API_DB_PASSWORD':'never-store-password'}, {})
                        database.sql.assert_not_called()
                        self.assertEqual(sidecar.read_text(),'existing evidence')
                    else:
                        self.assertEqual(deploy.execute(args,journal,{'API_DB_PASSWORD':'never-store-password'}, {})['state'],'current')
                        database.sql.assert_called_once()
                        self.assertEqual(journal.data['rebase_plan_path'],str(sidecar.resolve()))

    def test_Compose_literal_자격증명은_쉘_확장_없이_파싱한다(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'data.env'
            path.write_text("API_DB_URL='jdbc:postgresql://db:5432/data?currentSchema=public'\n"
                            "API_DB_USERNAME='api'\nAPI_DB_PASSWORD='literal$\\\'quote\nnext'\nIGNORED='value'\n")
            values = deploy.read_dotenv(path)
            self.assertEqual("literal$'quote\nnext", values['API_DB_PASSWORD'])
            self.assertEqual(3, len(values))
            connection = deploy.connection_environment(values)
            self.assertEqual('db', connection['PGHOST'])
            self.assertEqual('data', connection['PGDATABASE'])
            self.assertEqual(values['API_DB_PASSWORD'], connection['PGPASSWORD'])

    def test_대상과_스키마_검증을_우회하는_JDBC옵션은_거부한다(self):
        base = {'API_DB_URL': '', 'API_DB_USERNAME': 'api', 'API_DB_PASSWORD': 'secret'}
        for value in ['jdbc:postgresql://one,two/data', 'jdbc:postgresql://api:pass@db/data',
                      'jdbc:postgresql://db/data?currentSchema=other',
                      'jdbc:postgresql://db:0/data', 'jdbc:postgresql://db/data?ssl=ambiguous',
                      'jdbc:postgresql://db/data?options=-csearch_path=other',
                      'jdbc:postgresql://db/data?sslmode=disable&sslmode=require']:
            with self.subTest(url=value), self.assertRaises(ValueError):
                deploy.connection_environment({**base, 'API_DB_URL': value})
        env = deploy.connection_environment({**base, 'API_DB_URL': 'jdbc:postgresql://db/data?ssl=true'})
        self.assertEqual('verify-full', env['PGSSLMODE'])

    def test_이미지_번들의_원본과_현재체인을_검증한다(self):
        manifest = deploy.rebase.load_manifest()
        current = deploy.bundled_history(manifest)
        # 현재 V0 체인 전체 — 후속 migration 이 추가되면 이 목록도 늘어난다.
        self.assertEqual(['0', '1', '2', '3', '4', '5', '6'], [item['version'] for item in current])
        self.assertEqual(manifest['v0_checksum'], current[0]['checksum'])

    def test_원본_이력은_고정하고_후속_migration만_허용한다(self):
        with tempfile.TemporaryDirectory() as directory:
            migrations = Path(directory)
            original = migrations / 'V138__original.sql'
            original.write_text('SELECT 1;\n')
            manifest = {'source_version': '138', 'source_history': [
                {'script': original.name, 'checksum': deploy.rebase.checksum(original)}]}
            deploy.validate_legacy_bundle(migrations, manifest)

            later = migrations / 'V139__later.sql'
            later.write_text('SELECT 2;\n')
            deploy.validate_legacy_bundle(migrations, manifest)

            unexpected_old = migrations / 'V137__unexpected.sql'
            unexpected_old.write_text('SELECT 3;\n')
            with self.assertRaisesRegex(ValueError, '원본 migration 묶음'):
                deploy.validate_legacy_bundle(migrations, manifest)
            unexpected_old.unlink()

            original.write_text('SELECT 4;\n')
            with self.assertRaisesRegex(ValueError, '체크섬 불일치'):
                deploy.validate_legacy_bundle(migrations, manifest)
            original.unlink()
            with self.assertRaisesRegex(ValueError, '원본 migration 묶음'):
                deploy.validate_legacy_bundle(migrations, manifest)

    def test_현재체인의_V1_BASELINE과_실패이력은_허용하지_않는다(self):
        manifest = deploy.rebase.load_manifest()
        current = deploy.bundled_history(manifest) + [{'version': '1', 'type': 'SQL', 'script': 'V1__next.sql',
                                                     'checksum': 123, 'success': True}]
        for changed in [{'type': 'BASELINE', 'script': '<< baseline >>', 'checksum': None}, {'success': False}]:
            database = Mock()
            database.pg = {'PGDATABASE': 'data', 'PGUSER': 'api'}
            database.data.side_effect = [{'database': 'data', 'user': 'api', 'server_version': '160014',
                                         'other_connections': 0}, [current[0], {**current[1], **changed}]]
            database.sql.side_effect = ['', 't']
            with self.subTest(changed=changed), self.assertRaisesRegex(ValueError, '현재 V0 체인'):
                deploy.inspect_database(database, manifest, current)

    def test_실행중인_이전_컨테이너가_있으면_기록을_덮어쓰지_않는다(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            target = {'PGHOST': 'db', 'PGPORT': '5432', 'PGDATABASE': 'data'}
            journal = deploy.Journal(path, target, 'sha256:' + 'a' * 64, 'dev')
            name = 'catus-db-' + '1' * 32
            journal.save(active_containers=[name])
            journal.lock.close()
            original = path.read_bytes()
            item = {'Config': {'Labels': {'catus.db.journal': journal.key}}, 'State': {'Running': True}}
            with patch.object(deploy, 'host', return_value=Mock(returncode=0, stdout=json.dumps([item]))):
                with self.assertRaisesRegex(ValueError, '실행 중'):
                    deploy.Journal(path, target, 'sha256:' + 'b' * 64, 'dev')
            self.assertEqual(original, path.read_bytes())


if __name__ == '__main__':
    unittest.main()
