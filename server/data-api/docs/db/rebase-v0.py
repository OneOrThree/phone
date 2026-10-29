#!/usr/bin/env python3
"""Gromo V138 → Catus V0: 현재 데이터를 보존하며 승인된 레거시 객체만 정리한다.

기본은 읽기 전용 계획이다. --apply는 모든 DB writer를 중지한 뒤 명시적 대상 확인과
전체 백업을 거쳐 실행한다. 원격 셸·컨테이너 재시작·Secret 조회는 수행하지 않는다.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zlib

HERE = Path(__file__).resolve().parent
ASSETS = HERE / 'v0-rebase'
BASELINE = HERE.parent.parent / 'src/main/resources/db/v0/V0__baseline.sql'
DEFAULTS = HERE.parent.parent / 'src/main/resources/db/seed/insert.sql'
CLIENT_IMAGE = 'postgres:16.14-alpine'
CLEANUP = {'users': 'id', 'focus_sessions': 'user_id', 'daily_focus_stats': 'user_id',
           'user_notification_settings': 'user_id'}
LINK_EVENT_TYPES_SQL = ("'link.revoked', 'link.joined', 'link.claimConfirmed', "
                       "'group.closed', 'group.renamed', 'user.displayNameChanged'")
UUID_PATTERN = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'



EXTENSION_SCRIPT = 'V137_1__backoffice_publications.sql'
EXTENSION_SHA256 = 'acaea4884a14d0c25ed5039116b4034615c3c7e7327d0622bd267629bfe0e92a'
EXTENSION_TABLES = ['content_publications', 'developer_notices', 'magazine_review_snapshots',
                    'focus_reward_policy_approvals', 'focus_reward_policy_publications']


def extension_entry(directory=None):
    path = (directory or BASELINE.parent.parent / 'migration') / EXTENSION_SCRIPT
    if hashlib.sha256(path.read_bytes()).hexdigest() != EXTENSION_SHA256:
        raise ValueError('승인된 백오피스 V137.1 SQL과 다릅니다')
    return {'version': '137.1', 'type': 'SQL', 'script': EXTENSION_SCRIPT,
            'checksum': checksum(path), 'success': True}


def extension_profile(manifest):
    profile = json.loads((ASSETS / 'backoffice-profile.json').read_text())
    if profile['extension_sha256'] != EXTENSION_SHA256:
        raise ValueError('백오피스 확장 profile SHA 불일치')
    entry = extension_entry()
    if entry != profile['extension_history']:
        raise ValueError('백오피스 확장 migration 이력 불일치')
    for item in profile['bridge_history']:
        path = BASELINE.parent / item['script']
        if checksum(path) != item['checksum'] or hashlib.sha256(path.read_bytes()).hexdigest() != profile['canonical_sha256'][item['script']]:
            raise ValueError('백오피스 bridge의 canonical migration 불일치: ' + item['script'])
    if [item['version'] for item in profile['bridge_history']] != ['1', '2', '3', '4', '5', '6']:
        raise ValueError('백오피스 bridge는 검증된 V1..6만 지원합니다')
    for key in ('source_schemas', 'target_schemas', 'final_schemas'):
        if not profile.get(key) or any(not re.fullmatch('[0-9a-f]{32}', value) for value in profile[key]):
            raise ValueError('백오피스 bridge 구조 지문 누락: ' + key)
    source = sorted([*manifest['source_history'], entry], key=lambda item: tuple(map(int, item['version'].split('.'))))
    return {**manifest, **profile, 'source_history': source,
            'source_tables': sorted(manifest['source_tables'] + EXTENSION_TABLES),
            'profile': 'backoffice-137.1'}


def profile_for_history(manifest, history):
    return extension_profile(manifest) if any(item['version'] == '137.1' for item in history) else manifest


def bridge_sql(manifest):
    if manifest.get('profile') != 'backoffice-137.1':
        return ''
    # V4..6의 효과는 이미 exact source/target fingerprint로 확인했다.
    # V1..3은 실제 실행하고, V0 교체와 같은 transaction에서 V1..6의 정확한 이력을 기록한다.
    sql = '\n'.join((BASELINE.parent / item['script']).read_text()
                    for item in manifest['bridge_history'] if item['version'] in ('1', '2', '3'))
    for rank, item in enumerate(manifest['bridge_history'], 2):
        description = item['script'].split('__', 1)[1].removesuffix('.sql').replace('_', ' ')
        sql += ("\nINSERT INTO public.flyway_schema_history (installed_rank,version,description,type,script,"
                "checksum,installed_by,execution_time,success) VALUES ("
                + str(rank) + ',' + quote(item['version']) + ',' + quote(description)
                + ",'SQL'," + quote(item['script']) + ',' + str(item['checksum']) + ',current_user,0,true);')
    return sql + "\nDO $bridge$ BEGIN IF " + schema_expression() + ' NOT IN (' + ','.join(
        quote(value) for value in manifest['final_schemas']) + ") THEN RAISE EXCEPTION '백오피스 bridge 결과가 canonical V0..6 구조와 다릅니다'; END IF; END $bridge$;\n"


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def identifier(value):
    if not re.fullmatch('[a-z_][a-z_0-9]*', value):
        raise ValueError('예상하지 못한 SQL 식별자: ' + value)
    return '"' + value + '"'


def checksum(path):
    value = 0
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        value = zlib.crc32(line.encode('utf-8'), value)
    return value if value < 2 ** 31 else value - 2 ** 32


def schema_expression():
    query = (ASSETS / 'schema.sql').read_text()
    query = query[query.index('SELECT jsonb_build_object'):].strip().removesuffix(';')
    return f'md5(({query})::text)'


def public_schema_guard():
    return (ASSETS / 'public-schema.sql').read_text()


class Database:
    def __init__(self, client, connection_env=None, network='host'):
        self.env = dict(os.environ) if connection_env is None else {
            key: value for key, value in os.environ.items() if not key.startswith('PG')}
        if connection_env is not None:
            self.env.update(connection_env)
        self.network = network
        for key in ('PGHOST', 'PGDATABASE', 'PGUSER'):
            if not self.env.get(key):
                raise ValueError(f'{key}를 명시해야 합니다. 기본 DB/로컬 소켓으로 대체하지 않습니다.')
        for key in ('PGDATABASE', 'PGUSER'):
            if not re.fullmatch('[A-Za-z0-9_.-]+', self.env[key]):
                raise ValueError(f'{key}에는 연결 URI가 아닌 단일 이름을 사용하세요.')
        self.env.setdefault('PGPORT', '5432')
        if not self.env['PGPORT'].isdigit() or not 1 <= int(self.env['PGPORT']) <= 65535:
            raise ValueError('PGPORT가 올바른 포트 번호가 아닙니다.')
        self.env.setdefault('PGCONNECT_TIMEOUT', '10')
        self.env['PGAPPNAME'] = 'catus-data-api-rebase-v0'
        self.env['PGOPTIONS'] = '-c search_path=public,pg_catalog'
        native = all(shutil.which(tool) for tool in ('psql', 'pg_dump', 'pg_restore'))
        self.docker = client == 'docker' or (client == 'auto' and not native)
        if client == 'native' and not native:
            raise ValueError('psql·pg_dump·pg_restore가 모두 필요합니다.')
        if self.docker and not shutil.which('docker'):
            raise ValueError('PostgreSQL 16 클라이언트 또는 Docker가 필요합니다.')

    def command(self, tool, args):
        if tool in ('psql', 'pg_dump'):
            # PGSERVICE 등의 기본값보다 명시적 대상이 우선하도록 연결 인자로 고정한다.
            args = ['--host', self.env['PGHOST'], '--port', self.env['PGPORT'],
                    '--dbname', self.env['PGDATABASE'], '--username', self.env['PGUSER'], *args]
        if not self.docker:
            return [tool, *args]
        # 비밀번호 값은 argv에 넣지 않는다. libpq의 PG* 설정은 docker가 환경에서 읽는다.
        command = ['docker', 'run', '--rm', '-i', '--network', self.network]
        for key in sorted(self.env):
            if key.startswith('PG'):
                command += ['--env', key]
        return command + [CLIENT_IMAGE, tool, *args]

    def sql(self, sql):
        result = subprocess.run(self.command('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1']),
                                input='SET search_path=public,pg_catalog;\n' + sql,
                                text=True, capture_output=True, env=self.env)
        if result.returncode:
            raise RuntimeError('DB 검증/전환 실패: ' + result.stderr.strip())
        return result.stdout.strip()

    def data(self, query):
        return json.loads(self.sql(query))

    def fingerprint(self):
        return self.sql('SELECT ' + schema_expression() + ';')

    def backup(self, path):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # 기존 백업은 절대 덮어쓰지 않는다. 실패한 불완전 파일도 복구 판단을 위해 남긴다.
        with path.open('xb') as stream:
            path.chmod(0o600)
            result = subprocess.run(self.command('pg_dump', ['--format=custom', '--no-password']),
                                    stdout=stream, stderr=subprocess.PIPE, env=self.env)
            stream.flush()
            os.fsync(stream.fileno())
        if result.returncode or path.stat().st_size == 0:
            raise RuntimeError('전체 백업 실패; DB를 변경하지 않았습니다: '
                               + result.stderr.decode(errors='replace').strip())
        with path.open('rb') as stream:
            result = subprocess.run(self.command('pg_restore', ['--list']), stdin=stream,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env)
        if result.returncode or b'flyway_schema_history' not in result.stdout:
            raise RuntimeError('백업 목록 검증 실패; DB를 변경하지 않았습니다.')


def assert_history(actual, expected):
    if len(actual) != len(expected):
        raise ValueError('지원하는 V138 이력과 개수가 다릅니다. 누락·추가·실패 이력을 먼저 조사하세요.')
    for live, known in zip(actual, expected):
        if live['version'] != known['version'] or not live['success']:
            raise ValueError('지원하지 않는 migration version 또는 실패 이력이 있습니다.')
        baseline = live['version'] == '1' and live['type'] == 'BASELINE' and live['checksum'] is None
        if not baseline and any(live[key] != known[key] for key in ('type', 'script', 'checksum')):
            raise ValueError('기존 migration 체크섬/스크립트가 다릅니다: V' + live['version'])


def bot_ids_sql(manifest):
    return ', '.join(quote(value) + '::uuid' for value in manifest['bot_ids'])


def orphan_link_event(alias='s'):
    return (f"{alias}.type IN ({LINK_EVENT_TYPES_SQL}) AND NOT EXISTS "
            f"(SELECT 1 FROM public.event_outbox_deliveries d WHERE d.outbox_id={alias}.id AND d.target<>'LINK')")


def retained_rows(table):
    if table == 'event_outbox':
        return 'NOT (' + orphan_link_event() + ')'
    if table == 'event_outbox_deliveries':
        return "s.target<>'LINK'"
    return 'true'


def check_bot_references(database, manifest):
    """계획 단계도 일반 SELECT만으로 현재 데이터 참조와 비표준 봇을 거부한다."""
    unknown = database.sql(f"SELECT count(*) FROM users WHERE "
                           f"(is_bot AND id NOT IN ({bot_ids_sql(manifest)})) OR "
                           f"(id IN ({bot_ids_sql(manifest)}) AND NOT is_bot);")
    if int(unknown):
        raise ValueError('V48 seed와 다른 봇/실사용 계정이 있어 자동 정리를 거부합니다.')
    columns = database.data("SELECT json_agg(row_to_json(c)) FROM (SELECT table_name,column_name,udt_name "
                            "FROM information_schema.columns WHERE table_schema='public' "
                            "AND udt_name IN ('uuid','text','varchar','json','jsonb')) c;")
    checks = []
    for col in columns:
        table, column = col['table_name'], col['column_name']
        if (table in manifest['retired_tables'] or table == 'flyway_schema_history'
                or CLEANUP.get(table) == column or (table, column) == ('focus_sessions', 'id')):
            continue
        relation, field = 'public.' + identifier(table), 's.' + identifier(column)
        retained = retained_rows(table)
        if col['udt_name'] == 'uuid':
            condition = f'EXISTS(SELECT 1 FROM {relation} s WHERE {retained} AND {field} IN (SELECT id FROM retiring_ids))'
        else:
            condition = (f'EXISTS(SELECT 1 FROM {relation} s CROSS JOIN LATERAL '
                         f'regexp_matches(lower({field}::text), {quote(UUID_PATTERN)}, \'g\') matched(tokens) '
                         f'JOIN retiring_ids ids ON ids.id::text=matched.tokens[1] WHERE {retained})')
        checks.append('SELECT ' + quote(table + '.' + column) + ' AS reference WHERE ' + condition)
    query = (f'WITH retiring_bots AS (SELECT id FROM users WHERE id IN ({bot_ids_sql(manifest)})), '
             'retiring_ids AS (SELECT id FROM retiring_bots UNION SELECT id FROM focus_sessions '
             'WHERE user_id IN (SELECT id FROM retiring_bots)) '
             'SELECT coalesce(json_agg(reference), \'[]\'::json) FROM (' + ' UNION ALL '.join(checks) + ') found;')
    references = database.data(query)
    if references:
        raise ValueError('봇의 현행 데이터 참조 발견; 보존을 위해 중단합니다: ' + ', '.join(references))


def preparation(manifest):
    retired = ', '.join(quote(t) for t in manifest['retired_tables'])
    allowed = ' OR '.join(f'(col.table_name={quote(t)} AND col.column_name={quote(c)})'
                          for t, c in CLEANUP.items())
    return f"""
CREATE TEMP TABLE retiring_bots (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO retiring_bots SELECT id FROM public.users WHERE id IN ({bot_ids_sql(manifest)});
DO $guard$
BEGIN
    IF EXISTS (SELECT 1 FROM users WHERE is_bot AND id NOT IN ({bot_ids_sql(manifest)}))
       OR EXISTS (SELECT 1 FROM users WHERE id IN ({bot_ids_sql(manifest)}) AND NOT is_bot) THEN
        RAISE EXCEPTION 'V48 seed와 다른 봇/실사용 계정이 있어 자동 정리를 거부합니다';
    END IF;
END $guard$;
CREATE TEMP TABLE retiring_ids (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO retiring_ids SELECT id FROM retiring_bots;
INSERT INTO retiring_ids SELECT id FROM focus_sessions WHERE user_id IN (SELECT id FROM retiring_bots)
    ON CONFLICT DO NOTHING;
-- FK가 없는 outbox·aggregate·JSON payload까지 확인한다. 현행 2.0 참조가 있으면 삭제하지 않는다.
DO $guard$
DECLARE t record; found boolean; row_filter text;
    pattern text := '([0-9a-f]{{8}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{12}})';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM retiring_ids) THEN RETURN; END IF;
    FOR t IN SELECT table_name, column_name, udt_name FROM information_schema.columns col
        WHERE table_schema='public' AND table_name NOT IN ({retired}, 'flyway_schema_history')
          AND udt_name IN ('uuid', 'text', 'varchar', 'json', 'jsonb')
          AND NOT ({allowed}) AND NOT (table_name='focus_sessions' AND column_name='id')
    LOOP
        row_filter := CASE t.table_name
            WHEN 'event_outbox' THEN {quote(retained_rows('event_outbox'))}
            WHEN 'event_outbox_deliveries' THEN {quote(retained_rows('event_outbox_deliveries'))}
            ELSE 'true' END;
        IF t.udt_name='uuid' THEN
            EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I s WHERE %s AND s.%I IN (SELECT id FROM retiring_ids))',
                t.table_name, row_filter, t.column_name) INTO found;
        ELSE
            EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I s CROSS JOIN LATERAL '
                'regexp_matches(lower(s.%I::text), $1, ''g'') matched(tokens) '
                'JOIN retiring_ids ids ON ids.id::text=matched.tokens[1] WHERE %s)',
                t.table_name, t.column_name, row_filter) INTO found USING pattern;
        END IF;
        IF found THEN
            RAISE EXCEPTION '봇의 현행 데이터 참조 발견: %.%; 보존을 위해 중단합니다', t.table_name, t.column_name;
        END IF;
    END LOOP;
END $guard$;
CREATE TEMP TABLE legacy_open_focus ON COMMIT DROP AS
SELECT s.id, s.started_at FROM focus_sessions s
WHERE s.ended_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM focus_session_details d WHERE d.session_id=s.id)
  AND (s.user_id IS NULL OR s.user_id NOT IN (SELECT id FROM retiring_bots));
CREATE TEMP TABLE preserved_counts (name text PRIMARY KEY, expected bigint) ON COMMIT DROP;
DO $counts$
DECLARE t record; n bigint; removed bigint;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
        AND tablename NOT IN ({retired}, 'flyway_schema_history')
    LOOP
        EXECUTE format('SELECT count(*) FROM public.%I', t.tablename) INTO n;
        removed := 0;
        CASE t.tablename
            WHEN 'users' THEN SELECT count(*) INTO removed FROM retiring_bots;
            WHEN 'focus_sessions', 'daily_focus_stats', 'user_notification_settings' THEN
                EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id IN (SELECT id FROM retiring_bots)',
                    t.tablename) INTO removed;
            WHEN 'event_outbox' THEN
                SELECT count(*) INTO removed FROM event_outbox s WHERE {orphan_link_event()};
            WHEN 'event_outbox_deliveries' THEN
                SELECT count(*) INTO removed FROM event_outbox_deliveries WHERE target='LINK';
            ELSE NULL;
        END CASE;
        INSERT INTO preserved_counts VALUES (
            COALESCE({quote(json.dumps(manifest['renamed_tables']))}::jsonb ->> t.tablename, t.tablename),
            n - removed);
    END LOOP;
END $counts$;
"""


def apply_sql(manifest, v0_checksum):
    tables = manifest['source_tables'] + ['flyway_schema_history']
    locks = ', '.join('public.' + identifier(t) for t in sorted(tables))
    cleanup = '\n'.join(f'DELETE FROM public.{identifier(t)} WHERE {identifier(c)} '
                        'IN (SELECT id FROM retiring_bots);'
                        for t, c in CLEANUP.items() if t != 'users')
    transition = (ASSETS / 'retire.sql').read_text()
    old_history = quote(json.dumps(manifest['source_history']))
    return f"""
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SELECT pg_advisory_xact_lock(182212017, 0);
LOCK TABLE {locks} IN ACCESS EXCLUSIVE MODE;
{public_schema_guard()}
DO $guard$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND pid<>pg_backend_pid() AND backend_type IS DISTINCT FROM 'autovacuum worker') THEN
        RAISE EXCEPTION '다른 DB 연결이 있습니다. 모든 API·worker·writer를 중지하세요';
    END IF;
    IF {schema_expression()} NOT IN ({', '.join(quote(value) for value in manifest['source_schemas'])}) THEN
        RAISE EXCEPTION '백업 이후 스키마가 바뀌었습니다';
    END IF;
    IF (SELECT count(*) FROM flyway_schema_history) <> {len(manifest['source_history'])}
       OR EXISTS (
        SELECT 1 FROM flyway_schema_history h
        FULL JOIN jsonb_to_recordset({old_history}::jsonb)
            AS known(version text, type text, script text, checksum integer, success boolean)
            ON h.version=known.version
        WHERE h.version IS NULL OR known.version IS NULL OR NOT h.success
          OR NOT ((h.version='1' AND h.type='BASELINE' AND h.checksum IS NULL)
              OR (h.type=known.type AND h.script=known.script AND h.checksum IS NOT DISTINCT FROM known.checksum))) THEN
        RAISE EXCEPTION '백업 이후 migration 이력이 바뀌었습니다';
    END IF;
END $guard$;
{preparation(manifest)}
{transition}
{cleanup}
DELETE FROM public.users WHERE id IN (SELECT id FROM retiring_bots);
DO $verify$
DECLARE preserved record; n bigint;
BEGIN
    IF {schema_expression()} NOT IN ({', '.join(quote(value) for value in manifest['target_schemas'])}) THEN
        RAISE EXCEPTION '정리 후 스키마가 승인한 V0 구조와 다릅니다';
    END IF;
    IF EXISTS (SELECT 1 FROM legacy_open_focus old
        LEFT JOIN focus_sessions s ON s.id=old.id
        WHERE s.id IS NULL OR s.ended_at IS DISTINCT FROM old.started_at OR s.status<>'AUTO_CLOSED') THEN
        RAISE EXCEPTION '구 집중 마커의 0초 마감 검증 실패';
    END IF;
    IF EXISTS (SELECT 1 FROM event_outbox_deliveries WHERE target='LINK') THEN
        RAISE EXCEPTION '폐기 LINK 전달 작업이 남았습니다';
    END IF;
    FOR preserved IN SELECT * FROM preserved_counts LOOP
        EXECUTE format('SELECT count(*) FROM public.%I', preserved.name) INTO n;
        IF n <> preserved.expected THEN
            RAISE EXCEPTION '보존 데이터 행 수 불일치: %, 기대 %, 실제 %', preserved.name, preserved.expected, n;
        END IF;
    END LOOP;
END $verify$;
-- 기존 행 수 검증을 마친 뒤 기본 데이터의 누락만 보완한다. 동일 키 충돌은 전체 전환을 롤백한다.
{DEFAULTS.read_text()}
TRUNCATE TABLE public.flyway_schema_history;
INSERT INTO public.flyway_schema_history
    (installed_rank, version, description, type, script, checksum, installed_by, execution_time, success)
VALUES (1, '0', 'baseline', 'SQL', 'V0__baseline.sql', {v0_checksum}, current_user, 0, true);
{bridge_sql(manifest)}
COMMIT;
"""


def load_manifest():
    manifest = json.loads((ASSETS / 'manifest.json').read_text())
    expected_checksum = checksum(BASELINE)
    if expected_checksum != manifest['v0_checksum']:
        raise ValueError('V0 SQL과 전환 manifest가 다릅니다. 임의 SQL로 이력을 바꿀 수 없습니다.')
    if hashlib.sha256((ASSETS / 'retire.sql').read_bytes()).hexdigest() != manifest['retire_sha256']:
        raise ValueError('정리 SQL과 검증한 manifest가 다릅니다.')
    if (hashlib.sha256(DEFAULTS.read_bytes()).hexdigest() != manifest['seed_sha256']
            or checksum(DEFAULTS) != manifest['seed_checksum']):
        raise ValueError('기본 insert.sql과 검증한 manifest가 다릅니다.')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', required=True, choices=('dev', 'prod'))
    parser.add_argument('--client', choices=('auto', 'native', 'docker'), default='auto')
    parser.add_argument('--apply', action='store_true', help='생략하면 읽기 전용 계획만 출력')
    parser.add_argument('--writers-stopped', action='store_true', help='모든 DB writer 중지 확인')
    parser.add_argument('--confirm', help='<environment>:<PGDATABASE>')
    parser.add_argument('--backup', type=Path, help='전체 custom-format 백업 파일의 새 경로')
    args = parser.parse_args()
    manifest = load_manifest()
    expected_checksum = manifest['v0_checksum']
    database = Database(args.client)
    info = database.data("SELECT json_build_object('database',current_database(),'user',current_user,"
                         "'server_version',current_setting('server_version_num'),"
                         "'other_connections',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()"
                         " AND pid<>pg_backend_pid() AND backend_type IS DISTINCT FROM 'autovacuum worker'));")
    if info['database'] != database.env['PGDATABASE'] or info['user'] != database.env['PGUSER']:
        raise ValueError('실제 DB/계정이 명시한 접속 대상과 다릅니다.')
    if int(info['server_version']) // 10000 != 16:
        raise ValueError('이 전환은 PostgreSQL 16에서 검증했습니다. 다른 major는 지원하지 않습니다.')
    database.sql(public_schema_guard())
    history = database.data("SELECT json_agg(row_to_json(h) ORDER BY h.version::numeric) FROM "
                            "(SELECT version,type,script,checksum,success FROM flyway_schema_history) h;")
    manifest = profile_for_history(manifest, history or [])
    fingerprint = database.fingerprint()
    if history and history[0]['version'] == '0' and len(history) == 7:
        extended = extension_profile(manifest)
        canonical = [{'version': '0', 'type': 'SQL', 'script': 'V0__baseline.sql',
                      'checksum': expected_checksum, 'success': True}, *extended['bridge_history']]
        if history != canonical or fingerprint not in extended['final_schemas']:
            raise ValueError('백오피스 V0..6 history/스키마가 일치하지 않습니다.')
        print('이미 검증된 백오피스 V0..6입니다. 구조 변경 없음.')
        return
    if len(history or []) == 1 and history[0]['version'] == '0':
        if (history[0]['checksum'] != expected_checksum or not history[0]['success']
                or history[0]['type'] != 'SQL' or history[0]['script'] != 'V0__baseline.sql'
                or fingerprint not in manifest['target_schemas']):
            raise ValueError('V0 history/스키마가 일치하지 않습니다.')
        print(json.dumps({'version': '0', 'v0_checksum': expected_checksum,
                          'seed_checksum': manifest['seed_checksum'], 'seed_sha256': manifest['seed_sha256']},
                         ensure_ascii=False, indent=2))
        print('이미 검증된 V0입니다. 구조 변경 없음. 기본 데이터 복구는 앱 기동의 afterMigrate가 수행합니다.')
        return
    assert_history(history or [], manifest['source_history'])
    if fingerprint not in manifest['source_schemas']:
        raise ValueError('V138 이력은 있으나 스키마가 다릅니다. drift를 조사한 뒤 진행하세요.')
    check_bot_references(database, manifest)
    count_queries = [f'SELECT {quote(table)} AS name, count(*) AS rows FROM public.{identifier(table)}'
                     for table in manifest['retired_tables']]
    counts = database.data('SELECT json_object_agg(name, rows) FROM ('
                           + ' UNION ALL '.join(count_queries) + ') counted;')
    bots = int(database.sql(f'SELECT count(*) FROM users WHERE id IN ({bot_ids_sql(manifest)});'))
    legacy_open = int(database.sql("SELECT count(*) FROM focus_sessions s WHERE s.ended_at IS NULL "
                                   "AND NOT EXISTS (SELECT 1 FROM focus_session_details d WHERE d.session_id=s.id);"))
    link_deliveries = int(database.sql("SELECT count(*) FROM event_outbox_deliveries WHERE target='LINK';"))
    link_events = int(database.sql('SELECT count(*) FROM event_outbox s WHERE ' + orphan_link_event() + ';'))
    plan = {'environment': args.environment, 'host': database.env['PGHOST'], 'port': database.env['PGPORT'],
            **info, 'from_version': manifest['source_version'], 'to_version': '6' if manifest.get('profile') else '0', 'retired_table_rows': counts,
            'v0_checksum': expected_checksum, 'seed_checksum': manifest['seed_checksum'],
            'seed_sha256': manifest['seed_sha256'], 'default_rows': manifest['default_rows'],
            'seed_bot_accounts': bots, 'legacy_focus_markers_to_close': legacy_open,
            'link_deliveries_to_delete': link_deliveries, 'orphan_link_events_to_delete': link_events,
            'retired_columns': manifest['retired_columns'], 'renamed_tables': manifest['renamed_tables']}
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    if not args.apply:
        print('읽기 전용 계획입니다. 현재 Catus 사용자·섬·정책 데이터는 보존 대상입니다.')
        return
    expected_confirm = args.environment + ':' + database.env['PGDATABASE']
    if not args.writers_stopped or args.confirm != expected_confirm or args.backup is None:
        raise ValueError('--apply에는 --writers-stopped, --confirm ' + expected_confirm
                         + ', --backup <새 파일>이 모두 필요합니다.')
    if info['other_connections']:
        raise ValueError('다른 DB 연결이 있습니다. 모든 API·worker·writer를 중지한 뒤 실행하세요.')
    database.backup(args.backup)
    args.backup.with_suffix(args.backup.suffix + '.plan.json').write_text(
        json.dumps(plan, ensure_ascii=False, indent=2) + '\n')
    database.sql(apply_sql(manifest, expected_checksum))
    print('V0 전환 완료. 전체 백업: ' + str(args.backup))
    print('새 V0 이미지로 Data API를 시작하고 health·회원·섬·집중 흐름을 확인하세요.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        print('중단: ' + str(error), file=sys.stderr)
        sys.exit(1)
