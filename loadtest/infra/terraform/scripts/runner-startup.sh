#!/bin/bash
# loadtest self-hosted 러너 startup (GROMO-752) — terraform templatefile 로 주입.
#   ${github_repo}, ${gh_secret} 는 terraform 변수. bash 변수는 중괄호 없이 $VAR (templatefile 충돌 방지).
# 등록 크리덴셜: gromo-stress Secret Manager 의 ${gh_secret}(=oneorthree/ci-runner 와 같은 GitHub App creds)
#   를 VM 자기 SA(secretmanager.admin)로 읽어 App JWT→installation token→러너 등록토큰 발급.
# MIG(target_size=0) 온디맨드 — make runner-up 이 1 로 resize 하면 이 스크립트가 돌아 러너 등록.
set -euo pipefail
exec > /var/log/runner-startup.log 2>&1
echo "=== loadtest runner startup $(date -u) ==="

echo "=== [1/5] 패키지 (make test 오케스트레이션 도구) ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl jq openssl python3 git make gettext-base ca-certificates gnupg lsb-release

# gcloud CLI — make test 가 compute ssh/scp/sql/secrets 에 사용 (Ubuntu 기본 미포함)
if ! command -v gcloud >/dev/null 2>&1; then
  echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
    > /etc/apt/sources.list.d/google-cloud-sdk.list
  curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
  apt-get update -y && apt-get install -y google-cloud-cli
fi

# Node.js 20 — verdict.mjs / mint 실행용
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Docker — 워크플로(loadtest.yml)가 make image(docker build linux/amd64) + docker run(k6 검증)에 사용
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

# Terraform — 러너 도구 목록(loadtest.yml)에 포함
if ! command -v terraform >/dev/null 2>&1; then
  curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp.gpg
  echo "deb [signed-by=/usr/share/keyrings/hashicorp.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
    > /etc/apt/sources.list.d/hashicorp.list
  apt-get update -y && apt-get install -y terraform
fi

echo "=== [2/5] GitHub App creds (Secret Manager) → 등록 토큰 ==="
PROJECT=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/project/project-id)
SECRET=$(gcloud secrets versions access latest --secret="${gh_secret}" --project="$PROJECT")

APP_ID=$(echo "$SECRET"          | jq -r '.GITHUB_APP_ID')
INSTALLATION_ID=$(echo "$SECRET" | jq -r '.INSTALLATION_ID')
RUNNER_ORG=$(echo "$SECRET"      | jq -r '.RUNNER_ORG')
RUNNER_REPO=$(echo "$SECRET"     | jq -r '.RUNNER_REPO')

# PEM 복원 (SM 에 한 줄/공백으로 저장돼도 올바른 64열 PEM 으로)
echo "$SECRET" | jq -r '.GITHUB_APP_PEM' > /tmp/gh_app_raw.pem
python3 - <<'PYEOF'
import re, os
raw = open('/tmp/gh_app_raw.pem').read()
h = '-----BEGIN RSA PRIVATE KEY-----'; f = '-----END RSA PRIVATE KEY-----'
body = re.sub(r'\s+', '', raw.replace(h, '').replace(f, '').strip())
pem = h + '\n' + '\n'.join(body[i:i+64] for i in range(0, len(body), 64)) + '\n' + f + '\n'
open('/tmp/gh_app.pem', 'w').write(pem); os.chmod('/tmp/gh_app.pem', 0o600)
PYEOF

NOW=$(date +%s); IAT=$((NOW - 60)); EXP=$((NOW + 540))
b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
HEADER=$(printf '{"alg":"RS256","typ":"JWT"}' | b64)
PAYLOAD=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$IAT" "$EXP" "$APP_ID" | b64)
SIG=$(printf '%s.%s' "$HEADER" "$PAYLOAD" | openssl dgst -sha256 -sign /tmp/gh_app.pem | b64)
JWT="$HEADER.$PAYLOAD.$SIG"

INSTALL_TOKEN=$(curl -sf -X POST \
  -H "Authorization: Bearer $JWT" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/app/installations/$INSTALLATION_ID/access_tokens" | jq -r '.token')

REG_TOKEN=$(curl -sf -X POST \
  -H "Authorization: Bearer $INSTALL_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$RUNNER_ORG/$RUNNER_REPO/actions/runners/registration-token" | jq -r '.token')

echo "=== [3/5] offline 러너 정리 (같은 라벨 잔재) ==="
for rid in $(curl -sf -H "Authorization: Bearer $INSTALL_TOKEN" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$RUNNER_ORG/$RUNNER_REPO/actions/runners?per_page=100" \
    | jq -r '.runners[] | select(.status=="offline") | select(.labels[].name=="loadtest") | .id'); do
  curl -sf -X DELETE -H "Authorization: Bearer $INSTALL_TOKEN" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$RUNNER_ORG/$RUNNER_REPO/actions/runners/$rid" || true
done

echo "=== [4/5] actions-runner 설치 ==="
RUNNER_VERSION="2.322.0"
RUNNER_DIR="/opt/actions-runner"
mkdir -p "$RUNNER_DIR" && cd "$RUNNER_DIR"
curl -fsSL "https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/actions-runner-linux-x64-$RUNNER_VERSION.tar.gz" -o runner.tar.gz
tar xzf runner.tar.gz && rm runner.tar.gz

useradd -m -s /bin/bash runner 2>/dev/null || true
usermod -aG docker runner 2>/dev/null || true # make image(docker build)를 sudo 없이
chown -R runner:runner "$RUNNER_DIR"

echo "=== [5/5] 러너 등록 (labels: self-hosted,loadtest) + 서비스 기동 ==="
sudo -u runner ./config.sh \
  --url "https://github.com/$RUNNER_ORG/$RUNNER_REPO" \
  --token "$REG_TOKEN" \
  --name "loadtest-runner-$(hostname)" \
  --labels "self-hosted,loadtest,gcp,spot" \
  --unattended --replace
./svc.sh install runner
./svc.sh start

rm -f /tmp/gh_app.pem /tmp/gh_app_raw.pem
echo "=== runner startup 완료 ==="
