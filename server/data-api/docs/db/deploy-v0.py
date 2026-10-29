#!/usr/bin/env python3
"""고정 Data 이미지와 함께 배포하는 DB 준비 실행기. stdout은 JSON 한 개다."""
import argparse
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import parse_qs, unquote, urlsplit
import uuid

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('rebase_v0', HERE / 'rebase-v0.py')
rebase = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rebase)
IMAGE = re.compile(r'(?:[A-Za-z0-9][A-Za-z0-9./:_-]*@)?sha256:[0-9a-f]{64}')
CONTAINER = re.compile(r'catus-db-[0-9a-f]{32}')
SECRET_KEYS = ('API_DB_URL', 'API_DB_USERNAME', 'API_DB_PASSWORD')


def read_dotenv(path):
    """Compose가 쓰는 literal single quote·실제 줄바꿈을 쉘 실행 없이 읽는다."""
    source = path.read_text()
    result, cursor = {}, 0
    while cursor < len(source):
        match = re.match(r'[ \t]*(?:\#[^\n]*)?(?:\n|$)', source[cursor:])
        if match and match.end():
            cursor += match.end()
            continue
        match = re.match(r'([A-Za-z_][A-Za-z_0-9]*)=', source[cursor:])
        if not match:
            raise ValueError('Data dotenv 형식 오류')
        key = match[1]
        cursor += match.end()
        if key in result:
            raise ValueError('Data dotenv 중복 키: ' + key)
        if cursor < len(source) and source[cursor] == "'":
            cursor += 1
            chars = []
            while cursor < len(source):
                if source[cursor:cursor + 2] == "\\'":
                    chars.append("'")
                    cursor += 2
                elif source[cursor] == "'":
                    cursor += 1
                    break
                else:
                    chars.append(source[cursor])
                    cursor += 1
            else:
                raise ValueError('Data dotenv 따옴표 오류')
            value = ''.join(chars)
        elif cursor < len(source) and source[cursor] == '"':
            value, length = json.JSONDecoder().raw_decode(source[cursor:])
            cursor += length
        else:
            end = source.find('\n', cursor)
            end = len(source) if end < 0 else end
            value, cursor = source[cursor:end].strip(), end
        end = source.find('\n', cursor)
        end = len(source) if end < 0 else end
        if source[cursor:end].strip() and not source[cursor:end].lstrip().startswith('#'):
            raise ValueError('Data dotenv 값 뒤 형식 오류')
        cursor = end + 1
        if '\0' in value:
            raise ValueError('Data dotenv NUL 문자 거부')
        result[key] = value
    for key in SECRET_KEYS:
        if not result.get(key):
            raise ValueError('Data DB 환경변수 누락: ' + key)
    return {key: result[key] for key in SECRET_KEYS}


def connection_environment(values):
    url = values['API_DB_URL']
    if not url.startswith('jdbc:postgresql://'):
        raise ValueError('API_DB_URL은 단일 PostgreSQL JDBC URL이어야 합니다')
    parsed = urlsplit(url[5:])
    database = unquote(parsed.path.removeprefix('/'))
    if (not parsed.hostname or ',' in parsed.netloc or parsed.username or parsed.password or parsed.fragment
            or not re.fullmatch(r'[A-Za-z0-9_.-]+', database)
            or not re.fullmatch(r'[A-Za-z0-9_.-]+', values['API_DB_USERNAME'])):
        raise ValueError('DB 연결 대상 형식 오류')
    parameters = parse_qs(parsed.query, keep_blank_values=True)
    harmless = {'ApplicationName', 'socketTimeout', 'tcpKeepAlive', 'prepareThreshold',
                'stringtype', 'reWriteBatchedInserts'}
    if set(parameters) - harmless - {'sslmode', 'ssl', 'currentSchema', 'connectTimeout'}:
        raise ValueError('지원하지 않는 JDBC 연결 옵션')
    if any(len(value) != 1 for value in parameters.values()):
        raise ValueError('중복 JDBC 연결 옵션')
    if parameters.get('currentSchema', ['public']) != ['public']:
        raise ValueError('DB 전환은 public 스키마만 지원합니다')
    port = parsed.port if parsed.port is not None else 5432
    if not 1 <= port <= 65535 or parameters.get('ssl', ['false'])[0] not in ('true', 'false'):
        raise ValueError('DB 포트 또는 ssl 연결 옵션 오류')
    env = {'PGHOST': parsed.hostname, 'PGPORT': str(port), 'PGDATABASE': database,
           'PGUSER': values['API_DB_USERNAME'], 'PGPASSWORD': values['API_DB_PASSWORD'],
           'PGCONNECT_TIMEOUT': parameters.get('connectTimeout', ['10'])[0]}
    if not env['PGCONNECT_TIMEOUT'].isdigit() or int(env['PGCONNECT_TIMEOUT']) < 1:
        raise ValueError('connectTimeout은 양의 초여야 합니다')
    if 'sslmode' in parameters:
        env['PGSSLMODE'] = parameters['sslmode'][0]
    elif parameters.get('ssl', ['false'])[0] == 'true':
        # JDBC ssl=true는 인증서/호스트 검증을 켠다. libpq에서도 그 조건을 유지한다.
        env['PGSSLMODE'] = 'verify-full'
    if env.get('PGSSLMODE', 'prefer') not in {'disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'}:
        raise ValueError('지원하지 않는 sslmode')
    return env


def version(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d+(?:\.\d+)*', value):
        raise ValueError('지원하지 않는 Flyway 이력 버전')
    return tuple(int(part) for part in value.split('.'))


def validate_legacy_bundle(directory, manifest):
    """전환 기준 V138까지는 고정하고, 그 뒤에 추가된 migration만 허용한다."""
    expected_files = {item['script'] for item in manifest['source_history']}
    actual_files = {path.name for path in directory.glob('V*.sql')}
    added = actual_files - expected_files
    if rebase.EXTENSION_SCRIPT in added:
        rebase.extension_entry(directory)
        added.remove(rebase.EXTENSION_SCRIPT)
    if not expected_files <= actual_files or any(
            (match := re.fullmatch(r'V(\d+(?:[._]\d+)*)__.+\.sql', name)) is None
            or version(match[1].replace('_', '.')) <= version(manifest['source_version'])
            for name in added):
        raise ValueError('원본 migration 묶음과 manifest가 다릅니다')
    for item in manifest['source_history']:
        if rebase.checksum(directory / item['script']) != item['checksum']:
            raise ValueError('원본 migration 파일 체크섬 불일치: ' + item['script'])


def bundled_history(manifest):
    directory = rebase.BASELINE.parent.parent / 'migration'
    validate_legacy_bundle(directory, manifest)
    current = []
    for path in rebase.BASELINE.parent.glob('V*.sql'):
        match = re.fullmatch(r'V(\d+(?:[._]\d+)*)__.+\.sql', path.name)
        if not match:
            raise ValueError('현재 migration 파일명 오류')
        current.append({'version': match[1].replace('_', '.'), 'script': path.name, 'type': 'SQL',
                        'checksum': rebase.checksum(path), 'success': True})
    current.sort(key=lambda item: version(item['version']))
    if not current or current[0]['version'] != '0' or len({item['version'] for item in current}) != len(current):
        raise ValueError('현재 migration은 중복 없는 V0 체인이어야 합니다')
    return current


def host(command, *, check=True, timeout=60, env=None):
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, env=env)
    if check and result.returncode:
        raise RuntimeError('컨테이너 실행 도구 실패: ' + result.stderr.strip())
    return result


class Journal:
    def __init__(self, path, target, image, environment):
        self.path = path.resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = self.path.with_suffix(self.path.suffix + '.lock').open('a+')
        os.chmod(self.lock.name, 0o600)
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            self.lock.close()
            raise ValueError('같은 DB 전환 기록을 사용하는 실행이 진행 중입니다') from error
        try:
            self.start(target, image, environment)
        except BaseException:
            self.lock.close()
            raise

    def start(self, target, image, environment):
        previous = json.loads(self.path.read_text()) if self.path.exists() else {}
        if previous and (previous.get('target') != target or previous.get('environment') != environment):
            raise ValueError('기존 DB 전환 기록의 대상이 다릅니다')
        self.key = hashlib.sha256(str(self.path).encode()).hexdigest()
        # SIGKILL/호스트 중단으로 남은 작업은 실행 중이면 재진입하지 않는다.
        for name in previous.get('active_containers', []):
            if not CONTAINER.fullmatch(name):
                raise ValueError('기존 실행 컨테이너 이름 오류')
            inspected = host(['docker', 'container', 'inspect', name], check=False)
            if inspected.returncode:
                if 'No such' not in inspected.stderr:
                    raise RuntimeError('이전 컨테이너 상태를 확인할 수 없습니다')
                continue
            item = json.loads(inspected.stdout)[0]
            if item['Config'].get('Labels', {}).get('catus.db.journal') != self.key:
                raise ValueError('이전 컨테이너 소유 기록 불일치')
            if item['State']['Running']:
                raise ValueError('이전 DB 일회성 컨테이너가 실행 중입니다: ' + name)
            host(['docker', 'rm', name])
        self.data = {'attempt_id': uuid.uuid4().hex, 'target': target, 'environment': environment,
                     'data_image': image, 'phase': 'starting', 'status': 'running',
                     'backup_paths': previous.get('backup_paths', []), 'active_containers': [],
                     'resume_previous_allowed': False}
        self.save()

    def save(self, **updates):
        self.data.update(updates)
        self.data['updated_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        descriptor, temporary = tempfile.mkstemp(prefix=self.path.name + '.', dir=self.path.parent)
        try:
            with os.fdopen(descriptor, 'w') as stream:
                os.fchmod(stream.fileno(), 0o600)
                json.dump(self.data, stream, ensure_ascii=False, indent=2)
                stream.write('\n')
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            directory = os.open(self.path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


class Containers:
    def __init__(self, network, journal):
        self.network, self.journal = network, journal

    def prepare(self, image):
        if host(['docker', 'image', 'inspect', image], check=False).returncode:
            print('DB 실행 이미지 준비: ' + image, file=sys.stderr, flush=True)
            host(['docker', 'pull', image], timeout=600)

    def run(self, image, arguments, environment, *, content=None, input_file=None, output_file=None, timeout=900):
        name = 'catus-db-' + uuid.uuid4().hex
        self.journal.data['active_containers'].append(name)
        self.journal.save()
        command = ['docker', 'create', '--interactive', '--name', name, '--network', self.network,
                   '--label', 'catus.db.journal=' + self.journal.key]
        for key in sorted(environment):
            command += ['--env', key]
        command += ['--entrypoint', arguments[0], image, *arguments[1:]]
        env = {**os.environ, **environment}
        try:
            host(command, env=env)
            result = subprocess.run(['docker', 'start', '--attach', '--interactive', name],
                                    input=content.encode() if content is not None else None, stdin=input_file,
                                    stdout=output_file or subprocess.PIPE, stderr=subprocess.PIPE,
                                    timeout=timeout, env=env)
            state = json.loads(host(['docker', 'inspect', '--format', '{{json .State}}', name]).stdout)
            if result.returncode or state['Running'] or state['ExitCode']:
                message = result.stderr.decode(errors='replace').strip()
                for key in ('PGPASSWORD', 'API_DB_PASSWORD'):
                    if environment.get(key):
                        message = message.replace(environment[key], '[redacted]')
                raise RuntimeError('DB 일회성 실행 실패: ' + message)
            return result.stdout.decode() if output_file is None else ''
        except subprocess.TimeoutExpired as error:
            raise RuntimeError('DB 일회성 실행 시간 초과; 컨테이너 종료를 시도했습니다') from error
        finally:
            removed = host(['docker', 'rm', '--force', name], check=False, timeout=30)
            if removed.returncode == 0 or 'No such' in removed.stderr:
                self.journal.data['active_containers'].remove(name)
                self.journal.save()
            else:
                self.journal.save(cleanup_failed=True)
                raise RuntimeError('DB 컨테이너 정리 실패; 재실행 전에 상태를 확인해야 합니다: ' + name)


class Database(rebase.Database):
    def __init__(self, environment, containers):
        super().__init__('docker', environment, containers.network)
        self.containers = containers
        self.pg = {key: value for key, value in self.env.items() if key.startswith('PG')}
        self.pg['PGOPTIONS'] += ' -c statement_timeout=900000'

    def sql(self, statement):
        return self.containers.run(rebase.CLIENT_IMAGE, ['psql', '-X', '-qAt', '--no-password', '-v', 'ON_ERROR_STOP=1'],
                                   self.pg, content='SET search_path=public,pg_catalog;\n' + statement).strip()

    def backup(self, path):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with path.open('xb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            self.containers.run(rebase.CLIENT_IMAGE, ['pg_dump', '--format=custom', '--no-password'],
                                self.pg, output_file=stream, timeout=1800)
            stream.flush()
            os.fsync(stream.fileno())
        with path.open('rb') as stream:
            listing = self.containers.run(rebase.CLIENT_IMAGE, ['pg_restore', '--list'], {}, input_file=stream)
        if path.stat().st_size == 0 or 'flyway_schema_history' not in listing:
            raise RuntimeError('전체 백업 목록 검증 실패')


def inspect_database(database, manifest, current):
    info = database.data("SELECT json_build_object('database',current_database(),'user',current_user,"
                         "'server_version',current_setting('server_version_num'),'other_connections',"
                         "(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() "
                         "AND pid<>pg_backend_pid() AND backend_type IS DISTINCT FROM 'autovacuum worker'));" )
    if (info['database'] != database.pg['PGDATABASE'] or info['user'] != database.pg['PGUSER']
            or int(info['server_version']) // 10000 != 16):
        raise ValueError('DB 대상·계정·PostgreSQL 16 조건 불일치')
    database.sql(rebase.public_schema_guard())
    exists = database.sql("SELECT to_regclass('public.flyway_schema_history') IS NOT NULL;") == 't'
    history = database.data("SELECT coalesce(json_agg(row_to_json(h)), '[]'::json) FROM "
                            "(SELECT version,type,script,checksum,success FROM flyway_schema_history) h;") if exists else []
    history.sort(key=lambda item: version(item['version']))
    if not history:
        # history 생성 직후 실패한 빈 DB도 재시도할 수 있지만 임의 사용자 객체는 허용하지 않는다.
        objects = int(database.sql("""SELECT count(*) FROM pg_depend d JOIN pg_namespace n
            ON d.refclassid='pg_namespace'::regclass AND d.refobjid=n.oid
            WHERE n.nspname='public'
              AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid=d.classid AND e.objid=d.objid
                  AND e.deptype='e' AND e.refclassid='pg_extension'::regclass)
              AND NOT (d.classid='pg_class'::regclass AND d.objid IN
                  (SELECT oid FROM pg_class WHERE oid=to_regclass('public.flyway_schema_history')
                   UNION SELECT indexrelid FROM pg_index
                   WHERE indrelid=to_regclass('public.flyway_schema_history')))
              AND NOT (d.classid='pg_type'::regclass AND d.objid IN
                  (SELECT t.oid FROM pg_type t JOIN pg_class c ON t.oid=c.reltype OR t.typelem=c.reltype
                   WHERE c.oid=to_regclass('public.flyway_schema_history')))
              AND NOT (d.classid='pg_constraint'::regclass AND d.objid IN
                  (SELECT oid FROM pg_constraint WHERE conrelid=to_regclass('public.flyway_schema_history')));"""))
        if objects:
            raise ValueError('Flyway 이력이 없는 비어 있지 않은 DB는 자동 초기화하지 않습니다')
        return {**info, 'state': 'empty', 'source_version': None, 'needs_backup': False}
    if history[0]['version'] == '0':
        if len(history) > len(current):
            raise ValueError('현재 이미지보다 새로운 V0 체인입니다')
        if history != current[:len(history)]:
            raise ValueError('현재 V0 체인 이력·체크섬이 이미지와 다릅니다')
        # V0 구조는 확정 지문으로 확인한다. 후속 V1+는 불변 migration 이력과 앱 validate가 검증한다.
        if len(history) == 1 and database.fingerprint() not in manifest['target_schemas']:
            raise ValueError('V0 구조 지문이 다릅니다')
        return {**info, 'state': 'current', 'source_version': history[-1]['version'],
                'needs_backup': len(history) < len(current)}
    manifest = rebase.profile_for_history(manifest, history)
    expected = manifest['source_history']
    if len(history) > len(expected):
        raise ValueError('지원하는 원본 V138보다 새로운 이력입니다')
    rebase.assert_history(history, expected[:len(history)])
    # V138은 데이터 정리만 수행하므로 승인된 V137.1도 같은 구조 지문이어야 한다.
    if len(history) == len(expected) or (manifest.get('profile') == 'backoffice-137.1'
                                         and history[-1]['version'] == '137.1'):
        if database.fingerprint() not in manifest['source_schemas']:
            raise ValueError('V138 구조 지문이 다릅니다')
        rebase.check_bot_references(database, manifest)
    return {**info, 'state': 'legacy', 'source_version': history[-1]['version'], 'needs_backup': True,
            'profile': manifest.get('profile', 'original')}


def execute(args, journal, values, connection):
    manifest = rebase.load_manifest()
    current = bundled_history(manifest)
    containers = Containers(args.network, journal)
    host(['docker', 'network', 'inspect', args.network])
    containers.prepare(rebase.CLIENT_IMAGE)
    containers.prepare(args.data_image)
    database = Database(connection, containers)
    journal.save(phase='inspecting')
    before = inspect_database(database, manifest, current)
    journal.save(source_state=before['state'], source_version=before['source_version'])
    if args.phase == 'preflight':
        journal.save(phase='preflight', status='succeeded')
        return {**before, 'phase': 'preflight', 'data_image': args.data_image}
    if not args.writers_stopped:
        raise ValueError('apply에는 --writers-stopped가 필요합니다')
    if before['other_connections']:
        raise ValueError('Data DB의 모든 연결(모니터 포함)을 먼저 중지해야 합니다')

    def backup(label):
        path = args.backup_dir.resolve() / (journal.data['attempt_id'] + '-' + label + '.dump')
        journal.save(phase='backup-' + label, pending_backup=str(path))
        database.backup(path)
        journal.data['backup_paths'].append(str(path))
        journal.save(pending_backup=None)

    def migrate(mode):
        journal.save(phase='migrate-' + mode)
        containers.run(args.data_image,
                       ['java', '-Dloader.main=com.oneorthree.phone.common.db.DeploymentMigrationMain',
                        '-cp', '/app/app.jar', 'org.springframework.boot.loader.launch.PropertiesLauncher', mode],
                       values, timeout=1800)

    if before['needs_backup']:
        backup('before-change')
    if before['state'] == 'legacy':
        if before['source_version'] != manifest['source_version']:
            migrate('legacy')
        ready = inspect_database(database, manifest, current)
        if ready['state'] != 'legacy' or ready['source_version'] != manifest['source_version']:
            raise ValueError('V138 준비 후 검증 실패')
        if ready['other_connections']:
            raise ValueError('V138 준비 후 다른 DB 연결이 있습니다')
        journal.save(phase='rebase-v0')
        selected = rebase.extension_profile(manifest) if ready.get('profile') == 'backoffice-137.1' else manifest
        database.sql(rebase.apply_sql(selected, manifest['v0_checksum']))
        journal.save(phase='v0-committed')
    migrate('current')
    after = inspect_database(database, manifest, current)
    if after['state'] != 'current' or after['needs_backup']:
        raise ValueError('현재 migration 완료 후 검증 실패')
    journal.save(phase='complete', status='succeeded', schema_version=after['source_version'])
    return {'state': 'current', 'phase': 'complete', 'database': after['database'],
            'source_state': before['state'], 'schema_version': after['source_version'],
            'backup_paths': journal.data['backup_paths']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=('preflight', 'apply'), required=True)
    parser.add_argument('--environment', choices=('dev', 'prod'), required=True)
    parser.add_argument('--data-image', required=True)
    parser.add_argument('--network', required=True)
    parser.add_argument('--env-file', type=Path, required=True)
    parser.add_argument('--backup-dir', type=Path, required=True)
    parser.add_argument('--state-file', type=Path, required=True)
    parser.add_argument('--writers-stopped', action='store_true')
    args = parser.parse_args()
    journal = None
    values = {}
    try:
        if not IMAGE.fullmatch(args.data_image):
            raise ValueError('Data 이미지는 sha256 digest로 고정해야 합니다')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', args.network):
            raise ValueError('Compose network 이름 오류')
        if not args.backup_dir.is_absolute() or not args.state_file.is_absolute():
            raise ValueError('백업·기록 경로는 영속 호스트의 절대 경로여야 합니다')
        values = read_dotenv(args.env_file)
        connection = connection_environment(values)
        target = {key: connection[key] for key in ('PGHOST', 'PGPORT', 'PGDATABASE')}
        journal = Journal(args.state_file, target, args.data_image, args.environment)
        result = execute(args, journal, values, connection)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        message = str(error)
        if values.get('API_DB_PASSWORD'):
            message = message.replace(values['API_DB_PASSWORD'], '[redacted]')
        if journal:
            journal.save(status='failed', error=message)
        print('DB 준비 중단: ' + message, file=sys.stderr)
        print(json.dumps({'state': 'blocked', 'phase': journal.data['phase'] if journal else 'starting',
                          'resume_previous_allowed': False, 'error': message}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main())
