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
#   4. 키체인이 백그라운드 서명(codesign)을 허용하게 한다 (맥 비밀번호 입력)
#   5. 로그인하면 자동으로 뜨는 서비스로 등록하고 시작한다
#   확인. 레포에 러너가 보이는지 보고, 레포 변수 IOS_DEV_RUNNERS 에 내 아이디를 덧붙인다
#      (워크플로는 이 변수에 있는 사람만 "러너 있음" 으로 보고, 없으면 오너 맥으로 폴백한다)
#
# 필요한 것: gh 로그인(레포 admin — 등록 토큰 발급과 러너 목록 조회가 admin 전용 API 다), Xcode,
# Homebrew 의 cocoapods·ruby(bundler). Node 는 워크플로가 setup-node 로 24 를 직접 깐다.
# 등록 토큰은 1시간짜리 일회용이고 config.sh 인자로만 잠깐 쓰인다(파일·로그에 남지 않음).
# ASC 키 값은 ~/actions-runner/.env 에만 남는다(600).
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
for tool in pod bundle; do
  command -v "$tool" >/dev/null || die "$tool 이 PATH 에 없다. 러너는 지금 이 셸의 PATH 를 저장해 쓰므로 먼저 설치한다 (brew install cocoapods ruby)"
done

say "1/5 러너 프로그램"
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"
if [ -f config.sh ]; then
  echo "이미 내려받아져 있음: $RUNNER_DIR"
else
  VER="$(gh api repos/actions/runner/releases/latest --jq .tag_name | sed 's/^v//')"
  # 릴리스 노트에 적힌 sha256 과 대조한다 — 서명 키가 있는 맥에서 돌 프로그램이라 받은 그대로 풀지 않는다
  SHA="$(gh api repos/actions/runner/releases/latest --jq '.body | capture("BEGIN SHA osx-arm64 -->(?<sha>[0-9a-f]{64})").sha')" \
    || die "릴리스 노트에서 osx-arm64 sha256 을 못 찾았다 (v$VER). 형식이 바뀌었는지 https://github.com/actions/runner/releases 확인"
  echo "actions-runner $VER (osx-arm64) 내려받는 중"
  curl -sSL -o runner.tar.gz "https://github.com/actions/runner/releases/download/v$VER/actions-runner-osx-arm64-$VER.tar.gz"
  echo "$SHA  runner.tar.gz" | shasum -a 256 -c - || die "내려받은 러너의 sha256 이 릴리스 노트와 다르다 — 풀지 않고 멈춘다"
  tar xzf runner.tar.gz && rm runner.tar.gz
fi

say "2/5 레포에 등록 — 라벨 macOS,ios,$LOGIN"
if [ -f .runner ]; then
  # 같은 폴더에 다른 레포용 러너가 있을 수 있다. 라벨은 로컬에 안 남으므로 맨 끝 "확인"에서 API 로 본다.
  REGISTERED_URL="$(sed -n 's/.*"gitHubUrl": *"\([^"]*\)".*/\1/p' .runner)"
  [ "$REGISTERED_URL" = "https://github.com/$REPO" ] \
    || die "$RUNNER_DIR 의 러너는 다른 레포($REGISTERED_URL)용이다. RUNNER_DIR=~/다른폴더 로 다시 실행하거나 ./config.sh remove 뒤 재실행"
  echo "이미 등록돼 있음 ($(sed -n 's/.*"agentName": *"\([^"]*\)".*/\1/p' .runner)). 다시 등록하려면 ./config.sh remove 뒤 재실행"
else
  NAME="$(hostname -s | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-\n' '-')"
  TOKEN="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
  ./config.sh --url "https://github.com/$REPO" --token "$TOKEN" --name "$NAME" --labels "macOS,ios,$LOGIN" --work _work --unattended
fi

say "3/5 App Store Connect API 키 (.env)"
ENV_WRITTEN=0 # 이번 실행에서 .env 를 새로 적었으면 5/5 에서 러너를 재시작한다 (러너는 시작할 때만 .env 를 읽는다)
# 세 값이 다 비어 있지 않고 키 파일도 있어야 "설정됨" — 하나라도 빠졌으면 다시 물어서 덮어쓴다
ENV_KEY_PATH="$(sed -n 's/^ASC_KEY_PATH=//p' .env 2>/dev/null || true)"
if [ "$(grep -c -E '^ASC_(KEY_ID|ISSUER_ID|KEY_PATH)=.' .env 2>/dev/null)" = 3 ] && [ -f "$ENV_KEY_PATH" ]; then
  echo "이미 .env 에 ASC 설정이 있음 — 바꾸려면 $RUNNER_DIR/.env 를 직접 고친다"
else
  echo "안수빈에게 받은 값을 넣는다. 키 파일(.p8)은 ~/.appstoreconnect/private_keys/ 에 두고 chmod 600."
  read -r -p "ASC_KEY_ID (예: 58SKY446HZ): " ASC_KEY_ID
  [ -n "$ASC_KEY_ID" ] || die "ASC_KEY_ID 가 비었다"
  read -r -p "ASC_ISSUER_ID (36자): " ASC_ISSUER_ID
  [ -n "$ASC_ISSUER_ID" ] || die "ASC_ISSUER_ID 가 비었다"
  DEFAULT_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
  read -r -p "ASC_KEY_PATH [$DEFAULT_KEY_PATH]: " ASC_KEY_PATH
  ASC_KEY_PATH="${ASC_KEY_PATH:-$DEFAULT_KEY_PATH}"
  [ -f "$ASC_KEY_PATH" ] || die "키 파일이 없다: $ASC_KEY_PATH"
  # umask 로 처음부터 600 으로 만든다 (만든 뒤 chmod 하면 그 사이가 644)
  (umask 077; printf 'ASC_KEY_ID=%s\nASC_ISSUER_ID=%s\nASC_KEY_PATH=%s\nLANG=en_US.UTF-8\n' "$ASC_KEY_ID" "$ASC_ISSUER_ID" "$ASC_KEY_PATH" > .env)
  ENV_WRITTEN=1
fi

say "4/5 서명 키 접근 허용 (맥 비밀번호를 물어본다)"
# 러너는 백그라운드 서비스라 codesign 의 키체인 허용 창을 띄울 수 없다. 미리 허용해 두지 않으면 errSecInternalComponent 로 실패한다.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db >/dev/null \
  || echo "⚠️ 키체인 허용에 실패했다. 나중에 직접 실행한다: security set-key-partition-list -S apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db"

say "5/5 로그인 시 자동 시작 서비스"
# 러너의 기본 서비스 설정에는 SessionCreate 가 켜져 있어 러너가 로그인 세션과 분리된 세션에서 뜬다.
# 그 세션에서는 키체인의 서명 키를 못 써서 아카이브가 errSecInternalComponent 로 실패한다 — 빼고 설치한다.
if grep -q "SessionCreate" bin/actions.runner.plist.template; then
  perl -0pi -e 's/\s*<key>SessionCreate<\/key>\s*<true\/>//' bin/actions.runner.plist.template
  echo "서비스 설정에서 SessionCreate 를 뺐다"
fi
# svc.sh 는 설치한 plist 경로를 .service 에 적는다. install 은 plist 가 이미 있으면 "error: exists" 로 죽고,
# uninstall 은 stop 을 포함해 멈춘 서비스에는 실패하므로 설치 여부와 실행 여부를 따로 보고 갈라 처리한다.
PLIST="$(cat .service 2>/dev/null || true)"
SVC_STATUS="$(./svc.sh status 2>/dev/null || true)"
running=0
grep -q '^Started' <<<"$SVC_STATUS" && running=1
need_start=1
if [ -z "$PLIST" ] || [ ! -f "$PLIST" ]; then
  ./svc.sh install
elif grep -q SessionCreate "$PLIST"; then
  echo "옛 설정(SessionCreate)이라 다시 설치한다"
  if [ "$running" = 1 ]; then ./svc.sh uninstall; else rm -f "$PLIST" .service; fi
  ./svc.sh install
elif [ "$running" = 0 ]; then
  echo "설치돼 있지만 멈춰 있음 — 시작한다"
elif [ "$ENV_WRITTEN" = 1 ]; then
  echo ".env 를 새로 적었으니 재시작한다"
  ./svc.sh stop
else
  echo "이미 돌고 있음"
  need_start=0
fi
[ "$need_start" = 0 ] || ./svc.sh start
sleep 5
./svc.sh status || true

say "확인"
# 이 폴더의 러너(.runner 의 agentName)가 워크플로 runs-on 의 라벨 macOS·ios·<아이디>를 전부 갖고 있는지 본다
AGENT="$(sed -n 's/.*"agentName": *"\([^"]*\)".*/\1/p' .runner)"
FOUND="$(gh api "repos/$REPO/actions/runners" --jq '.runners[] | select(.name == "'"$AGENT"'") | select((["macOS","ios","'"$LOGIN"'"] - [.labels[].name]) == []) | "\(.name) | \(.status) | \([.labels[].name] | join(","))"')"
[ -n "$FOUND" ] || die "레포에 이름 $AGENT, 라벨 macOS,ios,$LOGIN 을 모두 가진 러너가 안 보인다. 라벨이 다르게 등록돼 있으면 ./config.sh remove 뒤 재실행"
echo "$FOUND"
# 서비스가 뜬 직후라 GitHub 에 아직 안 붙었을 수 있다 — 30초까지 기다려 online 이 돼야 변수에 넣는다.
# offline 인 채로 변수에 넣으면 그 사람의 머지가 오너 맥 폴백 대신 죽은 러너를 기다리게 된다.
for _ in 1 2 3 4 5 6; do
  case "$FOUND" in *"| online |"*) break ;; esac
  sleep 5
  FOUND="$(gh api "repos/$REPO/actions/runners" --jq '.runners[] | select(.name == "'"$AGENT"'") | "\(.name) | \(.status) | \([.labels[].name] | join(","))"')"
done
case "$FOUND" in
  *"| online |"*) ;;
  *) die "러너가 30초가 지나도 online 이 아니다 ($FOUND). ./svc.sh status 와 ~/Library/Logs/actions.runner.*/ 로그를 보고 고친 뒤 재실행 — IOS_DEV_RUNNERS 에는 아직 넣지 않았다" ;;
esac
# 워크플로는 GITHUB_TOKEN 으로 러너 목록을 못 읽어, 레포 변수 IOS_DEV_RUNNERS(쉼표 목록, 공백 없이)로 등록 여부를 본다
CURRENT="$(gh variable get IOS_DEV_RUNNERS --repo "$REPO" 2>/dev/null || true)"
case ",$CURRENT," in
  *",$LOGIN,"*) echo "IOS_DEV_RUNNERS 에 이미 있음: $CURRENT" ;;
  *) gh variable set IOS_DEV_RUNNERS --repo "$REPO" --body "${CURRENT:+$CURRENT,}$LOGIN"
     echo "IOS_DEV_RUNNERS = ${CURRENT:+$CURRENT,}$LOGIN" ;;
esac
cat <<EOF

끝. 다음 할 일:
  - 시스템 설정 → 배터리 → 옵션 → "전원 어댑터 연결 시 자동으로 잠자기 방지" 켜기 (잠든 맥은 일을 못 받는다)
  - 레포 Actions → "iOS TestFlight (dev)" → Run workflow 로 내 맥에서 한 번 끝까지 도는지 확인
  - 지라 티켓에 러너 이름과 실행 링크 남기기
EOF
