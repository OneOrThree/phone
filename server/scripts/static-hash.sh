#!/bin/sh
# 카탈로그 이미지를 내용 해시 파일명으로 server/static/customization/<kind>/ 에 복사한다 (GROMO-2331).
# 사용: static-hash.sh <원본.png> <kind>   → 출력: 복사한 경로 · sha8 (파일명 = <원본 이름>.<sha8>.png)
set -eu
[ $# -eq 2 ] || { echo "사용: $0 <원본.png> <kind(head|neck|shoes|clothes|decor)>" >&2; exit 2; }
src=$1; kind=$2
sha8=$(shasum -a 256 "$src" | cut -c1-8)
dest="$(cd "$(dirname "$0")/../static" && pwd)/customization/$kind"
mkdir -p "$dest"
name=$(basename "$src" .png).$sha8.png
cp "$src" "$dest/$name"
echo "server/static/customization/$kind/$name"
echo "$sha8"
