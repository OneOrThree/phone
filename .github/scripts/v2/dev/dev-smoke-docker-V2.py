#!/usr/bin/env python3
"""스모크의 docker 호출을 컨테이너가 있는 dev V2 VM에 IAP로 전달한다."""
import os
import shlex
import subprocess
import sys

HOSTS = {'catus-dev-app-v2-': 'catus-dev-v2-app', 'catus-dev-redis-v2-': 'catus-dev-v2-redis',
         'catus-dev-kafka-v2-': 'catus-dev-v2-data', 'catus-dev-postgres-v2-': 'catus-dev-v2-data'}
# image ID에는 컨테이너 이름이 없다. image inspect는 앱 이미지 조회뿐.
DEFAULT_HOST = 'catus-dev-v2-app'
AUTH = 'REDISCLI_AUTH'


def host_for(args):
    for arg in args:
        for prefix, host in HOSTS.items():
            if arg.startswith(prefix): return host
    if args[:2] == ['image', 'inspect']: return DEFAULT_HOST
    raise ValueError('dev V2 컨테이너가 아닙니다')


def remote_command(args, auth):
    if args[:1] != ['exec'] and args[:1] != ['inspect'] and args[:2] != ['image', 'inspect']:
        raise ValueError('허용되지 않은 docker 명령')
    command = shlex.join(['docker', *args])
    if not auth: return 'sudo ' + command
    # 비밀번호는 argv에 두지 않는다. stdin 첫 줄만 읽고 나머지는 redis-cli 입력.
    return 'sudo sh -c ' + shlex.quote(f'IFS= read -r {AUTH}; export {AUTH}; exec {command}')


def main(args):
    auth = os.environ.get(AUTH) if AUTH in args else None
    ssh = ['gcloud', 'compute', 'ssh', host_for(args), '--project=oneorthree2', '--zone=asia-northeast3-a',
           '--tunnel-through-iap', '--ssh-key-expire-after=1h', '--quiet', '--command', remote_command(args, auth)]
    if not auth: return subprocess.run(ssh).returncode
    return subprocess.run(ssh, input=(auth + '\n').encode() + sys.stdin.buffer.read()).returncode


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
