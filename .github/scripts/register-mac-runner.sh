#!/usr/bin/env bash
#
# 내 맥을 phone 레포의 GitHub Actions 러너로 등록한다 (GROMO-2219).
# main 에 앱 변경이 머지되면 머지한 사람의 맥에서 dev TestFlight 빌드가 돌아가는데,
# 그 "머지한 사람의 맥"을 고르는 기준이 이 스크립트가 붙이는 라벨(깃허브 아이디)이다.
#
# 사용법 (레포 체크아웃 안에서, 자기 맥에서):
#   .github/scripts/register-mac-runner.sh
#
# 하는 일 — 자세한 설명은 docs/conventions/ios-testflight-dev-runner.md
#   1. 러너 프로그램을 ~/actions-runner 에 내려받는다 (이미 있으면 건너뜀)
#   2. gh 로 등록 토큰을 받아 레포에 등록한다. 라벨: macOS, ios, <내 깃허브 아이디>
#   3. App Store Connect API 키 환경변수를 러너 .env 에 적는다 (값은 물어본다)
#   4. 로그인하면 자동으로 뜨는 서비스로 등록하고 시작한다
#
# 필요한 것: gh 로그인(레포 admin 또는 러너 등록 권한), Xcode, Homebrew 의 node·cocoapods·ruby(bundler).
# 등록 토큰은 1시간짜리라 값이 남지 않는다. ASC 키 값은 ~/actions-runner/.env 에만 남는다(600).
set -euo pipefail

REPO="OneOrThree/phone"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner}"

say() { printf '\n▶ %s\n' "$*"; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

command -v gh >/dev/null || die "gh 가 없다. brew install gh 후 gh auth login"
gh auth status >/dev/null 2>&1 || die "gh 로그인이 필요하다: gh auth login"
LOGIN="$(gh api user --jq .login)"
[ "$(uname -m)" = "arm64" ] || die "Apple Silicon 맥만 지원한다 (지금: $(uname -m))"
[ -d /Applications/Xcode.app ] || die "Xcode 가 /Applications 에 없다"
for tool in node npm pod bundle; do
  command -v "$tool" >/dev/null || die "$tool 이 PATH 에 없다. 러너는 지금 이 셸의 PATH 를 저장해 쓰므로 먼저 설치한다 (brew install node@24 cocoapods ruby)"
done

say "1/4 러너 프로그램"
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"
if [ -f config.sh ]; then
  echo "이미 내려받아져 있음: $RUNNER_DIR"
else
  VER="$(gh api repos/actions/runner/releases/latest --jq .tag_name | sed 's/^v//')"
  echo "actions-runner $VER (osx-arm64) 내려받는 중"
  curl -sSL -o runner.tar.gz "https://github.com/actions/runner/releases/download/v$VER/actions-runner-osx-arm64-$VER.tar.gz"
  tar xzf runner.tar.gz && rm runner.tar.gz
fi

say "2/4 레포에 등록 — 라벨 macOS,ios,$LOGIN"
if [ -f .runner ]; then
  echo "이미 등록돼 있음 ($(sed -n 's/.*"agentName": *"\([^"]*\)".*/\1/p' .runner)). 다시 등록하려면 ./config.sh remove 뒤 재실행"
else
  NAME="$(hostname -s | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-\n' '-')"
  TOKEN="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
  ./config.sh --url "https://github.com/$REPO" --token "$TOKEN" --name "$NAME" --labels "macOS,ios,$LOGIN" --work _work --unattended
fi

say "3/4 App Store Connect API 키 (.env)"
if [ -f .env ] && grep -q '^ASC_KEY_ID=' .env; then
  echo "이미 .env 에 ASC 설정이 있음 — 바꾸려면 $RUNNER_DIR/.env 를 직접 고친다"
else
  echo "안수빈에게 받은 값을 넣는다. 키 파일(.p8)은 ~/.appstoreconnect/private_keys/ 에 두고 chmod 600."
  read -r -p "ASC_KEY_ID (예: 58SKY446HZ): " ASC_KEY_ID
  read -r -p "ASC_ISSUER_ID (36자): " ASC_ISSUER_ID
  DEFAULT_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
  read -r -p "ASC_KEY_PATH [$DEFAULT_KEY_PATH]: " ASC_KEY_PATH
  ASC_KEY_PATH="${ASC_KEY_PATH:-$DEFAULT_KEY_PATH}"
  [ -f "$ASC_KEY_PATH" ] || die "키 파일이 없다: $ASC_KEY_PATH"
  printf 'ASC_KEY_ID=%s\nASC_ISSUER_ID=%s\nASC_KEY_PATH=%s\nLANG=en_US.UTF-8\n' "$ASC_KEY_ID" "$ASC_ISSUER_ID" "$ASC_KEY_PATH" > .env
  chmod 600 .env
fi

say "4/4 로그인 시 자동 시작 서비스"
if ./svc.sh status 2>/dev/null | grep -q 'Started\|active'; then
  echo "이미 돌고 있음"
else
  ./svc.sh install
  ./svc.sh start
fi
sleep 5
./svc.sh status || true

say "확인"
gh api "repos/$REPO/actions/runners" --jq '.runners[] | select(.labels[].name == "'"$LOGIN"'") | "\(.name) | \(.status) | \([.labels[].name] | join(","))"' | sort -u
cat <<EOF

끝. 다음 할 일:
  - 시스템 설정 → 배터리 → 옵션 → "전원 어댑터 연결 시 자동으로 잠자기 방지" 켜기 (잠든 맥은 일을 못 받는다)
  - 레포 Actions → "iOS TestFlight (dev)" → Run workflow 로 내 맥에서 한 번 끝까지 도는지 확인
  - 지라 티켓에 러너 이름과 실행 링크 남기기
EOF
