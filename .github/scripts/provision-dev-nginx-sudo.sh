#!/usr/bin/env bash
# gromo-dev-app의 배포 러너에 nginx 트래픽 경계 제어 권한만 부여한다.
set -euo pipefail

if (( EUID != 0 )); then
  echo 'root로 실행하세요: sudo bash .github/scripts/provision-dev-nginx-sudo.sh' >&2
  exit 1
fi

if ! id runner >/dev/null 2>&1; then
  echo 'runner 계정이 없습니다. Actions 러너를 먼저 설치하세요.' >&2
  exit 1
fi

target=/etc/sudoers.d/catus-dev-nginx
temporary=$(mktemp /etc/sudoers.d/.catus-dev-nginx.XXXXXX)
trap 'rm -f "$temporary"' EXIT

cat > "$temporary" <<'SUDOERS'
# Catus dev paired deployment: nginx traffic boundary only.
runner ALL=(root) NOPASSWD: /usr/bin/systemctl stop nginx, /usr/bin/systemctl start nginx
SUDOERS
chmod 0440 "$temporary"
visudo -cf "$temporary" >/dev/null

# 같은 디렉터리에서 교체해 sudo가 부분적으로 기록된 규칙을 읽지 않게 한다.
mv -fT "$temporary" "$target"
visudo -cf /etc/sudoers >/dev/null

for action in stop start; do
  runuser -u runner -- sudo -n -l /usr/bin/systemctl "$action" nginx >/dev/null
done
echo 'runner의 nginx stop/start 비대화식 sudo 권한을 확인했습니다.'
