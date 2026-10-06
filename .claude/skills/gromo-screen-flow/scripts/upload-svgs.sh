#!/bin/bash
# svg-embed/*.svg 를 Figma 에 올린다.
# 먼저 Figma MCP 의 upload_assets(count = SVG 개수, currentPageId = 대상 페이지)를 불러 submitUrl 들을 받고,
# 그 주소의 /upload/<이 부분>/submit 값을 받은 순서대로 인자로 준다.
#   사용: upload-svgs.sh <페이지 id (예: 941:2)> <uuid1> <uuid2> ...
#         ONLY=07-board upload-svgs.sh 941:2 <uuid>     (한 묶음만)
# 파일은 이름순(00-index, 01-…)으로 uuid 와 짝지어진다. 주소는 한 번만 쓸 수 있고 10분 뒤 만료된다.
# 한 장이라도 실패하면 종료 상태 1 — 실패한 파일만 ONLY= 로 다시 올린다.
set -u
# 작업 폴더는 sections.cjs 와 같은 규칙으로 고른다(WF_DIR → 보관 폴더 → app/app-dev/.docs/screen-flow)
SK="$(cd "$(dirname "$0")" && pwd)"
WF="$(WF_QUIET=1 node -p "require('$SK/sections.cjs').ROOT")" || exit 1
DIR="$WF/svg-embed"
PAGE="$1"; shift
FILES=()
# ONLY=07-board,13-common 처럼 주면 그 묶음만 올린다 (한 묶음만 바뀌었을 때)
while IFS= read -r f; do
  if [ -n "${ONLY:-}" ]; then
    case ",$ONLY," in *",$(basename "$f" .svg),"*) ;; *) continue ;; esac
  fi
  FILES+=("$f")
done < <(ls "$DIR"/*.svg | sort)
if [ "${#FILES[@]}" -ne "$#" ]; then
  echo "SVG ${#FILES[@]}개인데 uuid 는 $#개입니다. upload_assets 의 count 를 SVG 개수와 같게 하세요." >&2; exit 1
fi
Q="submit?scaleMode=FILL&currentPageId=${PAGE/:/%3A}"
i=0
pids=""   # 배열 대신 문자열 — macOS 기본 bash(3.2)는 set -u 에서 빈 배열 전개가 에러
fail=0
wait_all() { for p in $pids; do wait "$p" || fail=1; done; pids=""; }
for u in "$@"; do
  f="${FILES[$i]}"; i=$((i + 1))
  size=$(stat -f %z "$f")
  if [ "$size" -gt 10000000 ]; then echo "$(basename "$f") 가 10MB 를 넘습니다($size). make-jpg.sh 품질을 낮춰 다시 만드세요." >&2; exit 1; fi
  (
    r=$(curl -sS -m 280 -X POST -F "file=@$f;type=image/svg+xml;filename=$(basename "$f")" "https://mcp.figma.com/mcp/upload/$u/$Q")
    id=$(echo "$r" | grep -o '"placedOnNodeId":"[^"]*"' | cut -d'"' -f4)
    # 응답에 프레임 id 가 없으면(주소 만료·네트워크·API 오류) 이 작업은 실패
    if [ -n "$id" ]; then echo "$(basename "$f") → $id"; else echo "$(basename "$f") 실패: ${r:0:160}" >&2; exit 1; fi
  ) &
  pids="$pids $!"
  # 네 개씩 동시에
  if [ $((i % 4)) -eq 0 ]; then wait_all; fi
done
wait_all
if [ "$fail" -ne 0 ]; then echo "올리지 못한 파일이 있습니다. 위의 '실패' 줄을 보고 그 묶음만 ONLY= 로 다시 올리세요." >&2; exit 1; fi
