#!/bin/bash
# svg-embed/*.svg 를 Figma 에 올린다.
# 먼저 Figma MCP 의 upload_assets(count = SVG 개수, currentPageId = 대상 페이지)를 불러 submitUrl 들을 받고,
# 그 주소의 /upload/<이 부분>/submit 값을 받은 순서대로 인자로 준다.
#   사용: upload-svgs.sh <페이지 id (예: 941:2)> <uuid1> <uuid2> ...
#         ONLY=07-board upload-svgs.sh 941:2 <uuid>     (한 묶음만)
# 파일은 이름순(00-index, 01-…)으로 uuid 와 짝지어진다. 주소는 한 번만 쓸 수 있고 10분 뒤 만료된다.
set -u
DIR="${WF_DIR:-$HOME/soma/capture-catus}/svg-embed"
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
for u in "$@"; do
  f="${FILES[$i]}"; i=$((i + 1))
  size=$(stat -f %z "$f")
  if [ "$size" -gt 10000000 ]; then echo "$(basename "$f") 가 10MB 를 넘습니다($size). make-jpg.sh 품질을 낮춰 다시 만드세요." >&2; exit 1; fi
  (
    r=$(curl -sS -m 280 -X POST -F "file=@$f;type=image/svg+xml;filename=$(basename "$f")" "https://mcp.figma.com/mcp/upload/$u/$Q")
    id=$(echo "$r" | grep -o '"placedOnNodeId":"[^"]*"' | cut -d'"' -f4)
    if [ -n "$id" ]; then echo "$(basename "$f") → $id"; else echo "$(basename "$f") 실패: ${r:0:160}"; fi
  ) &
  # 네 개씩 동시에
  if [ $((i % 4)) -eq 0 ]; then wait; fi
done
wait
