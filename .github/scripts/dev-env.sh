#!/usr/bin/env bash
# dev 런타임 값을 SM 에서 배포 때마다 새로 만든다. GROMO-2224.
#
#   dev-env.sh [APP_IMAGE]
#     compose 보간 입력 dev.env 를 임시 폴더에 만들고 경로를 GITHUB_ENV 의 RUNTIME_ENV_FILE 로 넘김.
#     data-api 컨테이너 env(data-api.env)도 같은 폴더에 만들어 DATA_API_ENV_FILE 로 넘김.
#     APP_IMAGE 생략 시 떠 있는 data-api 컨테이너 이미지. 마지막 단계 「임시 env 삭제」가 지움.
#   dev-env.sh secrets
#     dev 시크릿(gromo/dev/env) JSON 을 stdout. 서비스별 선별은 write-compose-env.py 가 함.
#   dev-env.sh check
#     배포 전 점검. 파일을 쓰지 않고 legacy·전 서비스의 필수 키·금지 키·토큰 규칙만 검사. 안 쓰는 키는 경고.
#
# 비밀값을 VM 디스크에 남기지 않음. 상태(현재 이미지)는 파일 대신 떠 있는 컨테이너에서 읽음.
set -euo pipefail

# Data 프로파일 (비밀 아님). realtime-authorization: Realtime → Data 조회 인가 (GROMO-2182)
DATA_API_PROFILES=${DATA_API_PROFILES:-dev,satellites,realtime-authorization}

# 원본은 gromo/dev/env 하나. 서버별로 필요한 키만 고르는 건 write-compose-env.py(필터)가 맡음
secrets() {
  aws secretsmanager get-secret-value --secret-id "${DEV_SECRET_ID:-gromo/dev/env}" \
    --query SecretString --output text \
  | jq -e 'if type == "object" then . else error("SecretString 은 JSON object 여야 함") end'
}

if [ "${1:-}" = secrets ]; then
  secrets
  exit 0
fi
if [ "${1:-}" = check ]; then
  secrets | python3 "$(dirname "$0")/write-compose-env.py" --check --report-unused \
    --environment dev --data-profiles "$DATA_API_PROFILES" --output /dev/null --app-image "check@sha256:0"
  exit 0
fi

image=${1:-}
if [ -z "$image" ]; then
  image=$(docker inspect -f '{{.Config.Image}}' phone-data-api 2>/dev/null) \
    || { echo "::error::phone-data-api 컨테이너가 없어 Data 이미지를 알 수 없음 — data-api 를 먼저 배포하거나 이미지를 인자로 넘길 것" >&2; exit 1; }
fi
dir=$(mktemp -d "${RUNNER_TEMP:-/tmp}/dev-env.XXXXXX")
chmod 700 "$dir"
writer="$(dirname "$0")/write-compose-env.py"
json=$(secrets)  # SM 한 번만 읽음. 값은 셸 변수에만 두고 디스크엔 필터 결과만 씀
printf '%s' "$json" | python3 "$writer" --report-unused --output "$dir/dev.env" --app-image "$image"
# Data 컨테이너 env (satellites.data.dev.yml 이 env_file 로 통째 교체). 예전엔 VM 에 손으로 둔 파일.
# 비밀 아닌 설정 2개는 SM 대신 여기 고정: 내부 API 스위치(business·notification 이 Data 내부 API 호출)
printf '%s' "$json" \
  | jq '. + {INTERNAL_API_ENABLED: "true"}' \
  | python3 "$writer" --service data-api --environment dev --data-profiles "$DATA_API_PROFILES" \
      --output "$dir/data-api.env" --image "$image"
{
  echo "RUNTIME_ENV_FILE=$dir/dev.env"
  echo "DATA_API_ENV_FILE=$dir/data-api.env"
  echo "DATA_API_PROFILES=$DATA_API_PROFILES"
} >> "${GITHUB_ENV:-/dev/null}"
echo "$dir/dev.env"
