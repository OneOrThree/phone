#!/usr/bin/env bash
# dev 배포 결과를 머지 PR 에 표시. GROMO-2224.
# 사용: mark-deploy.sh <success|failure> <서비스> <커밋 SHA>
# 성공: deployed:dev-<서비스> 라벨. 실패: deploy-failed:dev-<서비스> 라벨. 둘 다 코멘트 → 작성자에게 GitHub 알림.
# 한 PR 에는 최신 결과 라벨 하나만 남김.
# self-hosted 러너에 gh 없을 수 있어 curl·jq 만 씀. 필요 env: GH_TOKEN, GITHUB_REPOSITORY, RUN_URL.
# 표시 실패는 배포 결과를 바꾸지 않게 호출 측에서 continue-on-error 로 둠.
set -euo pipefail

result=${1:?success|failure}
service=${2:?서비스}
revision=${3:?커밋 SHA}
api="${GITHUB_API_URL:-https://api.github.com}/repos/$GITHUB_REPOSITORY"

gh_api() {
  local method=$1 path=$2 body=${3:-}
  curl -fsS -X "$method" -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" \
    ${body:+--data "$body"} "$api$path"
}

pr=$(gh_api GET "/commits/$revision/pulls" | jq -r '[.[] | select(.merged_at != null)][0].number // empty')
if [ -z "$pr" ]; then echo "커밋 $revision 에 머지 PR 없음 — 표시 건너뜀"; exit 0; fi

short=${revision:0:8}
ok_label="deployed:dev-$service"
fail_label="deploy-failed:dev-$service"
if [ "$result" = success ]; then
  label=$ok_label; stale=$fail_label; color=1D76DB; desc="dev 서버 배포 완료 (dev CD 가 붙임)"
  body="dev \`$service\` 배포 완료 — 커밋 \`$short\` · [실행 기록]($RUN_URL)"
else
  label=$fail_label; stale=$ok_label; color=D93F0B; desc="dev 서버 배포 실패 (dev CD 가 붙임)"
  body="⚠️ dev \`$service\` 배포 실패 — 커밋 \`$short\` · [실행 기록]($RUN_URL)"
fi
# 부착 API 는 없는 라벨을 안 만듦 → 먼저 확인·생성
gh_api GET "/labels/$label" > /dev/null 2>&1 \
  || gh_api POST /labels "$(jq -nc --arg n "$label" --arg c "$color" --arg d "$desc" '{name: $n, color: $c, description: $d}')" > /dev/null
gh_api POST "/issues/$pr/labels" "$(jq -nc --arg l "$label" '{labels: [$l]}')" > /dev/null
# 반대 결과 라벨 제거 — 재배포로 실패→성공(또는 반대)이 되면 최신 결과만 남김. 없으면 404 무시
gh_api DELETE "/issues/$pr/labels/$(jq -rn --arg l "$stale" '$l|@uri')" > /dev/null 2>&1 || true

# 재실행 때 같은 코멘트 중복 방지 (실행 링크까지 같아야 중복)
if gh_api GET "/issues/$pr/comments?per_page=100" | jq -e --arg b "$body" 'any(.[]; .body == $b)' > /dev/null; then
  echo "PR #$pr 이미 표시됨"; exit 0
fi
gh_api POST "/issues/$pr/comments" "$(jq -nc --arg b "$body" '{body: $b}')" > /dev/null
echo "- PR #$pr: $result 표시" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
