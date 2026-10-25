#!/usr/bin/env python3
"""동일 커밋의 Data·Realtime을 하나의 중단 구간에서 교체한다."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import pwd
import re
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
STATE_ROOT = Path(os.environ.get('CATUS_DEV_DEPLOY_STATE_DIR', str(Path.home() / '.local/state/catus/dev')))
CORE = {'data-api': 'phone-data-api', 'realtime': 'phone-realtime'}
QUIESCE_SERVICES = {'data-api', 'realtime', 'business-api', 'notification', 'postgres-exporter', 'datadog-agent'}
QUIESCE_NAMES = set(CORE.values()) | {'gromo-postgres-exporter', 'gromo-datadog-agent'}
NGINX_SYSTEMCTL = '/usr/bin/systemctl'


class DeployError(RuntimeError):
    pass


def command(args, *, env=None, check=True):
    result = subprocess.run([str(x) for x in args], capture_output=True, text=True, env=env)
    if check and result.returncode:
        # compose config와 컨테이너 inspect에는 비밀값이 있으므로 출력하지 않는다.
        raise DeployError(f'{args[0]} 명령 실패 (exit {result.returncode})')
    return result


def durable_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.state-')
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def require_idle(directory=STATE_ROOT):
    path = directory / 'deployment.json'
    if path.exists() and json.loads(path.read_text()).get('phase') != 'complete':
        raise DeployError('Data·Realtime 공동 전환이 미완료입니다. 같은 배포를 재실행하거나 current DB에서 수동 복구를 실행하세요.')


def verify_recovery_builds(repository, revision, run=command):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository or '') or not re.fullmatch(r'[0-9a-f]{40}', revision or ''):
        raise DeployError('복구 검증에는 GitHub 저장소와 40자리 main SHA가 필요합니다.')

    def pages(route, key):
        response = run(['gh', 'api', '--paginate', '--slurp', f'repos/{repository}/{route}'])
        return [item for page in json.loads(response.stdout) for item in page[key]]

    runs = pages('actions/workflows/data-api-ci.dev.yml/runs?event=push&branch=main&head_sha=' + revision + '&per_page=100', 'workflow_runs')
    matching = [item for item in runs if item['event'] == 'push' and item['head_branch'] == 'main'
                and item['head_sha'] == revision and item['path'] == '.github/workflows/data-api-ci.dev.yml'
                and item['head_repository']['full_name'].lower() == repository.lower()]
    if not matching:
        raise DeployError('같은 main SHA의 Data CI 실행이 없습니다.')
    source = max(matching, key=lambda item: item['id'])
    jobs = pages(f'actions/runs/{source["id"]}/jobs?filter=all&per_page=100', 'jobs')
    # 위성 배포 실패는 전체 CI를 실패시킨다. 두 이미지 발행의 최신 실행 결과만 검사한다.
    for name in ('Dev 이미지 build · GAR push', 'Realtime 공동 이미지 / 채팅 이미지 build · GAR push'):
        attempts = [job for job in jobs if job['name'] == name and job['head_sha'] == revision]
        latest = max(attempts, key=lambda item: item['id']) if attempts else {}
        if latest.get('status') != 'completed' or latest.get('conclusion') != 'success':
            raise DeployError('같은 main SHA의 이미지 검사·발행 성공을 확인하지 못했습니다: ' + name)
    return source['id']


def inspect_containers(run):
    ids = run(['docker', 'ps', '-aq']).stdout.split()
    return json.loads(run(['docker', 'inspect', *ids]).stdout) if ids else []


def selected_containers(containers):
    result = []
    for container in containers:
        name = container['Name'].lstrip('/')
        labels = container['Config'].get('Labels') or {}
        service = labels.get('com.docker.compose.service')
        if name in QUIESCE_NAMES or (labels.get('com.docker.compose.project') == 'phone' and service in QUIESCE_SERVICES):
            if any(container['State'].get(flag) for flag in ('Running', 'Restarting', 'Paused')):
                result.append(name)
    return result


def validate_contract(config, data_image, realtime_image):
    services = config['services']
    data, realtime = (services[name] for name in CORE)
    if data['image'] != data_image or realtime['image'] != realtime_image:
        raise DeployError('Compose 이미지와 CI digest가 다릅니다.')
    de, re_env = data['environment'], realtime['environment']
    if not {'dev', 'satellites', 'realtime-authorization'} <= set(de.get('SPRING_PROFILES_ACTIVE', '').split(',')):
        raise DeployError('Data 필수 프로파일이 누락되었습니다.')
    for key in ('JWT_SECRET', 'SVC_TOKEN_REALTIME_TO_DATA', 'SVC_TOKEN_DATA_TO_REALTIME'):
        if not de.get(key) or de.get(key) != re_env.get(key):
            raise DeployError(f'Data·Realtime 공유 설정 불일치: {key}')
    if not re_env.get('SVC_TOKEN_BIZ_TO_REALTIME') or re_env['SVC_TOKEN_BIZ_TO_REALTIME'] == re_env['SVC_TOKEN_DATA_TO_REALTIME']:
        raise DeployError('Realtime 호출자 토큰은 비어 있지 않은 서로 다른 값이어야 합니다.')
    if not re_env.get('KAFKA_BOOTSTRAP_SERVERS'):
        raise DeployError('Realtime Kafka 주소가 없습니다.')
    return config['networks']['app-network']['name']


class Deployment:
    def __init__(self, args, run=command, sleep=time.sleep):
        self.args, self.run, self.sleep = args, run, sleep
        self.directory = Path(args.state_dir)
        self.path = self.directory / 'deployment.json'
        self.state = json.loads(self.path.read_text()) if self.path.exists() else None
        self.env = dict(os.environ, APP_IMAGE=args.data_image, REALTIME_IMAGE=args.realtime_image,
                        IMAGE_REVISION=args.revision, IMAGE_VERSION=args.revision, DEPLOY_ENV='dev')
        self.compose = []

    def save(self, phase):
        self.state['phase'] = phase
        durable_json(self.path, self.state)

    def image(self, reference):
        self.run(['docker', 'pull', reference])
        item = json.loads(self.run(['docker', 'image', 'inspect', reference]).stdout)[0]
        if (item['Config'].get('Labels') or {}).get('org.opencontainers.image.revision') != self.args.revision:
            raise DeployError('이미지 OCI revision이 공동 배포 커밋과 다릅니다.')
        if reference not in item.get('RepoDigests', []):
            raise DeployError('pull한 이미지의 digest를 확인할 수 없습니다.')
        return item['Id']

    def runner(self, phase):
        args = ['python3', self.package / 'docs/db/deploy-v0.py', '--phase', phase,
                '--environment', 'dev', '--data-image', self.args.data_image,
                '--network', self.network, '--env-file', self.args.data_env_file,
                '--backup-dir', self.directory / 'backups', '--state-file', self.directory / 'database.json']
        if phase == 'apply':
            args.append('--writers-stopped')
        result = self.run(args, check=False)
        if result.returncode:
            # DB runner의 오류는 비밀값을 제거한 운영 설명이다.
            raise DeployError(f'DB {phase} 실패: {result.stderr.strip()}')
        report = json.loads(result.stdout)
        if report.get('state') not in ('empty', 'legacy', 'current'):
            raise DeployError('DB runner가 알 수 없는 상태를 반환했습니다.')
        if phase == 'apply' and (report.get('state') != 'current' or report.get('phase') != 'complete'):
            raise DeployError('DB runner의 전환 완료를 확인하지 못했습니다.')
        return report

    def preflight(self):
        args = self.args
        if not re.fullmatch(r'[0-9a-f]{40}', args.revision):
            raise DeployError('main commit SHA가 필요합니다.')
        for image in (args.data_image, args.realtime_image):
            if not re.fullmatch(r'[^\s]+@sha256:[0-9a-f]{64}', image):
                raise DeployError('두 이미지 모두 불변 digest로 지정해야 합니다.')
        resume = self.state and self.state.get('phase') != 'complete'
        recovery = getattr(args, 'recovery_only', False)
        if recovery and not resume:
            raise DeployError('수동 복구는 미완료 공동 배포에서만 실행할 수 있습니다.')
        replacement = resume and any(self.state.get(key) != getattr(args, key)
                                     for key in ('revision', 'data_image', 'realtime_image'))
        containers = inspect_containers(self.run)
        running = selected_containers(containers)
        if replacement or recovery:
            # 실패한 앱을 새 이미지로 고칠 때도 이전 중단 경계를 먼저 확인한다.
            if running or any(c['Name'].lstrip('/') in self.state['running']
                              and any(c['State'].get(flag) for flag in ('Running', 'Restarting', 'Paused'))
                              for c in containers):
                raise DeployError('새 이미지로 재개하려면 이전 배포의 모든 writer가 중지되어 있어야 합니다.')
            if self.run(['systemctl', 'show', '--property=ActiveState', '--value', 'nginx']).stdout.strip() != 'inactive':
                raise DeployError('새 이미지로 재개하려면 nginx가 완전히 중지되어 있어야 합니다.')
        self.image_ids = {name: self.image(getattr(args, name.replace('-', '_') + '_image'))
                          for name in ('data', 'realtime')}
        original = self.state['running'] if resume else running
        overlays = self.state['overlays'] if resume else [
            name for name, container in [('datadog', 'gromo-datadog-agent'), ('kafka', 'phone-kafka')]
            if any(c['Name'].lstrip('/') == container and c['State'].get('Running') for c in containers)]
        self.env['DATA_API_ENV_FILE'] = str(args.data_env_file)
        self.env['DATA_API_PROFILES'] = os.environ.get('DATA_API_PROFILES', 'dev,satellites,realtime-authorization')
        self.env['DATA_API_JAVA_OPTS'] = '-Djava.security.egd=file:/dev/./urandom' + (
            ' -javaagent:/opt/datadog/dd-java-agent.jar' if 'datadog' in overlays else '')
        self.compose = ['docker', 'compose', '--env-file', args.runtime_env_file,
                        '-f', ROOT / 'server/scripts/docker-compose.dev.yml']
        for overlay in overlays:
            self.compose += ['-f', ROOT / f'server/scripts/docker-compose.{overlay}.yml']
        self.compose += ['-f', ROOT / 'server/scripts/docker-compose.realtime.yml',
                         '-f', ROOT / 'server/scripts/docker-compose.satellites.data.dev.yml']
        config = json.loads(self.run(self.compose + ['config', '--format', 'json'], env=self.env).stdout)
        self.network = validate_contract(config, args.data_image, args.realtime_image)
        self.run(['docker', 'network', 'inspect', self.network])
        for name in ('phone-db', 'phone-redis'):
            entry = next((c for c in containers if c['Name'].lstrip('/') == name), None)
            if not entry or not entry['State'].get('Running') or entry['State'].get('Health', {}).get('Status') != 'healthy':
                raise DeployError(f'기존 기반 서비스가 healthy 상태가 아닙니다: {name}')
        self.run(['docker', 'pull', config['services']['realtime-db-init']['image']])
        nginx_active = (self.state['nginx_active'] if resume else
                        self.run(['systemctl', 'is-active', '--quiet', 'nginx'], check=False).returncode == 0)
        if nginx_active:
            for action in ('stop', 'start'):
                try:
                    self.run(['sudo', '-n', '-l', NGINX_SYSTEMCTL, action, 'nginx'])
                except DeployError as error:
                    user = pwd.getpwuid(os.geteuid()).pw_name
                    raise DeployError(
                        f'nginx {action} sudo 사전 검사 실패 (실행 계정: {user}). '
                        f'VM에서 해당 계정으로 `sudo -n -l {NGINX_SYSTEMCTL} {action} nginx`를 확인하고 '
                        '.github/scripts/provision-dev-nginx-sudo.sh로 제한된 권한을 설정하세요.'
                    ) from error
        # 실행될 SQL과 도구도 검증한 Data 이미지에서 가져온다.
        self.package = self.directory / 'packages' / args.revision
        self.package.mkdir(parents=True, exist_ok=True, mode=0o700)
        container = self.run(['docker', 'create', args.data_image]).stdout.strip()
        try:
            self.run(['docker', 'cp', f'{container}:/opt/catus-db/.', self.package])
        finally:
            self.run(['docker', 'rm', container], check=False)
        if not (self.package / 'docs/db/deploy-v0.py').is_file():
            raise DeployError('Data 이미지에 DB 전환 패키지가 없습니다.')
        report = self.runner('preflight')
        if replacement or recovery:
            if report['state'] != 'current' or report.get('other_connections') != 0:
                raise DeployError('새 이미지·수동 복구는 다른 DB 연결이 없는 current DB에서만 가능합니다. 동일 배포를 재실행하세요.')
        if replacement:
            # 모든 검증 뒤에만 새 이미지 쌍을 채택하고 최초 중지 전의 복원 목록은 보존한다.
            self.state = dict(self.state, revision=args.revision, data_image=args.data_image,
                              realtime_image=args.realtime_image)
        if not resume:
            self.state = dict(revision=args.revision, data_image=args.data_image, realtime_image=args.realtime_image,
                              running=original, overlays=overlays, nginx_active=nginx_active)

    def stop(self):
        failure = None
        if self.state['nginx_active']:
            try:
                self.run(['sudo', '-n', NGINX_SYSTEMCTL, 'stop', 'nginx'])
            except Exception as error:
                failure = error
        current = selected_containers(inspect_containers(self.run))
        if current:
            self.run(['docker', 'stop', '--time', '60', *current])
        # stop의 종료 코드만으로 DB 중단 경계를 판단하지 않는다.
        if selected_containers(inspect_containers(self.run)):
            raise DeployError('알려진 writer·관측 컨테이너가 아직 실행 중입니다.')
        if self.state['nginx_active']:
            active = self.run(['systemctl', 'show', '--property=ActiveState', '--value', 'nginx']).stdout.strip()
            if active != 'inactive':
                raise DeployError('nginx가 완전히 중지되지 않았습니다.')
        if failure:
            raise failure

    def restore(self):
        for container in self.state['running']:
            if container not in CORE.values():
                self.run(['docker', 'start', container])
        for container in self.state['running']:
            if container in CORE.values():
                continue
            item = json.loads(self.run(['docker', 'inspect', container]).stdout)[0]
            state = item['State']
            if not state.get('Running') or state.get('Restarting') or state.get('Paused'):
                raise DeployError(f'기존 서비스 복원에 실패했습니다: {container}')
            service = (item['Config'].get('Labels') or {}).get('com.docker.compose.service')
            if service in {'business-api', 'notification'}:
                self.healthy(container)

    def healthy(self, container, expected_id=None):
        deadline = time.monotonic() + self.args.health_timeout
        while time.monotonic() < deadline:
            item = json.loads(self.run(['docker', 'inspect', container]).stdout)[0]
            state = item['State']
            if expected_id and item['Image'] != expected_id:
                raise DeployError(f'기동한 컨테이너 이미지가 예상 digest와 다릅니다: {container}')
            if not state.get('Running') or state.get('Restarting') or state.get('Paused') or (expected_id and item.get('RestartCount', 0) > 0):
                raise DeployError(f'컨테이너가 중지 또는 재시작되었습니다: {container}')
            health = state.get('Health', {}).get('Status')
            if health == 'healthy':
                return
            if not health:
                raise DeployError(f'컨테이너 readiness를 통과하지 못했습니다: {container}')
            # 기동 중 일시적인 unhealthy도 제한 시간 안에 healthy로 회복할 수 있다.
            self.sleep(5)
        raise DeployError(f'컨테이너 readiness 대기 시간이 지났습니다: {container}')

    def deploy(self):
        self.preflight()
        # 첫 중지보다 먼저 기록하여 runner 강제 종료 뒤에도 재개 대상을 잃지 않는다.
        self.save('stopping')
        try:
            self.stop()
            self.save('database')
            self.runner('apply')
            self.save('starting')
            self.run(self.compose + ['run', '--rm', '--no-deps', 'realtime-db-init'], env=self.env)
            self.run(self.compose + ['up', '-d', '--no-deps', '--force-recreate', 'data-api', 'realtime'], env=self.env)
            self.healthy(CORE['data-api'], self.image_ids['data'])
            self.healthy(CORE['realtime'], self.image_ids['realtime'])
            self.save('restoring')
            # 기존에 떠 있던 위성·관측만 복원하고 새 서비스를 임의로 켜지 않는다.
            self.restore()
            self.healthy(CORE['data-api'], self.image_ids['data'])
            self.healthy(CORE['realtime'], self.image_ids['realtime'])
            if self.state['nginx_active']:
                self.run(['sudo', '-n', NGINX_SYSTEMCTL, 'start', 'nginx'])
                self.run(['systemctl', 'is-active', '--quiet', 'nginx'])
            self.save('complete')
            print(json.dumps({'phase': 'complete', 'revision': self.args.revision}))
        except BaseException:
            # DB 전환 후 옛 이미지로 자동 복귀하지 않는다. 다음 시도도 실제 DB를 검증한다.
            try:
                self.stop()
            except Exception:
                print('일부 서비스 중지에 실패했습니다. 중단 상태를 직접 확인해야 합니다.', file=sys.stderr)
            self.save('failed')
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assert-idle', action='store_true')
    parser.add_argument('--verify-recovery-builds', action='store_true')
    parser.add_argument('--recovery-only', action='store_true')
    parser.add_argument('--state-dir', type=Path, default=STATE_ROOT)
    parser.add_argument('--data-image')
    parser.add_argument('--realtime-image')
    parser.add_argument('--revision')
    parser.add_argument('--runtime-env-file', type=Path)
    parser.add_argument('--data-env-file', type=Path)
    parser.add_argument('--health-timeout', type=int, default=900)
    args = parser.parse_args()
    def interrupted(signum, frame):
        raise DeployError('배포 실행이 중단되었습니다. 같은 배포를 재실행하거나 current DB에서 수동 복구를 실행하세요.')
    signal.signal(signal.SIGTERM, interrupted)
    try:
        if args.assert_idle:
            require_idle(args.state_dir)
            return 0
        if args.verify_recovery_builds:
            source = verify_recovery_builds(os.environ.get('GITHUB_REPOSITORY'), args.revision)
            print(f'동일 main SHA의 Data·Realtime 이미지 검사·발행 확인: CI run {source}')
            return 0
        if not all((args.data_image, args.realtime_image, args.revision, args.runtime_env_file, args.data_env_file)):
            parser.error('두 이미지, revision, runtime-env-file, data-env-file을 모두 지정해야 합니다.')
        args.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(args.state_dir, 0o700)
        with (args.state_dir / 'deployment.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            Deployment(args).deploy()
        return 0
    except (DeployError, OSError, ValueError, KeyError) as error:
        print(f'공동 배포 중단: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
