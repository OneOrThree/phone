#!/usr/bin/env python3
"""실제 Data 이미지의 추출·Flyway 전용 진입점·전환·재시도를 일회성 PostgreSQL에서 검증한다.

사용: python3 docs/db/test-deploy-v0-integration.py --data-image <sha256 digest>
기존 DB에는 접속하지 않으며, 자체 생성 컨테이너와 network만 finally에서 제거한다.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('deploy_v0', HERE / 'deploy-v0.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def command(arguments, *, content=None):
    result = subprocess.run(arguments, input=content, capture_output=True, text=True, check=True)
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-image', required=True)
    parser.add_argument('--artifacts-dir', type=Path)
    args = parser.parse_args()
    if not deploy.IMAGE.fullmatch(args.data_image):
        raise ValueError('검증 이미지도 sha256 digest로 고정해야 합니다')
    directory = args.artifacts_dir or Path(tempfile.mkdtemp(prefix='catus-db-integration-'))
    directory.mkdir(parents=True, exist_ok=True)
    network = 'catus-db-test-' + uuid.uuid4().hex[:12]
    postgres = network + '-postgres'
    package = network + '-package'
    results = {}
    os.environ['POSTGRES_PASSWORD'] = 'local-integration-only'
    command(['docker', 'network', 'create', network])
    try:
        command(['docker', 'run', '-d', '--name', postgres, '--network', network, '--network-alias', 'db',
                 '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_USER=audit', deploy.rebase.CLIENT_IMAGE])
        command(['docker', 'exec', postgres, 'sh', '-c',
                 'until pg_isready -h 127.0.0.1 -U audit >/dev/null; do sleep 0.1; done'])
        command(['docker', 'create', '--name', package, args.data_image])
        bundle = directory / 'package'
        bundle.mkdir()
        command(['docker', 'cp', package + ':/opt/catus-db/.', str(bundle)])
        command(['docker', 'rm', package])

        def sql(database, statement):
            return command(['docker', 'exec', '-i', postgres, 'psql', '-XqAt', '-U', 'audit', '-d', database,
                            '-v', 'ON_ERROR_STOP=1'], content=statement)

        def create(database):
            command(['docker', 'exec', postgres, 'createdb', '-U', 'audit', database])

        def run(database, phase='apply', expected=0):
            env = directory / (database + '.env')
            env.write_text("API_DB_URL='jdbc:postgresql://db:5432/" + database
                           + "'\nAPI_DB_USERNAME='audit'\nAPI_DB_PASSWORD='local-integration-only'\n")
            env.chmod(0o600)
            arguments = [sys.executable, str(bundle / 'docs/db/deploy-v0.py'), '--phase', phase,
                         '--environment', 'dev', '--data-image', args.data_image, '--network', network,
                         '--env-file', str(env), '--backup-dir', str(directory / 'backups'),
                         '--state-file', str(directory / (database + '-state.json'))]
            if phase == 'apply':
                arguments += ['--writers-stopped']
            result = subprocess.run(arguments, capture_output=True, text=True, timeout=1800)
            payload = json.loads(result.stdout)
            assert result.returncode == expected, (database, payload, result.stderr)
            with (directory / 'results.jsonl').open('a') as stream:
                stream.write(json.dumps({'database': database, 'phase': phase, 'result': payload}) + '\n')
            return payload

        create('fresh')
        assert run('fresh', 'preflight')['state'] == 'empty'
        assert run('fresh')['schema_version'] == '0'
        sql('fresh', "DELETE FROM audio_tracks; UPDATE construction_cost_policies SET cost=999 "
                     "WHERE revision=1 AND building_id='hall';")
        assert run('fresh')['source_state'] == 'current'
        assert sql('fresh', 'SELECT count(*) FROM audio_tracks') == '3'
        assert sql('fresh', "SELECT cost FROM construction_cost_policies WHERE revision=1 AND building_id='hall'") == '999'
        assert sql('fresh', "SELECT string_agg(version, ',') FROM flyway_schema_history") == '0'
        results['empty_current_repeat_seed_restore'] = True

        # Flyway가 실제 생성한 history와 두 인덱스를 재사용한다. 사용자 객체는 포함하지 않는다.
        history_ddl = command(['docker', 'exec', postgres, 'pg_dump', '-U', 'audit', '-d', 'fresh',
                               '--schema-only', '--no-owner', '--no-privileges', '-t', 'flyway_schema_history'])
        create('empty_history')
        sql('empty_history', history_ddl)
        assert sql('empty_history', "SELECT count(*) FROM pg_indexes WHERE tablename='flyway_schema_history'") == '2'
        assert run('empty_history', 'preflight')['state'] == 'empty'
        assert run('empty_history')['schema_version'] == '0'
        results['empty_history_indexes_retry'] = True

        create('legacy117')
        sql('legacy117', history_ddl)
        manifest = deploy.rebase.load_manifest()
        archive = bundle / 'src/main/resources/db/migration'
        statements = []
        for rank, entry in enumerate(manifest['source_history'], 1):
            if deploy.version(entry['version']) > (117,):
                break
            statements.append('SET search_path=public,pg_catalog;\n' + (archive / entry['script']).read_text())
            description = entry['script'].split('__', 1)[1].removesuffix('.sql').replace('_', ' ')
            statements.append("INSERT INTO public.flyway_schema_history(installed_rank,version,description,type,"
                              "script,checksum,installed_by,execution_time,success) VALUES ("
                              + str(rank) + ',' + deploy.rebase.quote(entry['version']) + ','
                              + deploy.rebase.quote(description) + ", 'SQL', "
                              + deploy.rebase.quote(entry['script']) + ',' + str(entry['checksum'])
                              + ", current_user, 0, true);")
        sql('legacy117', '\n'.join(statements))
        sql('legacy117', "INSERT INTO users(id,is_guest,nickname,language) "
                         "VALUES ('01900000-0000-7000-8000-000000000001',true,'kept-user','ko')")
        assert run('legacy117', 'preflight')['source_version'] == '117'
        migrated = run('legacy117')
        assert migrated['source_state'] == 'legacy' and migrated['schema_version'] == '0'
        assert len(migrated['backup_paths']) == 1
        backup = Path(migrated['backup_paths'][0])
        assert backup.stat().st_size > 0 and backup.stat().st_mode & 0o777 == 0o600
        assert sql('legacy117', "SELECT to_regclass('public.groups') IS NULL AND "
                               "to_regclass('public.islands') IS NOT NULL") == 't'
        assert sql('legacy117', 'SELECT count(*) FROM customization_reward_items') == '110'
        assert sql('legacy117', "SELECT nickname || ':' || language FROM users "
                               "WHERE id='01900000-0000-7000-8000-000000000001'") == 'kept-user:ko'
        create('restored_backup')
        with backup.open('rb') as stream:
            subprocess.run(['docker', 'exec', '-i', postgres, 'pg_restore', '-U', 'audit', '-d', 'restored_backup'],
                           stdin=stream, capture_output=True, check=True)
        assert sql('restored_backup', "SELECT version FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1") == '117'
        results['legacy117_catchup138_rebase0_full_backup_restore'] = True

        reader = subprocess.Popen(['docker', 'exec', '--env', 'PGAPPNAME=deployment-connection-fixture', postgres,
                                   'psql', '-U', 'audit', '-d', 'legacy117', '-c', 'SELECT pg_sleep(30)'],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            command(['docker', 'exec', postgres, 'sh', '-c',
                     "until psql -U audit -d legacy117 -Atc \"SELECT 1 FROM pg_stat_activity WHERE "
                     "application_name='deployment-connection-fixture'\" | grep -q 1; do sleep 0.1; done"])
            rejected = run('legacy117', expected=1)
            assert '모든 연결' in rejected['error']
            assert sql('legacy117', "SELECT string_agg(version, ',') FROM flyway_schema_history") == '0'
        finally:
            sql('legacy117', "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                            "WHERE application_name='deployment-connection-fixture'")
            reader.wait(timeout=10)
        results['active_connection_refusal'] = True

        # callback 충돌은 해당 TX 전체를 rollback하며 재시도 전에도 현재 이력은 그대로다.
        sql('fresh', "DELETE FROM audio_tracks; UPDATE catalog_assets SET title='collision' WHERE product_id='campfire'")
        assert run('fresh', expected=1)['resume_previous_allowed'] is False
        assert sql('fresh', 'SELECT count(*) FROM audio_tracks') == '0'
        assert sql('fresh', "SELECT string_agg(version, ',') FROM flyway_schema_history") == '0'
        state = json.loads((directory / 'fresh-state.json').read_text())
        assert state['status'] == 'failed' and state['active_containers'] == []
        results['seed_conflict_fail_closed_rollback'] = True

        create('unknown')
        sql('unknown', 'CREATE TABLE user_business(id integer)')
        assert run('unknown', 'preflight', expected=1)['state'] == 'blocked'
        assert sql('unknown', "SELECT to_regclass('public.user_business') IS NOT NULL") == 't'
        results['unknown_schema_readonly_refusal'] = True

        target = {'PGHOST': 'db', 'PGPORT': '5432', 'PGDATABASE': 'fresh'}
        journal = deploy.Journal(directory / 'timeout-state.json', target, args.data_image, 'dev')
        containers = deploy.Containers(network, journal)
        try:
            containers.run(deploy.rebase.CLIENT_IMAGE, ['/bin/sleep', '30'], {}, timeout=0.1)
            raise AssertionError('timeout expected')
        except RuntimeError as error:
            assert '시간 초과' in str(error), str(error)
        assert journal.data['active_containers'] == []
        journal.lock.close()
        results['timeout_container_cleanup'] = True
        name = 'catus-db-' + uuid.uuid4().hex
        command(['docker', 'run', '-d', '--name', name, '--network', network,
                 '--label', 'catus.db.journal=' + journal.key, '--entrypoint', '/bin/sleep',
                 deploy.rebase.CLIENT_IMAGE, '30'])
        journal.save(active_containers=[name])
        try:
            try:
                deploy.Journal(directory / 'timeout-state.json', target, args.data_image, 'dev')
                raise AssertionError('running prior container must block retry')
            except ValueError as error:
                assert '실행 중' in str(error), str(error)
        finally:
            command(['docker', 'rm', '-f', name])
        recovered = deploy.Journal(directory / 'timeout-state.json', target, args.data_image, 'dev')
        assert recovered.data['active_containers'] == []
        recovered.lock.close()
        results['interrupted_container_retry_guard'] = True
        (directory / 'summary.json').write_text(json.dumps(results, indent=2) + '\n')
        print(json.dumps({'artifacts': str(directory), 'passed': results}, ensure_ascii=False))
    finally:
        subprocess.run(['docker', 'rm', '-f', package, postgres], capture_output=True)
        subprocess.run(['docker', 'network', 'rm', network], capture_output=True)


if __name__ == '__main__':
    main()
