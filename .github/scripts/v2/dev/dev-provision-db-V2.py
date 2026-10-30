#!/usr/bin/env python3
"""격리된 dev V2 PostgreSQL의 서비스 계정과 빈 DB를 준비한다."""
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

spec = importlib.util.spec_from_file_location('env_v2', Path(__file__).with_name('dev-env-V2.py'))
env = importlib.util.module_from_spec(spec)
spec.loader.exec_module(env)


def ident(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]{0,62}', value):
        raise ValueError('DB 또는 계정 이름이 허용 형식이 아닙니다')
    return '"' + value + '"'


def lit(value):
    if not isinstance(value, str) or not value or '\x00' in value:
        raise ValueError('DB 자격 값이 유효하지 않습니다')
    return "'" + value.replace("'", "''") + "'"


def build(secret, config):
    if config.get('environment') != 'dev-v2' or config.get('project') != 'oneorthree2':
        raise ValueError('dev V2 배포 설정이 아닙니다')
    if config['hosts']['data'].get('name') != 'catus-dev-v2-data':
        raise ValueError('DB 호스트가 dev V2가 아닙니다')
    env.w.require(secret, ('API_DB_URL', 'NOTI_DB_URL', 'CHAT_DB_URL', 'API_DB_USERNAME', 'API_DB_PASSWORD',
                           'NOTI_DB_USERNAME', 'NOTI_DB_PASSWORD', 'CHAT_DB_USERNAME', 'POSTGRES_USER', 'POSTGRES_PASSWORD'))
    data_db = env.database_name(secret['API_DB_URL'])
    noti_db = env.database_name(secret['NOTI_DB_URL'])
    rows = [(data_db, secret['API_DB_USERNAME'], secret['API_DB_PASSWORD']),
            (noti_db, secret['NOTI_DB_USERNAME'], secret['NOTI_DB_PASSWORD']),
            (env.database_name(secret['CHAT_DB_URL']), secret['CHAT_DB_USERNAME'], env.realtime_db_password(secret))]
    if len({r[0] for r in rows}) != 3 or len({r[1] for r in rows} | {secret['POSTGRES_USER']}) != 4:
        raise ValueError('DB 또는 계정이 서로 분리되지 않았습니다')
    sql = ['\\set ON_ERROR_STOP on']
    for db, user, password in rows:
        ident(db); ident(user)
        sql.extend([
            f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname={lit(user)} AND (rolsuper OR rolcreatedb OR rolcreaterole)) THEN RAISE EXCEPTION 'service role elevated'; END IF; IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname={lit(user)}) THEN RAISE EXCEPTION 'service role membership'; END IF; END $$;",
            f"SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', {lit(user)}) WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname={lit(user)}) ",
            r'\gexec',
            f"SELECT format('ALTER ROLE %I PASSWORD %L', {lit(user)}, {lit(password)})", r'\gexec',
            f"SELECT format('CREATE DATABASE %I OWNER %I', {lit(db)}, {lit(user)}) WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname={lit(db)})", r'\gexec',
            f'\\connect {ident(db)}',
            "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')) THEN RAISE EXCEPTION 'database is not empty'; END IF; END $$;",
            r'\connect postgres',
            f'ALTER DATABASE {ident(db)} OWNER TO {ident(user)};',
            f'REVOKE ALL ON DATABASE {ident(db)} FROM PUBLIC;',
            f'GRANT CONNECT ON DATABASE {ident(db)} TO {ident(user)};',
        ])
    return '\n'.join(sql) + '\n'


def main():
    if len(sys.argv) != 2:
        raise SystemExit('사용법: dev-provision-db-V2.py <dev V2 설정 JSON>; 시크릿은 stdin')
    secret = json.load(sys.stdin)
    config = json.loads(Path(sys.argv[1]).read_text())
    sql = build(secret, config)
    instance = subprocess.run(['gcloud', 'compute', 'instances', 'describe', 'catus-dev-v2-data',
                               '--project=oneorthree2', '--zone=asia-northeast3-a', '--format=value(id)'],
                              capture_output=True, text=True, check=False)
    if instance.returncode or instance.stdout.strip() != str(config['hosts']['data']['id']):
        raise ValueError('현재 DB VM의 ID가 v2 배포 설정과 다릅니다')
    cmd = ['gcloud', 'compute', 'ssh', 'catus-dev-v2-data', '--project=oneorthree2',
           '--zone=asia-northeast3-a', '--tunnel-through-iap', '--quiet', '--command',
           'sudo docker exec -i catus-dev-postgres-v2-postgres-1 sh -c \'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres\'']
    result = subprocess.run(cmd, input=sql, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if result.returncode:
        raise RuntimeError('v2 PostgreSQL 계정·DB 준비 실패')
    print('dev V2 서비스 계정과 DB 준비 완료')


if __name__ == '__main__':
    main()
