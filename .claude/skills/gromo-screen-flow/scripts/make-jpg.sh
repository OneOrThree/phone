#!/bin/bash
# shots/final/*.png → shots/jpg/*.jpg (피그마에 올릴 가벼운 그림). 품질은 첫 인자(기본 80)
# 작업 폴더는 sections.cjs 와 같은 규칙으로 고른다(WF_DIR → 보관 폴더 → app/app-dev/.docs/screen-flow)
SK="$(cd "$(dirname "$0")" && pwd)"
WF="$(WF_QUIET=1 node -p "require('$SK/sections.cjs').ROOT")" || exit 1
cd "$WF/shots" || { echo "작업 폴더에 shots/ 가 없습니다: $WF" >&2; exit 1; }
mkdir -p jpg
Q=${1:-80}
for f in final/*.png; do
  o="jpg/$(basename "${f%.png}").jpg"
  if [ ! -f "$o" ] || [ "$f" -nt "$o" ] || [ -n "$FORCE" ]; then sips -s format jpeg -s formatOptions "$Q" "$f" --out "$o" >/dev/null; fi
done
ls jpg | wc -l; du -sh jpg | cut -f1
